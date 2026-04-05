"""
JumpShip — LangChain tool-calling application agent.

Flow:
  1. Load resume text from file
  2. Open job URL in Playwright browser
  3. Call adapt_resume to align resume with job requirements (rewording, not lying)
  4. ReAct-style loop: read page → plan → fill fields → navigate → repeat
  5. Request human help on CAPTCHAs, login walls, or unresolvable situations
  6. Complete application → report back to orchestrator

Model requirement: Ollama with a tool-calling capable model (llama3.1:8b or gemma2:9b).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

StatusCB = Callable[[str], Awaitable[None]] | None
TraceCB  = Callable[[dict], Awaitable[None]] | None

MAX_ITERATIONS    = 25
BROWSER_TIMEOUT   = 30_000   # ms — page load timeout
HUMAN_HELP_TIMEOUT = 120     # seconds — how long to wait for user input


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _noop(msg: str): pass
async def _noop_trace(evt: dict): pass


# ── Human help state ──────────────────────────────────────────────────────────

class HumanHelpState:
    """
    Allows the agent to pause and wait for a human response.
    The orchestrator calls resolve() when the user submits input via the API.
    """

    def __init__(self):
        self.requested: bool = False
        self.message:   str  = ""
        self._event    = asyncio.Event()
        self._response = ""

    async def request_help(self, message: str) -> str:
        self.requested = True
        self.message   = message
        self._event.clear()
        try:
            await asyncio.wait_for(self._event.wait(), timeout=HUMAN_HELP_TIMEOUT)
        except asyncio.TimeoutError:
            self.requested = False
            return f"No user response after {HUMAN_HELP_TIMEOUT}s — continuing without input."
        self.requested = False
        response, self._response = self._response, ""
        return response

    def resolve(self, response: str):
        """Called by the orchestrator when the user submits a response."""
        self._response = response
        self._event.set()


# ── Platform detection & strategies ──────────────────────────────────────────

def _detect_platform(url: str) -> str:
    u = url.lower()
    if "linkedin.com"        in u: return "linkedin"
    if "indeed.com"          in u: return "indeed"
    if "glassdoor.com"       in u: return "glassdoor"
    if "greenhouse.io"       in u: return "greenhouse"
    if "jobs.lever.co"       in u: return "lever"
    if "workday"             in u: return "workday"
    if "smartrecruiters.com" in u: return "smartrecruiters"
    if "jobvite.com"         in u: return "jobvite"
    return "generic"


PLATFORM_STRATEGIES: dict[str, str] = {
    "linkedin": (
        "LinkedIn Easy Apply flow:\n"
        "1. Look for 'Easy Apply' button and click it.\n"
        "2. A multi-step modal appears — read each step, fill fields, click Next.\n"
        "3. Upload resume when a file input appears.\n"
        "4. For free-text questions, use generate_answer.\n"
        "5. Stop before 'Submit application' in dry-run mode."
    ),
    "greenhouse": (
        "Greenhouse ATS (boards.greenhouse.io):\n"
        "1. Single-page form, no login required.\n"
        "2. Common fields: first_name, last_name, email, phone, LinkedIn URL.\n"
        "3. Upload resume, fill all visible fields, use generate_answer for essays.\n"
        "4. Submit when all fields are filled (unless dry-run)."
    ),
    "lever": (
        "Lever ATS (jobs.lever.co):\n"
        "1. Single-page form, no login required.\n"
        "2. Fill name, email, phone, LinkedIn, GitHub, portfolio.\n"
        "3. Upload resume, answer any additional questions.\n"
        "4. Submit when ready (unless dry-run)."
    ),
    "indeed": (
        "Indeed apply flow:\n"
        "1. Click 'Apply now' button.\n"
        "2. Multi-step wizard — fill each step, click Continue/Next.\n"
        "3. Upload resume, fill all sections.\n"
        "4. Submit at final step (unless dry-run)."
    ),
    "generic": (
        "Generic application page:\n"
        "1. Read the page to understand the form structure.\n"
        "2. Fill all visible fields using profile data.\n"
        "3. Use generate_answer for free-text questions.\n"
        "4. Upload resume where a file input exists.\n"
        "5. Navigate through pages if multi-step."
    ),
}


# ── Tool input schemas ────────────────────────────────────────────────────────

class NoInput(BaseModel):
    pass

class FillFieldInput(BaseModel):
    label: str = Field(description="Label text, placeholder, or aria-label of the field")
    value: str = Field(description="Value to enter in the field")

class ClickButtonInput(BaseModel):
    text: str = Field(description="Visible text of the button or link to click")

class SelectOptionInput(BaseModel):
    field_label: str  = Field(description="Label of the dropdown/select element")
    option_text: str  = Field(description="Visible text of the option to select")

class UploadResumeInput(BaseModel):
    label: str = Field(default="", description="Label near the file input (leave blank for first file input)")

class GenerateAnswerInput(BaseModel):
    question:  str = Field(description="The application question to answer")
    context:   str = Field(default="", description="Extra context from the page (optional)")
    max_words: int = Field(default=150, description="Maximum word count")

class AdaptResumeInput(BaseModel):
    job_description: str = Field(description="Full job description text extracted from the page")
    job_title:       str = Field(default="", description="Job title")
    company:         str = Field(default="", description="Company name")

class WaitInput(BaseModel):
    seconds:       float = Field(default=2.0, description="Seconds to wait (max 10)")
    wait_for_text: str   = Field(default="",  description="Wait until this text appears on the page")

class RequestHelpInput(BaseModel):
    reason: str = Field(description="Why you need human help — shown directly to the user")


# ── Main agent class ──────────────────────────────────────────────────────────

class ApplicationAgent:
    """
    LangChain tool-calling agent that fills job application forms via Playwright.
    Uses Ollama as the LLM backend (local, privacy-first).
    """

    def __init__(
        self,
        job_url:         str,
        profile:         dict,
        llm_model:       str,
        ollama_base_url: str,
        resume_path:     str | None     = None,
        dry_run:         bool           = True,
        headless:        bool           = True,
        status_callback: StatusCB       = None,
        trace_callback:  TraceCB        = None,
        cancel_event:    asyncio.Event | None = None,
    ):
        self.job_url         = job_url
        self.profile         = profile
        self.llm_model       = llm_model
        self.ollama_base_url = ollama_base_url
        self.resume_path     = resume_path
        self.dry_run         = dry_run
        self.headless        = headless
        self._status         = status_callback or _noop
        self._trace          = trace_callback  or _noop_trace
        self.cancel_event    = cancel_event    or asyncio.Event()

        # Runtime state
        self.page:           Any         = None
        self.resume_text:    str         = ""
        self.adapted_resume: str         = ""
        self.filled_fields:  dict        = {}
        self.screenshots:    list[str]   = []
        self.human_help      = HumanHelpState()
        self._step           = 0

    # ── Public entry point ────────────────────────────────────────────────────

    async def run(self) -> dict:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return {
                "status": "failed",
                "error": "Playwright not installed. Run: pip install playwright && playwright install chromium",
            }

        await self._status("Loading resume…")
        self._load_resume_text()

        await self._status(f"Opening browser → {self.job_url[:60]}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 900},
            )
            self.page = await context.new_page()

            try:
                await self.page.goto(
                    self.job_url,
                    timeout=BROWSER_TIMEOUT,
                    wait_until="domcontentloaded",
                )
                await asyncio.sleep(2)
                result = await self._run_agent()
            except Exception as exc:
                logger.error("Agent crashed: %s", exc, exc_info=True)
                result = {"status": "failed", "error": str(exc)[:300]}
            finally:
                await browser.close()

        result.setdefault("fields_filled", self.filled_fields)
        result.setdefault("screenshots",   self.screenshots)
        return result

    # ── Resume loading ────────────────────────────────────────────────────────

    def _load_resume_text(self):
        if not self.resume_path:
            return
        path = Path(self.resume_path)
        if not path.exists():
            return
        try:
            suffix = path.suffix.lower()
            if suffix == ".pdf":
                from pdfminer.high_level import extract_text
                self.resume_text = extract_text(str(path))
            elif suffix in (".docx", ".doc"):
                import docx
                doc = docx.Document(str(path))
                self.resume_text = "\n".join(p.text for p in doc.paragraphs)
            else:
                self.resume_text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            logger.warning("Could not load resume: %s", exc)

    # ── LangChain agent setup & execution ─────────────────────────────────────

    async def _run_agent(self) -> dict:
        from langchain_ollama import ChatOllama
        from langchain.agents import create_tool_calling_agent, AgentExecutor
        from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

        await self._status(f"Connecting to Ollama ({self.llm_model})…")

        llm = ChatOllama(
            model=self.llm_model,
            base_url=self.ollama_base_url,
            temperature=0,
            num_ctx=4096,
        )

        tools   = self._build_tools()
        prompt  = self._build_prompt()
        agent   = create_tool_calling_agent(llm, tools, prompt)
        executor = AgentExecutor(
            agent=agent,
            tools=tools,
            max_iterations=MAX_ITERATIONS,
            handle_parsing_errors=True,
            verbose=True,
            return_intermediate_steps=True,
        )

        platform = _detect_platform(self.job_url)
        task_input = self._build_task_input(platform)

        await self._status("Agent started — reading page…")
        await self._emit("status", {"summary": "Agent loop started", "platform": platform})

        try:
            result = await executor.ainvoke(
                {"input": task_input},
                config={"callbacks": [self._make_callback()]},
            )
        except asyncio.CancelledError:
            return {"status": "cancelled", "note": "Cancelled by user"}
        except Exception as exc:
            logger.error("AgentExecutor failed: %s", exc, exc_info=True)
            return {"status": "failed", "error": str(exc)[:300]}

        output = result.get("output", "")
        steps  = len(result.get("intermediate_steps", []))

        await self._status("Agent finished.")
        await self._emit("done", {"summary": output[:200], "steps": steps})

        return {
            "status": "success",
            "note":   output[:300],
            "steps":  steps,
        }

    # ── Prompt ────────────────────────────────────────────────────────────────

    def _build_prompt(self):
        from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

        safe_profile = {
            k: v for k, v in self.profile.items()
            if k not in ("linkedin_password", "id", "created_at", "updated_at") and v
        }

        resume_section = (
            f"\n\nRESUME (original — adapt_resume will improve this for the job):\n{self.resume_text[:2000]}"
            if self.resume_text else ""
        )

        dry_run_note = (
            "\n\n⚠ DRY RUN MODE: Fill all fields but do NOT click the final Submit/Apply button."
            if self.dry_run else
            "\n\nLIVE MODE: Fill and submit the application."
        )

        system = (
            "You are JumpShip, an AI agent that fills job application forms in a real browser.\n\n"

            "CANDIDATE PROFILE:\n"
            f"{json.dumps(safe_profile, indent=2, ensure_ascii=False)}"
            f"{resume_section}"
            f"{dry_run_note}\n\n"

            "TOOLS AVAILABLE:\n"
            "- read_page: Always call this first and after every navigation to understand the current state.\n"
            "- fill_field: Fill an input by its label or placeholder.\n"
            "- click_button: Click a button or link by its visible text.\n"
            "- select_option: Choose a value from a dropdown.\n"
            "- upload_resume: Upload the candidate's resume file.\n"
            "- generate_answer: Write a professional answer to an application question using the candidate's profile.\n"
            "- adapt_resume: Reword the resume to match the job description (call once after reading job info).\n"
            "- take_screenshot: Capture current page state.\n"
            "- wait_for_page: Wait for the page to load or for specific text to appear.\n"
            "- request_human_help: Pause and ask the user for help (CAPTCHAs, login walls, ambiguous situations).\n\n"

            "APPROACH:\n"
            "1. read_page → understand what's on screen.\n"
            "2. If you can see the job description, call adapt_resume once.\n"
            "3. Fill every required field using fill_field or select_option.\n"
            "4. For open-ended questions (cover letter, 'why this company'), use generate_answer.\n"
            "5. Upload resume if a file input is present.\n"
            "6. Click Next/Continue and repeat from step 1 for multi-page forms.\n"
            "7. take_screenshot before the final submit step.\n"
            "8. In DRY RUN: stop before the final Submit. In LIVE: click Submit.\n"
            "9. request_human_help for CAPTCHAs, login walls, or anything you cannot handle alone."
        )

        return ChatPromptTemplate.from_messages([
            ("system", system),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ])

    def _build_task_input(self, platform: str) -> str:
        strategy = PLATFORM_STRATEGIES.get(platform, PLATFORM_STRATEGIES["generic"])
        return (
            f"Apply to the job at: {self.job_url}\n\n"
            f"PLATFORM: {platform}\n"
            f"PLATFORM STRATEGY:\n{strategy}\n\n"
            "Start by calling read_page to see the current state of the page."
        )

    # ── LangChain callback for SSE streaming ─────────────────────────────────

    def _make_callback(self):
        from langchain_core.callbacks import AsyncCallbackHandler

        agent = self

        class _SSECallback(AsyncCallbackHandler):
            async def on_agent_action(self, action, *, run_id, **kwargs):
                agent._step += 1
                await agent._emit("tool_start", {
                    "summary": f"Step {agent._step}: {action.tool}",
                    "tool":    action.tool,
                    "input":   str(action.tool_input)[:200],
                })
                await agent._status(f"Step {agent._step}: {action.tool}…")

            async def on_tool_end(self, output, *, run_id, **kwargs):
                await agent._emit("tool_end", {
                    "summary": str(output)[:120],
                    "result":  str(output)[:300],
                })

            async def on_agent_finish(self, finish, *, run_id, **kwargs):
                await agent._emit("done", {
                    "summary": finish.return_values.get("output", "")[:150],
                })

            async def on_chain_error(self, error, *, run_id, **kwargs):
                await agent._emit("error", {"summary": str(error)[:200]})

        return _SSECallback()

    # ── SSE helper ────────────────────────────────────────────────────────────

    async def _emit(self, event_type: str, content: dict):
        await self._trace({
            "step":       self._step,
            "event_type": event_type,
            "content":    content,
        })

    # ── Tool implementations ──────────────────────────────────────────────────

    def _build_tools(self) -> list:
        from langchain_core.tools import StructuredTool

        return [
            StructuredTool.from_function(
                name="read_page",
                description=(
                    "Extract the current page structure: form labels, input fields, buttons, "
                    "headings. Call this first and after every navigation."
                ),
                coroutine=self._read_page,
                args_schema=NoInput,
            ),
            StructuredTool.from_function(
                name="fill_field",
                description="Fill a form field identified by its label text or placeholder.",
                coroutine=self._fill_field,
                args_schema=FillFieldInput,
            ),
            StructuredTool.from_function(
                name="click_button",
                description="Click a button or link by its visible text.",
                coroutine=self._click_button,
                args_schema=ClickButtonInput,
            ),
            StructuredTool.from_function(
                name="select_option",
                description="Select an option from a dropdown (select element) by label.",
                coroutine=self._select_option,
                args_schema=SelectOptionInput,
            ),
            StructuredTool.from_function(
                name="upload_resume",
                description="Upload the candidate's resume to a file input on the page.",
                coroutine=self._upload_resume,
                args_schema=UploadResumeInput,
            ),
            StructuredTool.from_function(
                name="generate_answer",
                description=(
                    "Use AI to compose a professional answer to an application question, "
                    "based on the candidate's profile and adapted resume."
                ),
                coroutine=self._generate_answer,
                args_schema=GenerateAnswerInput,
            ),
            StructuredTool.from_function(
                name="adapt_resume",
                description=(
                    "Reword the candidate's resume to align with this job's requirements. "
                    "Does NOT invent skills. Call once after reading the job description."
                ),
                coroutine=self._adapt_resume,
                args_schema=AdaptResumeInput,
            ),
            StructuredTool.from_function(
                name="take_screenshot",
                description="Capture a screenshot of the current page.",
                coroutine=self._take_screenshot,
                args_schema=NoInput,
            ),
            StructuredTool.from_function(
                name="wait_for_page",
                description="Wait for the page to load or for specific text to appear.",
                coroutine=self._wait_for_page,
                args_schema=WaitInput,
            ),
            StructuredTool.from_function(
                name="request_human_help",
                description=(
                    "Pause the agent and ask the user for help. Use for: CAPTCHAs, "
                    "login walls, questions you cannot answer from the profile."
                ),
                coroutine=self._request_human_help,
                args_schema=RequestHelpInput,
            ),
        ]

    # ── read_page ─────────────────────────────────────────────────────────────

    async def _read_page(self) -> str:
        page  = self.page
        parts = []

        parts.append(f"URL: {page.url}")
        parts.append(f"Title: {await page.title()}")

        headings = await page.locator("h1, h2, h3").all_inner_texts()
        visible  = [h.strip() for h in headings if h.strip()]
        if visible:
            parts.append(f"Headings: {'; '.join(visible[:6])}")

        labels       = await page.locator("label, legend").all_inner_texts()
        placeholders = []
        for el in await page.locator("[placeholder]").all():
            ph = await el.get_attribute("placeholder")
            if ph:
                placeholders.append(ph)
        all_labels = list({l.strip() for l in labels + placeholders if l.strip()})
        if all_labels:
            parts.append(f"Form fields ({len(all_labels)}): {'; '.join(all_labels[:25])}")

        buttons   = await page.locator("button, input[type='submit'], a[role='button']").all_inner_texts()
        btn_texts = [b.strip() for b in buttons if b.strip()]
        if btn_texts:
            parts.append(f"Buttons: {'; '.join(btn_texts[:12])}")

        file_count = await page.locator("input[type='file']").count()
        if file_count:
            parts.append(f"File upload inputs: {file_count}")

        select_count = await page.locator("select").count()
        if select_count:
            parts.append(f"Dropdown selects: {select_count}")

        checkbox_count = await page.locator("input[type='checkbox']").count()
        if checkbox_count:
            parts.append(f"Checkboxes: {checkbox_count}")

        return "\n".join(parts)

    # ── fill_field ────────────────────────────────────────────────────────────

    async def _fill_field(self, label: str, value: str) -> str:
        page = self.page
        selectors = [
            f'[aria-label="{label}"]',
            f'[placeholder="{label}"]',
            f'input[name="{label}"]',
            f'textarea[name="{label}"]',
            f'label:has-text("{label}") input',
            f'label:has-text("{label}") textarea',
            f'label:has-text("{label}") ~ input',
            f'label:has-text("{label}") ~ textarea',
        ]
        for sel in selectors:
            loc = page.locator(sel).first
            try:
                if await loc.count() > 0 and await loc.is_visible():
                    itype = await loc.get_attribute("type") or "text"
                    if itype in ("radio", "checkbox"):
                        if value.lower() in ("yes", "true", "1", "on"):
                            await loc.check()
                        else:
                            await loc.uncheck()
                    elif itype != "file":
                        await loc.click()
                        await loc.fill(str(value))
                    self.filled_fields[label] = value
                    return f"Filled '{label}' = '{str(value)[:60]}'"
            except Exception:
                continue
        return f"Field '{label}' not found — try a different label name from read_page output"

    # ── click_button ──────────────────────────────────────────────────────────

    async def _click_button(self, text: str) -> str:
        page = self.page
        for sel in [
            f'button:has-text("{text}")',
            f'input[type="submit"][value="{text}"]',
            f'a:has-text("{text}")',
            f'[role="button"]:has-text("{text}")',
        ]:
            loc = page.locator(sel).first
            try:
                if await loc.count() > 0 and await loc.is_visible():
                    await loc.click()
                    await asyncio.sleep(1.5)
                    return f"Clicked '{text}'"
            except Exception:
                continue
        return f"Button '{text}' not found — check read_page output for exact button text"

    # ── select_option ─────────────────────────────────────────────────────────

    async def _select_option(self, field_label: str, option_text: str) -> str:
        page = self.page
        for sel in [
            f'label:has-text("{field_label}") + select',
            f'label:has-text("{field_label}") ~ select',
            f'[aria-label="{field_label}"]',
            f'select[name="{field_label}"]',
        ]:
            loc = page.locator(sel).first
            try:
                if await loc.count() > 0:
                    try:
                        await loc.select_option(label=option_text)
                    except Exception:
                        await loc.select_option(value=option_text)
                    self.filled_fields[field_label] = option_text
                    return f"Selected '{option_text}' in '{field_label}'"
            except Exception:
                continue
        return f"Dropdown '{field_label}' not found"

    # ── upload_resume ─────────────────────────────────────────────────────────

    async def _upload_resume(self, label: str = "") -> str:
        if not self.resume_path or not Path(self.resume_path).exists():
            return "No resume file available to upload"
        page = self.page
        if label:
            for sel in [
                f'label:has-text("{label}") ~ input[type="file"]',
                f'label:has-text("{label}") + input[type="file"]',
            ]:
                loc = page.locator(sel).first
                try:
                    if await loc.count() > 0:
                        await loc.set_input_files(self.resume_path)
                        self.filled_fields["resume_uploaded"] = True
                        return f"Uploaded resume to '{label}' input"
                except Exception:
                    continue
        file_inputs = page.locator('input[type="file"]')
        if await file_inputs.count() > 0:
            await file_inputs.first.set_input_files(self.resume_path)
            self.filled_fields["resume_uploaded"] = True
            return f"Uploaded resume: {Path(self.resume_path).name}"
        return "No file input found on page"

    # ── generate_answer ───────────────────────────────────────────────────────

    async def _generate_answer(self, question: str, context: str = "", max_words: int = 150) -> str:
        from langchain_ollama import ChatOllama
        from langchain_core.messages import HumanMessage, SystemMessage

        resume_src   = self.adapted_resume or self.resume_text
        safe_profile = {
            k: v for k, v in self.profile.items()
            if k not in ("linkedin_password", "id") and v
        }
        llm = ChatOllama(
            model=self.llm_model,
            base_url=self.ollama_base_url,
            temperature=0.3,
        )
        system = (
            "You are helping a job applicant answer an application question. "
            "Write a professional, honest, concise answer. "
            f"Keep it under {max_words} words. Return ONLY the answer text."
        )
        user = (
            f"CANDIDATE PROFILE:\n{json.dumps(safe_profile, indent=2, ensure_ascii=False)}\n"
            + (f"RESUME:\n{resume_src[:800]}\n" if resume_src else "")
            + (f"CONTEXT: {context}\n" if context else "")
            + f"\nQUESTION: {question}\n\nAnswer:"
        )
        try:
            resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
            return resp.content.strip()
        except Exception as exc:
            return f"Could not generate answer: {exc}"

    # ── adapt_resume ──────────────────────────────────────────────────────────

    async def _adapt_resume(
        self,
        job_description: str,
        job_title: str = "",
        company: str = "",
    ) -> str:
        if not self.resume_text:
            return "No resume text available — please upload a resume file first."

        from langchain_ollama import ChatOllama
        from langchain_core.messages import HumanMessage, SystemMessage

        llm = ChatOllama(
            model=self.llm_model,
            base_url=self.ollama_base_url,
            temperature=0.2,
        )
        system = (
            "You are an expert resume writer. Reword the resume to align with the job requirements.\n"
            "STRICT RULES:\n"
            "1. DO NOT invent skills, experience, or qualifications.\n"
            "2. DO reorder bullet points to put the most relevant items first.\n"
            "3. DO rephrase existing experience using the job's vocabulary and keywords.\n"
            "4. DO enhance action verbs and quantify results where already stated.\n"
            "5. Return ONLY the reworded resume text (plain text, sections separated by ---)."
        )
        user = (
            f"TARGET JOB: {job_title} at {company}\n\n"
            f"JOB DESCRIPTION:\n{job_description[:2000]}\n\n"
            f"ORIGINAL RESUME:\n{self.resume_text[:2000]}\n\n"
            "Return the adapted resume:"
        )
        try:
            resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
            self.adapted_resume = resp.content.strip()
            await self._emit("resume_adapted", {
                "summary":    f"Resume adapted for '{job_title}' at '{company}'",
                "job_title":  job_title,
                "company":    company,
            })
            return (
                f"Resume adapted for '{job_title}' at '{company}'. "
                "Use generate_answer for free-text questions — it will now use this improved version."
            )
        except Exception as exc:
            return f"Could not adapt resume: {exc}"

    # ── take_screenshot ───────────────────────────────────────────────────────

    async def _take_screenshot(self) -> str:
        ts  = int(time.time())
        dir = Path("screenshots")
        dir.mkdir(exist_ok=True)
        path = str(dir / f"agent_{ts}.png")
        try:
            await self.page.screenshot(path=path, full_page=False)
            self.screenshots.append(path)
            return f"Screenshot saved: {path}"
        except Exception as exc:
            return f"Screenshot failed: {exc}"

    # ── wait_for_page ─────────────────────────────────────────────────────────

    async def _wait_for_page(self, seconds: float = 2.0, wait_for_text: str = "") -> str:
        seconds = min(seconds, 10.0)
        if wait_for_text:
            try:
                await self.page.locator(f'text="{wait_for_text}"').wait_for(
                    state="visible", timeout=int(seconds * 1000)
                )
                return f"Text '{wait_for_text}' appeared"
            except Exception:
                return f"Text '{wait_for_text}' did not appear within {seconds}s"
        await asyncio.sleep(seconds)
        return f"Waited {seconds}s"

    # ── request_human_help ────────────────────────────────────────────────────

    async def _request_human_help(self, reason: str) -> str:
        await self._take_screenshot()
        await self._emit("human_help_requested", {
            "summary": f"Agent needs help: {reason}",
            "reason":  reason,
        })
        await self._status(f"Waiting for your help: {reason}")
        response = await self.human_help.request_help(reason)
        await self._status("Received response — resuming…")
        return f"User responded: {response}"


# ── Public API (orchestrator-compatible) ──────────────────────────────────────

async def run_apply_agent(
    job_url:         str,
    profile:         dict,
    llm_service:     Any,
    resume_path:     str | None    = None,
    dry_run:         bool          = True,
    headless:        bool          = True,
    status_callback: StatusCB      = None,
    trace_callback:  TraceCB       = None,
    cancel_event:    asyncio.Event | None = None,
) -> dict:
    """
    Entry point called by AgentOrchestrator._run_task.
    Extracts Ollama config from llm_service for backward compatibility.
    """
    ollama_base_url = getattr(llm_service, "ollama_base_url", "http://localhost:11434")
    llm_model       = getattr(llm_service, "model",           "llama3.1:8b")

    agent = ApplicationAgent(
        job_url         = job_url,
        profile         = profile,
        llm_model       = llm_model,
        ollama_base_url = ollama_base_url,
        resume_path     = resume_path,
        dry_run         = dry_run,
        headless        = headless,
        status_callback = status_callback,
        trace_callback  = trace_callback,
        cancel_event    = cancel_event,
    )
    return await agent.run()
