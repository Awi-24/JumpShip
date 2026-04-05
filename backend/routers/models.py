"""
JumpShip — Unified model discovery endpoint.

Probes all reachable local LLM providers (Ollama, LM Studio, OpenClaw) in
parallel and returns a single response describing what is available.

GET /api/models/discover  → { providers: [...], active_provider, active_model }
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])


# ── Response schemas ──────────────────────────────────────────────────────────

class DiscoveredModel(BaseModel):
    id: str
    name: str
    size_gb: Optional[float] = None
    family: Optional[str] = None

class DiscoveredProvider(BaseModel):
    id: str
    name: str
    reachable: bool
    base_url: str
    models: list[DiscoveredModel] = []

class DiscoverResponse(BaseModel):
    providers: list[DiscoveredProvider]
    active_provider: Optional[str] = None
    active_model: Optional[str] = None


# ── Provider probing ──────────────────────────────────────────────────────────

_PROBE_TIMEOUT = 3

async def _probe_ollama(base_url: str, provider_id: str, provider_name: str) -> DiscoveredProvider:
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT) as client:
            r = await client.get(f"{base_url.rstrip('/')}/api/tags")
            r.raise_for_status()
            raw_models = r.json().get("models", [])
            models = []
            for m in raw_models:
                size_bytes = m.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 1) if size_bytes else None
                details = m.get("details", {})
                models.append(DiscoveredModel(
                    id=m.get("name", m.get("model", "")),
                    name=m.get("name", m.get("model", "")),
                    size_gb=size_gb,
                    family=details.get("family"),
                ))
            return DiscoveredProvider(
                id=provider_id, name=provider_name,
                reachable=True, base_url=base_url, models=models,
            )
    except Exception as exc:
        logger.debug("Probe %s at %s failed: %s", provider_id, base_url, exc)
        return DiscoveredProvider(
            id=provider_id, name=provider_name,
            reachable=False, base_url=base_url,
        )


async def _probe_lmstudio(base_url: str) -> DiscoveredProvider:
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT) as client:
            r = await client.get(f"{base_url.rstrip('/')}/api/v1/models")
            r.raise_for_status()
            data = r.json().get("data", r.json().get("models", []))
            models = []
            for m in data:
                model_id = m.get("id", "")
                size_bytes = m.get("size_bytes", 0)
                size_gb = round(size_bytes / (1024 ** 3), 1) if size_bytes else None
                models.append(DiscoveredModel(
                    id=model_id,
                    name=m.get("display_name", model_id),
                    size_gb=size_gb,
                    family=m.get("architecture"),
                ))
            return DiscoveredProvider(
                id="lmstudio", name="LM Studio",
                reachable=True, base_url=base_url, models=models,
            )
    except Exception as exc:
        logger.debug("Probe LM Studio at %s failed: %s", base_url, exc)
        return DiscoveredProvider(
            id="lmstudio", name="LM Studio",
            reachable=False, base_url=base_url,
        )


# ── Public helpers (used by orchestrator) ─────────────────────────────────────

async def discover_providers() -> list[DiscoveredProvider]:
    """Probe all local providers and return what is reachable."""
    from backend.config import settings

    ollama_url = settings.ollama_base_url
    lmstudio_url = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234")

    results = await asyncio.gather(
        _probe_ollama(ollama_url, "ollama", "Ollama"),
        _probe_lmstudio(lmstudio_url),
        return_exceptions=True,
    )

    providers = []
    for r in results:
        if isinstance(r, DiscoveredProvider):
            providers.append(r)
        elif isinstance(r, Exception):
            logger.warning("Provider probe raised: %s", r)
    return providers


# ── Endpoint ──────────────────────────────────────────────────────────────────

class ReadinessResponse(BaseModel):
    ready: bool
    error: Optional[str] = None
    warning: Optional[str] = None
    latency_ms: int = 0
    provider: Optional[str] = None
    model: Optional[str] = None


@router.get("/api/models/discover", response_model=DiscoverResponse)
async def discover_models(request: Request):
    """Probe local LLM providers and return all discovered models."""
    providers = await discover_providers()

    active_provider = None
    active_model = None
    orc = getattr(request.app.state, "orchestrator", None)
    if orc and orc.llm_config:
        active_provider = orc.llm_config.get("provider")
        active_model = orc.llm_config.get("model")

    return DiscoverResponse(
        providers=providers,
        active_provider=active_provider,
        active_model=active_model,
    )


@router.get("/api/models/check-ready", response_model=ReadinessResponse)
async def check_model_ready(request: Request):
    """
    Test whether the currently selected model can handle tool-calling.
    Sends a tiny test prompt and verifies the model responds with a tool call.
    """
    from backend.services.llm_service import LLMService
    from backend.config import settings

    orc = getattr(request.app.state, "orchestrator", None)
    cfg = orc.llm_config if orc else {}

    provider = cfg.get("provider") or settings.llm_provider
    model = cfg.get("model") or settings.llm_model

    if not provider or not model:
        return ReadinessResponse(
            ready=False,
            error="No model configured. Select a model first.",
            provider=provider,
            model=model,
        )

    llm = LLMService(
        provider=provider,
        model=model,
        ollama_base_url=cfg.get("base_url") or settings.ollama_base_url,
        openai_api_key=cfg.get("api_key") if provider == "openai" else settings.openai_api_key,
        anthropic_api_key=cfg.get("api_key") if provider == "anthropic" else settings.anthropic_api_key,
        groq_api_key=cfg.get("api_key") if provider == "groq" else settings.groq_api_key,
    )

    result = await llm.check_agent_ready()
    return ReadinessResponse(
        ready=result.get("ready", False),
        error=result.get("error"),
        warning=result.get("warning"),
        latency_ms=result.get("latency_ms", 0),
        provider=provider,
        model=model,
    )
