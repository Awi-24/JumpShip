"""
JumpShip — Ollama LLM service.

Used by the health endpoint only. All LLM calls now go through LLMClient.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class LLMService:
    """Thin Ollama wrapper used by health checks and the AI evaluator."""

    def __init__(self, provider: str = "ollama", model: str = "", **kwargs: Any):
        import os
        self.provider = provider
        self.model    = model
        self.ollama_base_url = (
            kwargs.get("ollama_base_url")
            or os.getenv("OLLAMA_HOST")
            or os.getenv("OLLAMA_BASE_URL")
            or "http://localhost:11434"
        )

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        """Send a single completion to Ollama and return the response text."""
        url     = f"{self.ollama_base_url}/api/generate"
        payload = {
            "model":  self.model,
            "prompt": user_prompt,
            "system": system_prompt,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                return r.json().get("response", "")
        except httpx.ConnectError:
            raise RuntimeError(
                f"Cannot connect to Ollama at {self.ollama_base_url}. "
                "Make sure Ollama is running: ollama serve"
            )
        except httpx.TimeoutException:
            raise TimeoutError(
                f"Ollama timed out (model='{self.model}'). "
                "The model may still be loading into VRAM. Check: nvidia-smi"
            )

    async def is_available(self) -> bool:
        """Return True if Ollama is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self.ollama_base_url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False


def get_llm_service() -> LLMService:
    """Factory used by the health endpoint."""
    from backend.config import settings
    return LLMService(
        provider         = "ollama",
        model            = settings.llm_model,
        ollama_base_url  = settings.ollama_base_url,
    )
