"""
JumpShip — Unified LLM abstraction layer.
Supports Ollama (primary), OpenAI, Anthropic, Groq.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class LLMService:
    """Unified LLM service that routes to the configured provider."""

    def __init__(self, provider: str, model: str, **kwargs: Any):
        self.provider = provider
        self.model = model
        self.ollama_base_url = kwargs.get("ollama_base_url", "http://localhost:11434")
        self.openai_api_key = kwargs.get("openai_api_key", "")
        self.anthropic_api_key = kwargs.get("anthropic_api_key", "")
        self.groq_api_key = kwargs.get("groq_api_key", "")

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        """Send a completion request to the configured LLM and return the text response."""
        if self.provider in ("ollama", "openclaw", "lmstudio"):
            return await self._ollama_complete(system_prompt, user_prompt)
        elif self.provider == "openai":
            return await self._openai_complete(system_prompt, user_prompt)
        elif self.provider == "anthropic":
            return await self._anthropic_complete(system_prompt, user_prompt)
        elif self.provider == "groq":
            return await self._groq_complete(system_prompt, user_prompt)
        else:
            raise ValueError(f"Unknown LLM provider: {self.provider}")

    async def is_available(self) -> bool:
        """Check if the LLM backend is reachable."""
        try:
            if self.provider in ("ollama", "openclaw", "lmstudio"):
                candidates = [self.ollama_base_url]
                if "localhost" in self.ollama_base_url or "127.0.0.1" in self.ollama_base_url:
                    fallback = self.ollama_base_url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
                    if fallback not in candidates:
                        candidates.append(fallback)
                for base in candidates:
                    try:
                        async with httpx.AsyncClient(timeout=5) as client:
                            r = await client.get(f"{base.rstrip('/')}/api/tags")
                            if r.status_code == 200:
                                return True
                    except Exception:
                        continue
                return False
            elif self.provider == "openai":
                return bool(self.openai_api_key)
            elif self.provider == "anthropic":
                return bool(self.anthropic_api_key)
            elif self.provider == "groq":
                return bool(self.groq_api_key)
        except Exception:
            return False
        return False

    # ── Ollama / local ───────────────────────────────────────────────────────

    async def _ollama_complete(self, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            "prompt": user,
            "system": system,
            "stream": False,
        }
        # Build list of candidate base-URLs to try.
        # On Linux Docker, localhost:11434 resolves to the container itself — not the host.
        # host.docker.internal is mapped to the host gateway via extra_hosts in docker-compose.
        candidates = [self.ollama_base_url]
        if "localhost" in self.ollama_base_url or "127.0.0.1" in self.ollama_base_url:
            fallback = self.ollama_base_url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
            if fallback not in candidates:
                candidates.append(fallback)

        last_exc: Exception | None = None
        for base in candidates:
            url = f"{base.rstrip('/')}/api/generate"
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    r = await client.post(url, json=payload)
                    r.raise_for_status()
                    return r.json().get("response", "")
            except Exception as exc:
                logger.debug("Ollama attempt failed for %s: %s", base, exc)
                last_exc = exc

        raise last_exc or RuntimeError("Ollama unreachable on all candidate URLs")

    # ── OpenAI ───────────────────────────────────────────────────────────────

    async def _openai_complete(self, system: str, user: str) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.openai_api_key}"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    # ── Anthropic ────────────────────────────────────────────────────────────

    async def _anthropic_complete(self, system: str, user: str) -> str:
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self.model,
            "max_tokens": 2048,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            return data["content"][0]["text"]

    # ── Groq ─────────────────────────────────────────────────────────────────

    async def _groq_complete(self, system: str, user: str) -> str:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.groq_api_key}"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]


def get_llm_service() -> LLMService:
    """Factory that creates an LLMService from the current settings."""
    from backend.config import settings

    return LLMService(
        provider=settings.llm_provider,
        model=settings.llm_model,
        ollama_base_url=settings.ollama_base_url,
        openai_api_key=settings.openai_api_key,
        anthropic_api_key=settings.anthropic_api_key,
        groq_api_key=settings.groq_api_key,
    )
