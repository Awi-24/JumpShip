"""
Model capability validator for Ollama and cloud LLM providers.

Checks whether a model supports vision (image input) and function calling (tools).
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

# ── Vision model name hints ───────────────────────────────────────────────────
_VISION_NAME_HINTS = (
    "llava", "moondream", "minicpm", "bakllava", "vision",
    "cogvlm", "qwen-vl", "phi-3-v", "gemma3",
)

# ── Tool-capable model name hints ─────────────────────────────────────────────
_TOOLS_NAME_HINTS = (
    "llama3", "qwen2", "qwen2.5", "mistral", "mixtral",
    "phi3", "command-r", "gemma", "deepseek",
)


async def check_ollama_model(model: str, base_url: str) -> dict:
    """
    Check Ollama model capabilities by querying /api/show.

    Returns a dict with keys:
      available, vision, tools, parameters, family, error
    """
    payload = {"name": model}

    candidates = [base_url]
    if "localhost" in base_url or "127.0.0.1" in base_url:
        fallback = (
            base_url
            .replace("localhost", "host.docker.internal")
            .replace("127.0.0.1", "host.docker.internal")
        )
        if fallback not in candidates:
            candidates.append(fallback)

    last_error: str = ""
    for base in candidates:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(f"{base.rstrip('/')}/api/show", json=payload)
                r.raise_for_status()
                data: dict[str, Any] = r.json()

                details = data.get("details", {})
                families: list[str] = details.get("families") or []
                capabilities: list[str] = data.get("capabilities") or []
                parameters: str = data.get("parameters", "")
                family: str = details.get("family", "")

                model_lower = model.lower()
                vision = (
                    "clip" in [f.lower() for f in families]
                    or any(h in model_lower for h in _VISION_NAME_HINTS)
                )
                tools = (
                    "tools" in [c.lower() for c in capabilities]
                    or any(h in model_lower for h in _TOOLS_NAME_HINTS)
                )

                return {
                    "available": True,
                    "vision": vision,
                    "tools": tools,
                    "parameters": parameters,
                    "family": family,
                    "error": None,
                }
        except httpx.HTTPStatusError as exc:
            last_error = f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        except Exception as exc:
            last_error = str(exc)

    return {
        "available": False,
        "vision": False,
        "tools": False,
        "parameters": "",
        "family": "",
        "error": last_error or "Ollama unreachable",
    }


async def list_ollama_models(base_url: str) -> list[dict]:
    """
    List all models from Ollama /api/tags and check capabilities for each.

    Returns a list of dicts: {name, capabilities: {available, vision, tools, ...}}
    """
    candidates = [base_url]
    if "localhost" in base_url or "127.0.0.1" in base_url:
        fallback = (
            base_url
            .replace("localhost", "host.docker.internal")
            .replace("127.0.0.1", "host.docker.internal")
        )
        if fallback not in candidates:
            candidates.append(fallback)

    for base in candidates:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{base.rstrip('/')}/api/tags")
                r.raise_for_status()
                data = r.json()
                model_list = data.get("models") or []

                results = []
                for m in model_list:
                    name = m.get("name", "")
                    caps = await check_ollama_model(name, base)
                    results.append({"name": name, "capabilities": caps})
                return results
        except Exception:
            continue

    return []


def check_cloud_provider_capabilities(provider: str, model: str) -> dict:
    """
    Return known capabilities for cloud / non-Ollama providers.

    Anthropic and OpenAI current flagship models always support vision + tools.
    Groq vision support depends on model name.
    """
    provider_lower = provider.lower()
    model_lower = model.lower()

    if provider_lower == "anthropic":
        return {
            "available": True,
            "vision": True,
            "tools": True,
            "parameters": "",
            "family": "claude",
            "error": None,
        }

    if provider_lower == "openai":
        return {
            "available": True,
            "vision": True,
            "tools": True,
            "parameters": "",
            "family": "gpt",
            "error": None,
        }

    if provider_lower == "groq":
        vision = any(h in model_lower for h in ("vision", "llava", "llama-3.2"))
        tools = any(h in model_lower for h in ("llama3", "llama-3", "mixtral", "gemma", "qwen"))
        return {
            "available": True,
            "vision": vision,
            "tools": tools,
            "parameters": "",
            "family": "groq",
            "error": None,
        }

    if provider_lower in ("lmstudio", "openclaw"):
        vision = any(h in model_lower for h in _VISION_NAME_HINTS)
        tools = any(h in model_lower for h in _TOOLS_NAME_HINTS)
        return {
            "available": True,
            "vision": vision,
            "tools": tools,
            "parameters": "",
            "family": provider_lower,
            "error": None,
        }

    return {
        "available": False,
        "vision": False,
        "tools": False,
        "parameters": "",
        "family": "",
        "error": f"Unknown provider: {provider}",
    }
