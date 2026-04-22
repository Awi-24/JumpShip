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
from fastapi import APIRouter
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
            clean = base_url.rstrip("/")
            if clean.endswith("/v1"):
                clean = clean[:-3]
            r = await client.get(f"{clean}/v1/models")
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


# ── Public helpers (used by /api/models/discover and the UI) ──────────────────

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

@router.get("/api/models/discover", response_model=DiscoverResponse)
async def discover_models():
    """Probe local LLM providers and return all discovered models."""
    from backend.config import settings
    providers = await discover_providers()
    return DiscoverResponse(
        providers=providers,
        active_provider=settings.llm_provider,
        active_model=settings.llm_model,
    )


