"""
Browser automation agent using Playwright + vision-capable LLM for job application automation.
Handles any job portal by using AI vision to understand and interact with pages.

Supported vision providers (uses the same provider configured for the rest of the app):
  - Ollama  (local) — llava, llava-llama3, moondream, minicpm-v, bakllava, …
  - LM Studio / OpenClaw (local, OpenAI-compatible) — any multimodal model loaded
  - OpenAI  (cloud)  — gpt-4o, gpt-4-turbo, …
  - Anthropic (cloud) — claude-* models
  - Groq    (cloud)  — llama-3.2-*-vision-preview, …

Falls back to HTML-heuristic mode if no vision provider is available.
"""
from __future__ import annotations

import asyncio
import base64
import dataclasses
import json
import os
import re
import uuid
from datetime import datetime
from typing import Optional, Callable

import httpx

SCREENSHOT_INTERVAL = 1.5   # seconds between vision cycles
MAX_VISION_ITERATIONS = 45  # max number of vision-action cycles per session


# ── LLM config dataclass ──────────────────────────────────────────────────────

@dataclasses.dataclass
class AgentLLMConfig:
    provider: str = ""   # empty = use global settings
    model: str = ""      # empty = use global settings
    api_key: str = ""    # empty = use global settings
    base_url: str = ""   # for ollama/lmstudio; empty = use global settings


# ── Portal detection ──────────────────────────────────────────────────────────

_PORTAL_HINTS = {
    'linkedin': (
        "LinkedIn Easy Apply: click the Easy Apply button to open modal, "
        "navigate multi-step form with Next/Back, Submit Application at the end."
    ),
    'greenhouse': (
        "Greenhouse ATS: single-page application form, fill all fields, "
        "click Submit Application at bottom."
    ),
    'lever': "Lever ATS: fill the form fields, click Apply button.",
    'workday': (
        "Workday ATS: complex multi-section flow, use section navigation buttons, "
        "final button is Submit."
    ),
    'icims': "iCIMS ATS: multi-step wizard, use Next to advance, Submit at final step.",
    'indeed': "Indeed: click Apply button which may open external flow.",
    'smartrecruiters': "SmartRecruiters: fill form sections, use Next/Submit.",
    'generic': "Fill all visible required form fields, then click the submit/apply button.",
}


class ApplicationAgent:
    """
    Autonomous job application agent.

    Uses Playwright for browser control and a vision-capable LLM
    (Ollama, OpenAI, Anthropic, Groq, or LM Studio — whichever is configured)
    to understand pages and fill forms intelligently.
    Falls back to HTML-selector heuristics when no vision provider is available.
    """

    def __init__(
        self,
        agent_id: str,
        job_url: str,
        user_profile: dict,
        resume_path: Optional[str] = None,
        headless: bool = True,
        llm_config: Optional[AgentLLMConfig] = None,
    ):
        self.agent_id = agent_id
        self.job_url = job_url
        self.user_profile = user_profile
        self.resume_path = resume_path
        self.headless = headless
        self.llm_config = llm_config or AgentLLMConfig()

        # Metadata set by AgentManager
        self.job_title: str = ""
        self.company: str = ""
        self.application_id: Optional[str] = None

        # State
        self.status: str = "pending"
        self.log: list[dict] = []
        self.screenshot_b64: Optional[str] = None
        self.current_action: str = "Initializing…"
        self.error: Optional[str] = None

        # Stop signal
        self._stop_event = asyncio.Event()

        # Human interaction
        self._human_event = asyncio.Event()
        self._human_response: Optional[str] = None
        self.interaction_pending: Optional[dict] = None

        # Async callbacks: async fn(event_type, data) -> None
        self._callbacks: list[Callable] = []

    # ── Public helpers ────────────────────────────────────────────────────────

    def add_callback(self, cb: Callable):
        self._callbacks.append(cb)

    def stop(self):
        self._stop_event.set()

    def set_human_response(self, response: str):
        """Called by the router when user responds to an interaction."""
        self._human_response = response
        self.interaction_pending = None
        self._human_event.set()

    # ── Internal broadcasting ─────────────────────────────────────────────────

    async def _broadcast(self, event_type: str, data):
        for cb in self._callbacks:
            try:
                await cb(event_type, data)
            except Exception:
                pass

    async def _log(self, msg: str, level: str = "info"):
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "message": msg,
            "level": level,
        }
        self.log.append(entry)
        self.current_action = msg
        await self._broadcast("log", entry)

    async def _capture_screenshot(self, page) -> str:
        try:
            data = await page.screenshot(type="jpeg", quality=60, full_page=False)
            b64 = base64.b64encode(data).decode()
            self.screenshot_b64 = b64
            await self._broadcast("screenshot", b64)
            return b64
        except Exception:
            return self.screenshot_b64 or ""

    # ── Human interaction ─────────────────────────────────────────────────────

    async def _wait_for_human(self, timeout: float = 600.0) -> str:
        """Wait for human response. Returns response or 'timeout'/'cancelled'."""
        self._human_response = None
        self._human_event.clear()
        try:
            end = asyncio.get_event_loop().time() + timeout
            while True:
                if self._human_event.is_set():
                    return self._human_response or ""
                if self._stop_event.is_set():
                    return "cancelled"
                if asyncio.get_event_loop().time() > end:
                    return "timeout"
                await asyncio.sleep(0.5)
        except Exception:
            return "error"

    async def _request_review(self, page) -> bool:
        """Pause for human review before submitting. Returns True if approved."""
        screenshot_b64 = await self._capture_screenshot(page)
        prev_status = self.status
        self.status = "review_requested"
        self.interaction_pending = {
            "type": "review",
            "message": "Application form is filled. Please review and approve before submitting.",
            "options": ["approve_submit", "cancel"],
        }
        await self._broadcast("interaction_required", {
            **self.interaction_pending,
            "screenshot": screenshot_b64,
        })
        await self._log("Waiting for human review before submitting...", "warn")
        response = await self._wait_for_human(timeout=600)
        self.status = prev_status
        approved = response == "approve_submit"
        await self._log(f"Review response: {'APPROVED' if approved else 'CANCELLED'}")
        return approved

    async def _request_help(self, page, reason: str, options: list[str]) -> str:
        """Ask user for help. Returns chosen option."""
        screenshot_b64 = await self._capture_screenshot(page)
        prev_status = self.status
        self.status = "help_requested"
        self.interaction_pending = {
            "type": "help",
            "reason": reason,
            "options": options,
        }
        await self._broadcast("interaction_required", {
            **self.interaction_pending,
            "screenshot": screenshot_b64,
        })
        await self._log(f"Help requested: {reason}", "warn")
        response = await self._wait_for_human(timeout=600)
        self.status = prev_status
        await self._log(f"Help response: {response}")
        return response

    # ── Portal detection ──────────────────────────────────────────────────────

    def _detect_portal(self) -> str:
        url = self.job_url.lower()
        if 'linkedin.com' in url:
            return 'linkedin'
        if 'greenhouse.io' in url or 'boards.greenhouse' in url:
            return 'greenhouse'
        if 'lever.co' in url:
            return 'lever'
        if 'workday.com' in url or 'myworkdayjobs' in url:
            return 'workday'
        if 'icims.com' in url:
            return 'icims'
        if 'indeed.com' in url:
            return 'indeed'
        if 'smartrecruiters.com' in url:
            return 'smartrecruiters'
        return 'generic'

    # ── Vision analysis ───────────────────────────────────────────────────────

    def _build_prompt(self, history: list[str], portal: str = "generic") -> str:
        """Build the vision prompt from the user profile and action history."""
        p = self.user_profile
        profile_summary = {
            "name": p.get("name", ""),
            "email": p.get("email", ""),
            "phone": p.get("phone", ""),
            "address": " ".join(filter(None, [p.get("address"), p.get("city"), p.get("state"), p.get("country")])),
            "linkedin": p.get("linkedin_url", ""),
            "github": p.get("github_url", ""),
            "portfolio": p.get("portfolio_url", ""),
            "current_title": p.get("current_title", ""),
            "years_experience": p.get("years_experience", 0),
            "professional_summary": p.get("professional_summary", ""),
            "skills": p.get("skills", []),
            "work_experience": p.get("work_experience", []),
            "education": p.get("education", []),
            "expected_salary": p.get("expected_salary", ""),
            "work_authorization": p.get("work_authorization", "Authorized to work"),
            "remote_preference": p.get("remote_preference", ""),
            "willing_to_relocate": p.get("willing_to_relocate", False),
            "cover_letter": p.get("cover_letter_template", ""),
            "custom_answers": {
                qa.get("question", ""): qa.get("answer", "")
                for qa in p.get("custom_answers", [])
                if qa.get("question")
            },
        }
        recent = history[-6:] if history else []
        history_text = "\n".join(f"- {h}" for h in recent) if recent else "None yet."
        has_resume = bool(self.resume_path and os.path.exists(self.resume_path))
        portal_hint = _PORTAL_HINTS.get(portal, _PORTAL_HINTS["generic"])
        stuck_warning = ""
        if len(history) >= 4:
            last_four = history[-4:]
            if len(set(last_four)) == 1:
                stuck_warning = "\nWARNING: You appear to be stuck repeating the same action. Use type 'request_help' to ask for human assistance.\n"

        return f"""You are an AI agent autonomously filling out a job application in a browser.

PORTAL GUIDANCE: {portal_hint}

USER PROFILE (use these values to fill fields):
{json.dumps(profile_summary, indent=2)}

RESUME FILE AVAILABLE: {has_resume}

RECENT ACTIONS (avoid repeating the same action in a loop):
{history_text}
{stuck_warning}
Analyze the screenshot and choose ONE next action. Rules:
- Prefer filling visible required fields before clicking Next/Submit.
- Match field labels to profile values (be smart about variations).
- For open-ended questions (e.g. "Why do you want to work here?"), generate a concise professional answer using the profile.
- If you see a file-upload input for a resume/CV and resume is available, use type "upload".
- Scroll down if you suspect more fields exist below the viewport.
- Use type "done" ONLY when the application is fully submitted or nothing more can be done.
- Do NOT submit until ALL visible required fields are filled.
- Use EXACT CSS selectors valid for Playwright (prefer id, name, aria-label over complex paths).
- Use type "request_help" with a "reason" field if you encounter something you cannot handle (CAPTCHA, login wall, confusing page, etc.)
- Use type "request_review" when ALL fields are filled and you are ready to submit — this will pause for human approval before any submission occurs.

Respond ONLY with valid JSON (no markdown fences):
{{
  "page_state": "brief description of what you see",
  "next_action": {{
    "type": "fill" | "click" | "select" | "upload" | "scroll" | "wait" | "done" | "request_help" | "request_review",
    "selector": "<CSS selector — required for fill/click/select/upload>",
    "value": "<value to type or option to select — required for fill/select>",
    "reason": "<required when type is request_help — explain what you cannot handle>",
    "description": "<one-line description of what this action does>"
  }}
}}"""

    def _parse_vision_response(self, text: str) -> dict:
        """Extract and parse the JSON action from a vision model response."""
        match = re.search(r"\{.*\}", text.strip(), re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {"page_state": "parse error", "next_action": {"type": "wait", "description": "Could not parse model response"}}

    def _is_submit_action(self, action: dict) -> bool:
        """Return True if action appears to be a form submission."""
        action_type = action.get("type", "")
        desc = (action.get("description", "") or "").lower()
        selector = (action.get("selector", "") or "").lower()
        if action_type == "request_review":
            return True
        if action_type == "click":
            submit_keywords = ("submit", "apply", "send application", "send my application", "finish")
            if any(kw in desc for kw in submit_keywords):
                return True
            if any(kw in selector for kw in ("submit", "apply-btn", "apply_btn")):
                return True
        return False

    async def _analyze_with_vision(self, screenshot_b64: str, history: list[str], portal: str = "generic") -> dict:
        """
        Send screenshot + user profile to the configured vision LLM and return the next action.
        Routes to Ollama, OpenAI, Anthropic, or Groq based on agent or global settings.
        """
        from backend.config import settings as global_settings

        provider = self.llm_config.provider or global_settings.llm_provider
        model = self.llm_config.model or global_settings.llm_model

        try:
            if provider in ("ollama", "openclaw", "lmstudio"):
                base_url = self.llm_config.base_url or global_settings.ollama_base_url
                return await self._vision_ollama(screenshot_b64, history, model, base_url, portal=portal)
            elif provider == "openai":
                api_key = self.llm_config.api_key or global_settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
                return await self._vision_openai_compat(
                    screenshot_b64, history, model,
                    api_key=api_key,
                    base_url="https://api.openai.com",
                    portal=portal,
                )
            elif provider == "anthropic":
                api_key = self.llm_config.api_key or global_settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
                return await self._vision_anthropic(screenshot_b64, history, model, api_key=api_key, portal=portal)
            elif provider == "groq":
                api_key = self.llm_config.api_key or global_settings.groq_api_key or os.environ.get("GROQ_API_KEY", "")
                return await self._vision_openai_compat(
                    screenshot_b64, history, model,
                    api_key=api_key,
                    base_url="https://api.groq.com/openai",
                    portal=portal,
                )
            else:
                await self._log(f"Vision not supported for provider '{provider}'", "warn")
        except Exception as e:
            await self._log(f"Vision analysis error ({provider}): {e}", "warn")

        return {"page_state": "unknown", "next_action": {"type": "wait", "description": "Vision analysis failed — waiting"}}

    # ── Per-provider vision implementations ──────────────────────────────────

    async def _vision_ollama(
        self,
        screenshot_b64: str,
        history: list[str],
        model: str,
        base_url: str,
        portal: str = "generic",
    ) -> dict:
        """
        Ollama multimodal generation.
        Works with llava, llava-llama3, moondream, minicpm-v, bakllava, etc.
        Falls back to host.docker.internal if localhost fails (Docker usage).
        """
        prompt = self._build_prompt(history, portal=portal)
        payload = {"model": model, "prompt": prompt, "images": [screenshot_b64], "stream": False}

        candidates = [base_url]
        if "localhost" in base_url or "127.0.0.1" in base_url:
            fallback = base_url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
            if fallback not in candidates:
                candidates.append(fallback)

        last_exc: Optional[Exception] = None
        for base in candidates:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    r = await client.post(f"{base.rstrip('/')}/api/generate", json=payload)
                    r.raise_for_status()
                    return self._parse_vision_response(r.json().get("response", ""))
            except Exception as exc:
                last_exc = exc

        raise last_exc or RuntimeError("Ollama unreachable")

    async def _vision_openai_compat(
        self,
        screenshot_b64: str,
        history: list[str],
        model: str,
        api_key: str,
        base_url: str,
        portal: str = "generic",
    ) -> dict:
        """
        OpenAI vision API (also works for Groq and LM Studio via OpenAI-compatible endpoint).
        """
        prompt = self._build_prompt(history, portal=portal)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model,
            "max_tokens": 512,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}"}},
                ],
            }],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{base_url.rstrip('/')}/v1/chat/completions", json=payload, headers=headers)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
            return self._parse_vision_response(text)

    async def _vision_anthropic(
        self,
        screenshot_b64: str,
        history: list[str],
        model: str,
        api_key: str,
        portal: str = "generic",
    ) -> dict:
        """Anthropic Claude vision via the anthropic SDK."""
        try:
            import anthropic
        except ImportError:
            raise RuntimeError("anthropic package not installed — run: pip install anthropic")

        client = anthropic.AsyncAnthropic(api_key=api_key or None)
        prompt = self._build_prompt(history, portal=portal)
        # Default to a capable vision model if the configured model is a text-only one
        vision_model = model if model.startswith("claude") else "claude-sonnet-4-6"

        response = await client.messages.create(
            model=vision_model,
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": screenshot_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return self._parse_vision_response(response.content[0].text)

    # ── Action execution ──────────────────────────────────────────────────────

    async def _execute_action(self, page, action: dict) -> bool:
        """Execute a single action on the page. Returns True on success."""
        action_type = action.get("type", "wait")
        selector = action.get("selector", "")
        value = str(action.get("value", ""))

        try:
            if action_type == "fill":
                await page.fill(selector, value, timeout=5000)
                return True

            elif action_type == "click":
                await page.click(selector, timeout=5000)
                return True

            elif action_type == "select":
                await page.select_option(selector, value, timeout=5000)
                return True

            elif action_type == "upload":
                if self.resume_path and os.path.exists(self.resume_path):
                    await page.set_input_files(selector, self.resume_path, timeout=5000)
                    return True
                await self._log("Resume not found — skipping upload", "warn")
                return False

            elif action_type == "scroll":
                await page.evaluate("window.scrollBy(0, 400)")
                await asyncio.sleep(0.5)
                return True

            elif action_type in ("wait", "done"):
                await asyncio.sleep(1)
                return True

        except Exception as e:
            await self._log(f"Action failed [{action_type}] on '{selector}': {e}", "warn")
            return False

        return False

    # ── HTML-fallback (no vision provider) ───────────────────────────────────

    async def _html_fallback_fill(self, page):
        """Best-effort HTML-based form filling when vision is unavailable."""
        p = self.user_profile
        name_parts = p.get("name", "").split(" ")
        first = name_parts[0] if name_parts else ""
        last = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

        mappings = [
            ('input[autocomplete="name"], input[name="name"], input[placeholder*="full name" i]', p.get("name", "")),
            ('input[autocomplete="given-name"], input[name*="first" i]', first),
            ('input[autocomplete="family-name"], input[name*="last" i]', last),
            ('input[type="email"], input[name*="email" i]', p.get("email", "")),
            ('input[type="tel"], input[name*="phone" i], input[autocomplete="tel"]', p.get("phone", "")),
            ('input[name*="linkedin" i], input[placeholder*="linkedin" i]', p.get("linkedin_url", "")),
            ('input[name*="github" i], input[placeholder*="github" i]', p.get("github_url", "")),
            ('input[name*="portfolio" i], input[name*="website" i]', p.get("portfolio_url", "")),
            ('input[name*="salary" i], input[placeholder*="salary" i]', p.get("expected_salary", "")),
            ('textarea[name*="cover" i], textarea[placeholder*="cover" i]', p.get("cover_letter_template", "")),
            ('textarea[name*="summary" i], textarea[placeholder*="summary" i]', p.get("professional_summary", "")),
        ]

        for selector, value in mappings:
            if not value:
                continue
            try:
                el = await page.query_selector(selector)
                if el:
                    await el.fill(str(value))
                    await self._log(f"Filled '{selector}'")
            except Exception:
                pass

        if self.resume_path and os.path.exists(self.resume_path):
            try:
                fi = await page.query_selector('input[type="file"]')
                if fi:
                    await fi.set_input_files(self.resume_path)
                    await self._log("Uploaded resume (HTML mode)")
            except Exception:
                pass

    # ── Vision availability check ─────────────────────────────────────────────

    def _check_vision_available(self) -> tuple[bool, str]:
        """
        Returns (available: bool, label: str) based on the configured LLM provider.
        Uses agent-level llm_config with fallback to global settings.
        """
        try:
            from backend.config import settings as global_settings
        except Exception:
            return False, "config unavailable"

        provider = self.llm_config.provider or global_settings.llm_provider
        model = self.llm_config.model or global_settings.llm_model

        if provider in ("ollama", "openclaw", "lmstudio"):
            _vision_keywords = ("llava", "moondream", "minicpm", "bakllava", "vision", "cogvlm", "qwen-vl", "phi-3-v")
            looks_multimodal = any(kw in model.lower() for kw in _vision_keywords)
            label = f"Ollama ({model})"
            if not looks_multimodal:
                label += " ⚠ model may not support vision — set LLM_MODEL to a multimodal model (e.g. llava)"
            return True, label

        elif provider == "openai":
            key = self.llm_config.api_key or global_settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
            return bool(key), f"OpenAI ({model})" if key else "OpenAI — OPENAI_API_KEY not set"

        elif provider == "anthropic":
            key = self.llm_config.api_key or global_settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
            return bool(key), f"Anthropic ({model})" if key else "Anthropic — ANTHROPIC_API_KEY not set"

        elif provider == "groq":
            key = self.llm_config.api_key or global_settings.groq_api_key or os.environ.get("GROQ_API_KEY", "")
            return bool(key), f"Groq ({model})" if key else "Groq — GROQ_API_KEY not set"

        return False, f"Provider '{provider}' not recognised for vision"

    # ── Main run loop ─────────────────────────────────────────────────────────

    async def run(self):
        """Main agent execution loop — called as an asyncio Task."""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            self.status = "failed"
            self.error = "Playwright not installed. Run: pip install playwright && playwright install chromium"
            await self._broadcast("status", {"status": self.status, "error": self.error})
            return

        self.status = "running"
        await self._broadcast("status", {"status": self.status})
        await self._log(f"Agent started → {self.job_url}")

        # Detect portal
        portal = self._detect_portal()
        await self._log(f"Detected portal: {portal}")

        # Determine if the configured LLM provider supports vision
        use_vision, vision_label = self._check_vision_available()
        await self._log(
            f"Vision mode: ON ({vision_label})" if use_vision
            else "Vision mode: OFF — using HTML fallback (configure a vision-capable model to enable)",
            "info" if use_vision else "warn",
        )

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=self.headless,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            try:
                await self._log(f"Navigating to {self.job_url}")
                await page.goto(self.job_url, timeout=30_000, wait_until="domcontentloaded")
                await asyncio.sleep(2.5)

                if use_vision:
                    action_history: list[str] = []
                    iterations = 0

                    while not self._stop_event.is_set() and iterations < MAX_VISION_ITERATIONS:
                        iterations += 1

                        screenshot_b64 = await self._capture_screenshot(page)
                        if not screenshot_b64:
                            await asyncio.sleep(2)
                            continue

                        await self._log(f"Analyzing page — step {iterations} of {MAX_VISION_ITERATIONS}…")
                        analysis = await self._analyze_with_vision(screenshot_b64, action_history, portal=portal)

                        action = analysis.get("next_action", {"type": "wait", "description": "No action"})
                        page_state = analysis.get("page_state", "")
                        desc = action.get("description", action.get("type", "unknown"))

                        await self._log(f"→ {desc}")
                        action_history.append(desc)

                        action_type = action.get("type")

                        # Stuck detection: last 4 actions identical
                        if len(action_history) >= 4 and len(set(action_history[-4:])) == 1:
                            reason = f"Repeated the same action 4 times: '{action_history[-1]}'"
                            await self._log(f"Stuck detected — {reason}", "warn")
                            response = await self._request_help(
                                page, reason,
                                options=["skip_and_continue", "retry", "cancel"],
                            )
                            if response == "cancel":
                                break
                            # Clear history to avoid re-triggering stuck detection
                            action_history.clear()
                            continue

                        if action_type == "done":
                            await self._log("Application process complete!")
                            break

                        if action_type == "request_help":
                            reason = action.get("reason", "Agent encountered an unknown issue")
                            response = await self._request_help(
                                page, reason,
                                options=["skip_and_continue", "retry", "cancel"],
                            )
                            if response == "cancel":
                                break
                            # Don't count this as a stuck action
                            action_history.pop()
                            continue

                        if action_type == "request_review" or self._is_submit_action(action):
                            approved = await self._request_review(page)
                            if not approved:
                                await self._log("Submission cancelled by user.", "warn")
                                break
                            # If approved and action is a click (submit button), execute it
                            if action_type == "click":
                                await self._execute_action(page, action)
                            await asyncio.sleep(SCREENSHOT_INTERVAL)
                            await self._log("Application submitted!")
                            break

                        await self._execute_action(page, action)
                        await asyncio.sleep(SCREENSHOT_INTERVAL)

                        if self._stop_event.is_set():
                            await self._log("Agent stopped by user.")
                            break

                else:
                    # HTML fallback: click apply button then fill fields
                    apply_selectors = [
                        "button:has-text('Easy Apply')",
                        "button:has-text('Apply Now')",
                        "button:has-text('Apply')",
                        "a:has-text('Apply Now')",
                        "[data-automation='apply-button']",
                        ".jobs-apply-button",
                    ]
                    for sel in apply_selectors:
                        if self._stop_event.is_set():
                            break
                        try:
                            btn = await page.wait_for_selector(sel, timeout=3000)
                            if btn:
                                await self._log(f"Found apply button: {sel}")
                                await btn.click()
                                await asyncio.sleep(2)
                                break
                        except Exception:
                            continue

                    await self._capture_screenshot(page)
                    await self._html_fallback_fill(page)
                    await asyncio.sleep(1)

                # Final screenshot
                await self._capture_screenshot(page)
                self.status = "stopped" if self._stop_event.is_set() else "completed"

            except Exception as e:
                self.error = str(e)
                self.status = "failed"
                await self._log(f"Fatal error: {e}", "error")
                try:
                    await self._capture_screenshot(page)
                except Exception:
                    pass
            finally:
                await browser.close()

        await self._broadcast("status", {"status": self.status, "error": self.error})
        await self._log(f"Agent finished → {self.status}")


# ── Sync wrapper (legacy / applications.py compat) ───────────────────────────

def run_apply(job_url: str, user_profile: dict, resume_path: Optional[str] = None) -> dict:
    """Synchronous wrapper kept for backward compatibility with applications.py."""
    agent = ApplicationAgent(
        agent_id=str(uuid.uuid4()),
        job_url=job_url,
        user_profile=user_profile,
        resume_path=resume_path,
        headless=True,
    )
    asyncio.run(agent.run())
    return {
        "success": agent.status == "completed",
        "status": agent.status,
        "log": "\n".join(e["message"] for e in agent.log),
        "timestamp": datetime.utcnow().isoformat(),
    }
