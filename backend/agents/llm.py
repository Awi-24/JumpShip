"""
JumpShip V2 — LangGraph LLM factory.

Returns a ChatOllama instance bound to the configured model.
All agent graphs import from here so the model is configured in one place.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from backend.config import settings


def get_llm(
    model: str | None = None,
    base_url: str | None = None,
    temperature: float = 0.0,
    *,
    tools: bool = True,
    provider: str | None = None,
) -> Any:
    """
    Return a LangChain ChatModel instance for the given provider.

    Args:
        model:       Override model name (defaults to settings.llm_model).
        base_url:    Override base URL (provider-specific).
        temperature: Sampling temperature (0 = deterministic).
        tools:       If True, configure for tool/function calling.
        provider:    Override provider (defaults to settings.llm_provider).
    """
    resolved_provider = provider or settings.llm_provider or "ollama"
    resolved_model    = model    or settings.llm_model
    
    # Common kwargs
    common = {
        "temperature": temperature,
        "max_retries": 2,
    }

    if resolved_provider == "ollama":
        from langchain_ollama import ChatOllama
        resolved_base = base_url or settings.ollama_base_url or "http://localhost:11434"
        return ChatOllama(
            model=resolved_model,
            base_url=resolved_base,
            num_ctx=8192,
            **common
        )

    elif resolved_provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=resolved_model,
            api_key=os.getenv("OPENAI_API_KEY"),
            **common
        )

    elif resolved_provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model_name=resolved_model,
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            **common
        )

    elif resolved_provider == "gemini" or resolved_provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=resolved_model,
            api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"),
            **common
        )

    elif resolved_provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            model_name=resolved_model,
            api_key=os.getenv("GROQ_API_KEY"),
            **common
        )

    else:
        # Fallback to Ollama or raise
        raise ValueError(f"Unsupported LLM provider for LangGraph: {resolved_provider}")


@lru_cache(maxsize=4)
def get_llm_cached(model: str, base_url: str, provider: str = "ollama") -> Any:
    """Cached variant — reuse the same ChatOllama object across repeated calls."""
    return get_llm(model=model, base_url=base_url, provider=provider)
