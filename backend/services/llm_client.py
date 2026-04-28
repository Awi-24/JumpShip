"""
JumpShip — Unified LLM client.

Supports: anthropic | openai | gemini | deepseek | groq | huggingface |
          mistral | openrouter | cohere | ollama | lmstudio (OpenAI-compatible)

Usage:
    client = LLMClient(provider="ollama", model="llama3.2")
    text = client.complete(system="...", user="...")
    data = client.complete_json(system="...", user="...", schema={...})
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional

# ── Concurrency control ────────────────────────────────────────────────────────
# Local providers (Ollama / LM Studio) run one inference at a time on the GPU.
# Cloud-relay models (Ollama *-cloud suffix) bypass the semaphore — inference is remote.
# LLM_MAX_CONCURRENT env var overrides the default slot count (default: 1).

LOCAL_PROVIDERS = frozenset({"ollama", "lmstudio", "openclaw"})
_local_sem: asyncio.Semaphore | None = None


def _sem_slots() -> int:
    import os
    try:
        return max(1, int(os.getenv("LLM_MAX_CONCURRENT", "1")))
    except ValueError:
        return 1


def get_local_sem() -> asyncio.Semaphore:
    """Lazy singleton semaphore for local LLM providers."""
    global _local_sem
    if _local_sem is None:
        _local_sem = asyncio.Semaphore(_sem_slots())
    return _local_sem


def is_local_provider(provider: str) -> bool:
    return provider in LOCAL_PROVIDERS


def needs_semaphore(provider: str, model: str) -> bool:
    """False for cloud-relay models (Ollama *-cloud) — no GPU contention."""
    if not is_local_provider(provider):
        return False
    if model and model.endswith("-cloud"):
        return False
    return True


# ── Thinking-model helpers ─────────────────────────────────────────────────────
# Qwen3, QwQ, DeepSeek-R1 and similar "reasoning" models run an internal chain-of-
# thought pass before generating a response.  For structured JSON tasks this wastes
# the token budget: the model can burn the entire max_tokens on <think> and return
# empty content.  We suppress thinking for these models by prepending /no-think to
# the system prompt, which is supported by Qwen3 and compatible runtimes.

_THINKING_MODEL_RE = re.compile(
    r"qwen3|qwq|deepseek-r\d|deepseek-reasoner|qwen-3",
    re.IGNORECASE,
)


def _is_thinking_model(model: str) -> bool:
    return bool(_THINKING_MODEL_RE.search(model or ""))


def _suppress_thinking(system: str, model: str) -> str:
    """Prepend /no-think to system prompt for thinking models (Qwen3, DeepSeek-R1, QwQ)."""
    if _is_thinking_model(model) and not system.startswith("/no-think"):
        return "/no-think\n" + system
    return system


# ── JSON helpers ───────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def clean_and_parse_json(raw: str) -> dict:
    cleaned = _strip_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    extracted = _extract_json_object(cleaned)
    try:
        return json.loads(extracted)
    except json.JSONDecodeError:
        pass
    preview = raw[:500].replace("\n", "\\n")
    raise ValueError(f"LLM returned non-parseable JSON.\nPreview: {preview}")


# ── Provider adapters ──────────────────────────────────────────────────────────

def _call_anthropic(model: str, api_key: str, base_url: Optional[str],
                    system: str, user: str, max_tokens: int,
                    json_schema: Optional[dict]) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key, **({"base_url": base_url} if base_url else {}))
    if json_schema:
        tools = [{
            "name": "structured_output",
            "description": "Return structured data.",
            "input_schema": json_schema,
        }]
        msg = client.messages.create(
            model=model or "claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=system,
            tools=tools,
            tool_choice={"type": "tool", "name": "structured_output"},
            messages=[{"role": "user", "content": user}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "structured_output":
                return json.dumps(block.input)
        for block in msg.content:
            if hasattr(block, "text"):
                return block.text.strip()
        raise ValueError("Anthropic returned no usable content block.")
    else:
        msg = client.messages.create(
            model=model or "claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text.strip()


def _call_openai_compat(model: str, api_key: str, base_url: Optional[str],
                        system: str, user: str, max_tokens: int,
                        json_schema: Optional[dict],
                        default_model: str = "gpt-4o-mini") -> str:
    from openai import OpenAI
    kwargs_client: dict = {"api_key": api_key}
    if base_url:
        kwargs_client["base_url"] = base_url
    client = OpenAI(**kwargs_client)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    kwargs: dict = dict(
        model=model or default_model,
        max_tokens=max_tokens,
        messages=messages,
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    choice = resp.choices[0]
    content = (choice.message.content or "").strip()

    if not content:
        # Thinking models (Qwen3, DeepSeek-R1, QwQ) expose their reasoning chain in
        # reasoning_content and may return empty content when the token budget is
        # exhausted during the <think> pass.  Try to rescue JSON from the reasoning.
        reasoning = getattr(choice.message, "reasoning_content", None) or ""
        if reasoning:
            # Extract the last complete JSON object the model was constructing
            match = re.search(r'(\{[\s\S]*\})\s*$', reasoning)
            if match:
                return match.group(1)

    return content


def _call_gemini(model: str, api_key: str, base_url: Optional[str],
                 system: str, user: str, max_tokens: int,
                 json_schema: Optional[dict]) -> str:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    gen_config: dict = {"max_output_tokens": max_tokens}
    if json_schema:
        gen_config["response_mime_type"] = "application/json"
    m = genai.GenerativeModel(
        model_name=model or "gemini-1.5-flash",
        system_instruction=system,
        generation_config=gen_config,
    )
    resp = m.generate_content(user)
    return resp.text.strip()


def _call_cohere(model: str, api_key: str, base_url: Optional[str],
                 system: str, user: str, max_tokens: int,
                 json_schema: Optional[dict]) -> str:
    import httpx
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    payload: dict = {
        "model": model or "command-r",
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if json_schema:
        payload["response_format"] = {"type": "json_object"}
    resp = httpx.post(
        (base_url or "https://api.cohere.com") + "/v2/chat",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    try:
        return data["message"]["content"][0]["text"].strip()
    except (KeyError, IndexError, TypeError):
        return data.get("text", "").strip()


# Provider registry: maps provider slug → (adapter_fn, default_base_url, default_model)
_PROVIDERS: dict = {
    "anthropic":   (_call_anthropic,    None,                                          "claude-sonnet-4-6"),
    "openai":      (_call_openai_compat, None,                                         "gpt-4o-mini"),
    "deepseek":    (_call_openai_compat, "https://api.deepseek.com",                   "deepseek-chat"),
    "groq":        (_call_openai_compat, "https://api.groq.com/openai/v1",             "llama-3.3-70b-versatile"),
    "huggingface": (_call_openai_compat, "https://api-inference.huggingface.co/v1/",   "Qwen/Qwen2.5-72B-Instruct"),
    "mistral":     (_call_openai_compat, "https://api.mistral.ai/v1/",                 "mistral-small-latest"),
    "openrouter":  (_call_openai_compat, "https://openrouter.ai/api/v1",               "meta-llama/llama-3.2-3b-instruct:free"),
    "gemini":      (_call_gemini,        None,                                          "gemini-1.5-flash"),
    "cohere":      (_call_cohere,        None,                                          "command-r"),
    # Local providers — no API key required; base_url overrides default
    "ollama":      (_call_openai_compat, None,                                          "llama3.2"),
    "lmstudio":    (_call_openai_compat, None,                                          "local-model"),
}

VALID_PROVIDERS = list(_PROVIDERS.keys())


@dataclass
class LLMClient:
    """
    Provider-agnostic LLM client. Construct once per request via LLMClient.from_settings()
    or LLMClient.from_override().
    """
    provider: str = "ollama"
    model: str = ""
    api_key: str = ""
    base_url: Optional[str] = None
    max_tokens: int = 8192  # thinking models need head-room beyond their CoT pass

    def _resolve_base_url(self) -> Optional[str]:
        if self.base_url:
            url = self.base_url.rstrip("/")
            # Local providers need /v1/ suffix for OpenAI-compat SDK
            if self.provider in ("ollama", "lmstudio"):
                if not url.endswith("/v1"):
                    url = f"{url}/v1"
            return url + "/"
        # Ollama: respect OLLAMA_HOST env
        if self.provider == "ollama":
            host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
            return f"{host.rstrip('/')}/v1/"
        # LM Studio: OpenAI-compat server (see LMSTUDIO_BASE_URL; models router uses same env)
        if self.provider == "lmstudio":
            host = (os.getenv("LMSTUDIO_BASE_URL") or "http://localhost:1234").strip()
            if not host:
                host = "http://localhost:1234"
            return f"{host.rstrip('/')}/v1/"
        _, default_base, _ = _PROVIDERS.get(self.provider, (None, None, None))
        return default_base

    def _resolve_model(self) -> str:
        if self.model:
            return self.model
        _, _, default_model = _PROVIDERS.get(self.provider, (None, None, ""))
        return default_model or ""

    def _resolve_api_key(self) -> str:
        if self.api_key:
            return self.api_key
        # Local providers don't need a real key
        if self.provider in ("ollama", "lmstudio"):
            return "local"
        env_map = {
            "anthropic":   "ANTHROPIC_API_KEY",
            "openai":      "OPENAI_API_KEY",
            "gemini":      "GOOGLE_API_KEY",
            "deepseek":    "DEEPSEEK_API_KEY",
            "groq":        "GROQ_API_KEY",
            "huggingface": "HUGGINGFACE_API_KEY",
            "mistral":     "MISTRAL_API_KEY",
            "openrouter":  "OPENROUTER_API_KEY",
            "cohere":      "COHERE_API_KEY",
        }
        env_key = env_map.get(self.provider, "")
        return os.getenv(env_key, "")

    def complete(self, system: str, user: str, json_schema: Optional[dict] = None) -> str:
        """Call LLM and return raw text response."""
        entry = _PROVIDERS.get(self.provider)
        if not entry:
            raise ValueError(
                f"Unknown provider '{self.provider}'. Valid: {', '.join(VALID_PROVIDERS)}"
            )
        adapter_fn, _, _ = entry
        resolved_model = self._resolve_model()
        # Suppress chain-of-thought for thinking models on structured JSON tasks —
        # they otherwise exhaust max_tokens on reasoning before producing any output.
        effective_system = _suppress_thinking(system, resolved_model)
        return adapter_fn(
            resolved_model,
            self._resolve_api_key(),
            self._resolve_base_url(),
            effective_system, user,
            self.max_tokens,
            json_schema,
        )

    async def complete_async(self, system: str, user: str, json_schema: Optional[dict] = None) -> str:
        """Async wrapper for complete() — offloads sync provider call to a thread.

        Use from async routers (interview.py, jobs_v2.py) to avoid blocking the
        event loop on synchronous HTTP calls in provider adapters.
        """
        return await asyncio.to_thread(self.complete, system, user, json_schema)

    def complete_json(self, system: str, user: str, schema: Optional[dict] = None) -> dict:
        """Call LLM and return parsed JSON dict. Retries once on parse failure."""
        raw = self.complete(system, user, json_schema=schema)
        try:
            return clean_and_parse_json(raw)
        except ValueError:
            repair_prompt = (
                "The following text should be valid JSON but isn't. "
                "Return ONLY the corrected JSON with no extra text:\n\n" + raw[:2000]
            )
            raw2 = self.complete(
                "You are a JSON repair assistant. Output only valid JSON.",
                repair_prompt,
                json_schema=None,
            )
            return clean_and_parse_json(raw2)

    async def complete_json_async(self, system: str, user: str, schema: Optional[dict] = None) -> dict:
        """Async wrapper for complete_json() — offloads sync provider call to a thread."""
        return await asyncio.to_thread(self.complete_json, system, user, schema)

    @classmethod
    def from_settings(cls) -> "LLMClient":
        """Build from app config / environment variables."""
        from backend.config import settings
        return cls(
            provider=settings.llm_provider,
            model=settings.llm_model,
        )

    @classmethod
    def from_override(cls, override: Optional[object], fallback: Optional["LLMClient"] = None) -> "LLMClient":
        """Build from an LLMOverride schema, falling back to from_settings()."""
        base = fallback or cls.from_settings()
        if not override:
            return base
        return cls(
            provider=getattr(override, "llm_provider", None) or base.provider,
            model=getattr(override, "llm_model", None) or base.model,
            api_key=getattr(override, "llm_api_key", None) or base.api_key,
            base_url=getattr(override, "llm_base_url", None) or base.base_url,
            max_tokens=base.max_tokens,
        )
