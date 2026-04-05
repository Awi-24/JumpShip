"""
JumpShip — Agent Tool System.

Provides a typed tool interface that the agent loop can expose to the LLM.
Each tool has a name, description, JSON-schema parameters, and an async
execute() method that operates on an AgentContext (page, profile, LLM, etc.).

Tools are the bridge between LLM decisions and Playwright actions.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


# ── Context shared across all tools during a single task ──────────────────────

@dataclass
class AgentContext:
    page: Any
    profile: dict
    job_info: dict
    llm_service: Any
    resume_path: str | None = None
    dry_run: bool = True
    filled_fields: dict = field(default_factory=dict)
    screenshots: list[str] = field(default_factory=list)
    human_help_requested: bool = False
    human_help_message: str = ""


# ── Tool call record (for trace logging) ─────────────────────────────────────

@dataclass
class ToolCallRecord:
    tool: str
    args: dict
    result: str = ""
    error: str = ""
    duration_ms: int = 0


# ── Base class ────────────────────────────────────────────────────────────────

class Tool:
    """Base class for all agent tools."""
    name: str = ""
    description: str = ""
    parameters: dict = {}

    def to_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": self.parameters,
                "required": [k for k, v in self.parameters.items() if v.get("required", False)],
            },
        }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        raise NotImplementedError


# ── read_page ─────────────────────────────────────────────────────────────────

class ReadPageTool(Tool):
    name = "read_page"
    description = (
        "Extract the current page's visible structure: form labels, input fields, "
        "buttons, headings, and key text. Returns a structured summary of what the "
        "agent can interact with."
    )
    parameters = {}

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        page = ctx.page
        parts: list[str] = []

        url = page.url
        title = await page.title()
        parts.append(f"URL: {url}")
        parts.append(f"Title: {title}")

        headings = await page.locator("h1, h2, h3").all_inner_texts()
        if headings:
            parts.append(f"Headings: {'; '.join(h.strip() for h in headings[:8] if h.strip())}")

        labels = await page.locator("label, legend").all_inner_texts()
        placeholders = []
        for el in await page.locator("[placeholder]").all():
            ph = await el.get_attribute("placeholder")
            if ph:
                placeholders.append(ph)
        all_labels = list({l.strip() for l in labels + placeholders if l.strip()})
        if all_labels:
            parts.append(f"Form fields ({len(all_labels)}): {'; '.join(all_labels[:30])}")

        buttons = await page.locator("button, input[type='submit']").all_inner_texts()
        btn_texts = [b.strip() for b in buttons if b.strip()]
        if btn_texts:
            parts.append(f"Buttons: {'; '.join(btn_texts[:15])}")

        file_inputs = await page.locator("input[type='file']").count()
        if file_inputs > 0:
            parts.append(f"File upload inputs: {file_inputs}")

        selects = await page.locator("select").count()
        if selects > 0:
            parts.append(f"Dropdown selects: {selects}")

        return "\n".join(parts)


# ── fill_field ────────────────────────────────────────────────────────────────

class FillFieldTool(Tool):
    name = "fill_field"
    description = (
        "Fill a form field identified by its label text or placeholder. "
        "The value should be appropriate for the field type."
    )
    parameters = {
        "label": {"type": "string", "description": "Label text, placeholder, or aria-label of the field", "required": True},
        "value": {"type": "string", "description": "Value to fill in", "required": True},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        label = args["label"]
        value = args["value"]
        page = ctx.page

        selectors = [
            f'[aria-label="{label}"]',
            f'[placeholder="{label}"]',
            f'label:has-text("{label}") + input',
            f'label:has-text("{label}") + textarea',
            f'label:has-text("{label}") ~ input',
            f'label:has-text("{label}") ~ textarea',
        ]

        for sel in selectors:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                tag = await loc.evaluate("el => el.tagName.toLowerCase()")
                if tag == "select":
                    await loc.select_option(label=str(value))
                elif tag == "input":
                    itype = await loc.get_attribute("type") or "text"
                    if itype in ("radio", "checkbox"):
                        await loc.check() if value.lower() in ("yes", "true", "1") else await loc.uncheck()
                    elif itype != "file":
                        await loc.fill(str(value))
                elif tag == "textarea":
                    await loc.fill(str(value))
                else:
                    continue

                ctx.filled_fields[label] = value
                return f"Filled '{label}' with '{value[:60]}'"

        return f"Could not find field with label '{label}'"


# ── click_button ──────────────────────────────────────────────────────────────

class ClickButtonTool(Tool):
    name = "click_button"
    description = "Click a button on the page identified by its visible text."
    parameters = {
        "text": {"type": "string", "description": "Visible text of the button to click", "required": True},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        text = args["text"]
        page = ctx.page

        btn = page.locator(f'button:has-text("{text}"), input[type="submit"][value="{text}"]').first
        if await btn.count() > 0:
            await btn.click()
            await page.wait_for_timeout(1000)
            return f"Clicked button '{text}'"

        link = page.locator(f'a:has-text("{text}")').first
        if await link.count() > 0:
            await link.click()
            await page.wait_for_timeout(1000)
            return f"Clicked link '{text}'"

        return f"Could not find button with text '{text}'"


# ── upload_file ───────────────────────────────────────────────────────────────

class UploadFileTool(Tool):
    name = "upload_file"
    description = (
        "Upload the user's resume to a file input on the page. "
        "Optionally target a specific file input by label."
    )
    parameters = {
        "label": {"type": "string", "description": "Label near the file input (optional)", "required": False},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        if not ctx.resume_path:
            return "No resume file available to upload"

        page = ctx.page
        label = args.get("label", "")

        if label:
            loc = page.locator(
                f'label:has-text("{label}") ~ input[type="file"], '
                f'label:has-text("{label}") + input[type="file"]'
            ).first
            if await loc.count() > 0:
                await loc.set_input_files(ctx.resume_path)
                ctx.filled_fields["resume_uploaded"] = True
                return f"Uploaded resume to '{label}' input"

        file_inputs = page.locator('input[type="file"]')
        count = await file_inputs.count()
        if count > 0:
            await file_inputs.first.set_input_files(ctx.resume_path)
            ctx.filled_fields["resume_uploaded"] = True
            return "Uploaded resume to first file input"

        return "No file input found on page"


# ── select_option ─────────────────────────────────────────────────────────────

class SelectOptionTool(Tool):
    name = "select_option"
    description = "Select an option from a dropdown (select element) by label."
    parameters = {
        "field_label": {"type": "string", "description": "Label of the select dropdown", "required": True},
        "option_text": {"type": "string", "description": "Visible text of the option to select", "required": True},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        field_label = args["field_label"]
        option_text = args["option_text"]
        page = ctx.page

        selectors = [
            f'label:has-text("{field_label}") + select',
            f'label:has-text("{field_label}") ~ select',
            f'[aria-label="{field_label}"]',
        ]

        for sel in selectors:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                try:
                    await loc.select_option(label=option_text)
                    ctx.filled_fields[field_label] = option_text
                    return f"Selected '{option_text}' for '{field_label}'"
                except Exception:
                    try:
                        await loc.select_option(value=option_text)
                        ctx.filled_fields[field_label] = option_text
                        return f"Selected '{option_text}' for '{field_label}'"
                    except Exception:
                        pass

        return f"Could not find dropdown for '{field_label}'"


# ── generate_answer ───────────────────────────────────────────────────────────

class GenerateAnswerTool(Tool):
    name = "generate_answer"
    description = (
        "Use the LLM to compose a free-text answer for an application question. "
        "Provide the question and any context. Returns the generated text."
    )
    parameters = {
        "question": {"type": "string", "description": "The application question to answer", "required": True},
        "context": {"type": "string", "description": "Additional context (job description excerpt, field hints)", "required": False},
        "max_words": {"type": "integer", "description": "Approximate max word count for the answer", "required": False},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        question = args["question"]
        extra_context = args.get("context", "")
        max_words = args.get("max_words", 150)

        safe_profile = {
            k: v for k, v in ctx.profile.items()
            if k not in ("linkedin_password", "id", "created_at", "updated_at") and v is not None
        }

        system = (
            "You are helping a job applicant answer an application question. "
            "Write a professional, concise, and honest answer. "
            f"Keep it under {max_words} words. Return only the answer text."
        )

        job_context = ""
        if ctx.job_info.get("job_title"):
            job_context = f"\nJob: {ctx.job_info['job_title']} at {ctx.job_info.get('company', 'N/A')}"

        user = (
            f"CANDIDATE PROFILE:\n{json.dumps(safe_profile, indent=2, ensure_ascii=False)}\n"
            f"{job_context}\n"
            f"{'ADDITIONAL CONTEXT: ' + extra_context if extra_context else ''}\n"
            f"QUESTION: {question}\n\n"
            f"Write a professional answer:"
        )

        try:
            answer = await ctx.llm_service.complete(system, user)
            return answer.strip()
        except Exception as exc:
            return f"Failed to generate answer: {exc}"


# ── research_company ──────────────────────────────────────────────────────────

class ResearchCompanyTool(Tool):
    name = "research_company"
    description = (
        "Search the web for information about a company (culture, reviews, salary data). "
        "Useful for answering 'why this company' questions or enriching cover letters."
    )
    parameters = {
        "company": {"type": "string", "description": "Company name", "required": True},
        "job_title": {"type": "string", "description": "Job title for salary context", "required": False},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        from backend.services.web_search import search_company_info
        company = args["company"]
        job_title = args.get("job_title", ctx.job_info.get("job_title", ""))
        try:
            info = await search_company_info(company, job_title)
            return info if info else f"No information found for '{company}'"
        except Exception as exc:
            return f"Research failed: {exc}"


# ── take_screenshot ───────────────────────────────────────────────────────────

class TakeScreenshotTool(Tool):
    name = "take_screenshot"
    description = "Capture a screenshot of the current page for debugging or review."
    parameters = {
        "label": {"type": "string", "description": "Short label for the screenshot (e.g. 'before_submit')", "required": False},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        label = args.get("label", "step")
        ts = int(time.time())
        screenshot_dir = Path("screenshots")
        screenshot_dir.mkdir(exist_ok=True)
        path = str(screenshot_dir / f"agent_{label}_{ts}.png")
        try:
            await ctx.page.screenshot(path=path, full_page=True)
            ctx.screenshots.append(path)
            return f"Screenshot saved: {path}"
        except Exception as exc:
            return f"Screenshot failed: {exc}"


# ── wait_for_page ─────────────────────────────────────────────────────────────

class WaitForPageTool(Tool):
    name = "wait_for_page"
    description = (
        "Wait for the page to finish loading or for a specific element to appear. "
        "Use after clicking buttons that trigger navigation."
    )
    parameters = {
        "seconds": {"type": "number", "description": "Seconds to wait (max 10)", "required": False},
        "wait_for_text": {"type": "string", "description": "Wait until this text appears on the page", "required": False},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        seconds = min(args.get("seconds", 2), 10)
        wait_text = args.get("wait_for_text", "")

        if wait_text:
            try:
                await ctx.page.locator(f'text="{wait_text}"').wait_for(
                    state="visible", timeout=int(seconds * 1000)
                )
                return f"Text '{wait_text}' appeared"
            except Exception:
                return f"Text '{wait_text}' did not appear within {seconds}s"
        else:
            await ctx.page.wait_for_timeout(int(seconds * 1000))
            return f"Waited {seconds}s"


# ── request_human_help ────────────────────────────────────────────────────────

class RequestHumanHelpTool(Tool):
    name = "request_human_help"
    description = (
        "Pause the task and ask the user for help. Use when encountering a CAPTCHA, "
        "login requirement, ambiguous question the agent cannot answer, or any situation "
        "that requires human judgment."
    )
    parameters = {
        "reason": {"type": "string", "description": "Why help is needed (shown to user)", "required": True},
    }

    async def execute(self, args: dict, ctx: AgentContext) -> str:
        reason = args["reason"]
        ctx.human_help_requested = True
        ctx.human_help_message = reason

        try:
            screenshot_dir = Path("screenshots")
            screenshot_dir.mkdir(exist_ok=True)
            ts = int(time.time())
            path = str(screenshot_dir / f"help_needed_{ts}.png")
            await ctx.page.screenshot(path=path, full_page=True)
            ctx.screenshots.append(path)
        except Exception:
            pass

        return f"PAUSED — Human help requested: {reason}"


# ── Registry ──────────────────────────────────────────────────────────────────

ALL_TOOLS: list[Tool] = [
    ReadPageTool(),
    FillFieldTool(),
    ClickButtonTool(),
    UploadFileTool(),
    SelectOptionTool(),
    GenerateAnswerTool(),
    ResearchCompanyTool(),
    TakeScreenshotTool(),
    WaitForPageTool(),
    RequestHumanHelpTool(),
]

TOOL_MAP: dict[str, Tool] = {t.name: t for t in ALL_TOOLS}


def get_tool_schemas() -> list[dict]:
    """Return JSON schemas for all tools (for LLM function calling)."""
    return [t.to_schema() for t in ALL_TOOLS]


async def execute_tool(name: str, args: dict, ctx: AgentContext) -> ToolCallRecord:
    """Look up and execute a tool, returning a record with timing."""
    tool = TOOL_MAP.get(name)
    if not tool:
        return ToolCallRecord(tool=name, args=args, error=f"Unknown tool: {name}")

    start = time.monotonic()
    try:
        result = await tool.execute(args, ctx)
        duration = int((time.monotonic() - start) * 1000)
        return ToolCallRecord(tool=name, args=args, result=result, duration_ms=duration)
    except Exception as exc:
        duration = int((time.monotonic() - start) * 1000)
        logger.error("Tool %s failed: %s", name, exc)
        return ToolCallRecord(tool=name, args=args, error=str(exc)[:300], duration_ms=duration)
