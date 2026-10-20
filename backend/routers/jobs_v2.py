"""
JumpShip v2 — Job search and assessment endpoints.
POST /api/jobs/search  → list of JobResult
POST /api/jobs/assess  → JobAssessment
GET  /api/ollama/models → list[str]
GET  /api/groq/models   → list[str]  (requires api_key query param)
"""
from __future__ import annotations

import json
import logging

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from backend.prompts import load, render
from backend.models.schemas import (
    JobSearchRequest,
    JobResult,
    AssessmentRequest,
    BatchAssessmentRequest,
    BatchAssessmentItem,
    JobAssessment,
)
from backend.services.job_scraper_v2 import search_jobs
from backend.services.llm_service import get_llm_service
from backend.services.llm_client import (
    LLMClient, clean_and_parse_json, get_local_sem, is_local_provider, needs_semaphore, _strip_fences,
)
from backend.services.web_search import search_company_info

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs-v2"])

# ── Model discovery ────────────────────────────────────────────────────────────

@router.get("/api/ollama/models", response_model=list[str])
async def ollama_models(
    base_url: str = Query(default=None, description="Override base URL"),
    provider: str = Query(default="ollama", description="ollama | lmstudio"),
):
    """Return available models for Ollama or LM Studio.

    Ollama: merges /api/tags (installed) + /api/ps (currently running, catches
    cloud models like gemma4:31b-cloud that are active but not locally stored).
    LM Studio: /v1/models as-is.
    """
    from backend.config import settings
    url = (base_url or settings.ollama_base_url).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            if provider == "lmstudio":
                clean = url.rstrip("/")
                if clean.endswith("/v1"):
                    clean = clean[:-3]
                r = await client.get(f"{clean}/v1/models")
                r.raise_for_status()
                data = r.json().get("data", [])
                return [m["id"] for m in data if m.get("id")]
            else:
                seen: set[str] = set()
                result: list[str] = []

                # Installed models: filter size > 0 to exclude registry catalog entries
                # (Ollama newer versions include undownloaded models with size=0)
                try:
                    r = await client.get(f"{url}/api/tags")
                    r.raise_for_status()
                    for m in r.json().get("models", []):
                        name = m.get("name", "")
                        if name and m.get("size", 0) > 0 and name not in seen:
                            seen.add(name)
                            result.append(name)
                except Exception as exc:
                    logger.warning("Ollama /api/tags failed (%s): %s", url, exc)

                # Currently running models (includes cloud models active right now)
                try:
                    r = await client.get(f"{url}/api/ps")
                    if r.status_code == 200:
                        for m in r.json().get("models", []):
                            name = m.get("name", "")
                            if name and name not in seen:
                                seen.add(name)
                                result.append(name)
                except Exception as exc:
                    logger.debug("Ollama /api/ps best-effort failed: %s", exc)

                return result
    except Exception as exc:
        logger.warning("Could not fetch models (%s) from %s: %s", provider, url, exc)
        return []


@router.get("/api/groq/models", response_model=list[str])
async def groq_models(
    api_key: str = Query(default="", description="Groq API key"),
):
    """Proxy Groq's /v1/models endpoint and return available model IDs."""
    if not api_key:
        return _GROQ_FALLBACK_MODELS
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            r.raise_for_status()
            models = r.json().get("data", [])
            return sorted(m["id"] for m in models if isinstance(m, dict) and m.get("id"))
    except Exception as exc:
        logger.warning("Could not fetch Groq models: %s", exc)
        return _GROQ_FALLBACK_MODELS

class TestLLMRequest(BaseModel):
    provider: str
    base_url: str = ""
    model: str = ""
    api_key: str = ""


class TestLLMResponse(BaseModel):
    ok: bool
    message: str
    resolved_url: str = ""


@router.post("/api/test-llm", response_model=TestLLMResponse)
async def test_llm_connection(req: TestLLMRequest):
    """
    Test the user-supplied LLM configuration and return a clear pass/fail message.
    For Ollama: tries the given URL and common fallback addresses so we can
    report which one actually works (helps Linux/Ubuntu users debug IP issues).
    """
    from backend.config import settings

    if req.provider in ("ollama", "lmstudio", "openclaw"):
        import os
        # Build candidate URLs to try in order.
        # Priority: user-supplied URL > server env var > localhost default.
        raw = (req.base_url or settings.ollama_base_url).rstrip("/")
        candidates = [raw]

        # If the user typed localhost, also try the explicit IPv4 address
        # because on Linux 'localhost' may resolve to ::1 (IPv6) while Ollama
        # only binds to 127.0.0.1 (IPv4).
        if "localhost" in raw:
            candidates.append(raw.replace("localhost", "127.0.0.1"))
        # And vice-versa
        if "127.0.0.1" in raw:
            candidates.append(raw.replace("127.0.0.1", "localhost"))

        # When running inside Docker, also try host.docker.internal (reaches the
        # host machine where Ollama is likely running).
        port = raw.split(":")[-1] if ":" in raw else "11434"
        docker_url = f"http://host.docker.internal:{port}"
        if docker_url not in candidates and "host.docker.internal" not in raw:
            candidates.append(docker_url)

        # If the server config already resolved a different URL (e.g. host.docker.internal),
        # ensure it's also tried even if the user sent the default localhost URL.
        server_url = settings.ollama_base_url.rstrip("/")
        if server_url not in candidates:
            candidates.append(server_url)

        last_error = ""
        async with httpx.AsyncClient(timeout=4) as client:
            for url in candidates:
                try:
                    clean = url.rstrip("/")
                    if req.provider == "lmstudio":
                        # Strip /v1 suffix if present — probe at base
                        base = clean[:-3] if clean.endswith("/v1") else clean
                        r = await client.get(f"{base}/v1/models")
                        if r.status_code == 200:
                            data = r.json().get("data", r.json().get("models", []))
                            models = [m.get("id", "") for m in data if m.get("id")]
                            model_hint = f" ({len(models)} model{'s' if len(models) != 1 else ''} loaded)" if models else " (no models loaded)"
                            return TestLLMResponse(
                                ok=True,
                                message=f"Connected to LM Studio{model_hint}",
                                resolved_url=url,
                            )
                    else:
                        r = await client.get(f"{clean}/api/tags")
                        if r.status_code == 200:
                            models = [m["name"] for m in r.json().get("models", [])]
                            model_hint = f" ({len(models)} model{'s' if len(models) != 1 else ''} installed)" if models else " (no models installed yet)"
                            return TestLLMResponse(
                                ok=True,
                                message=f"Connected to {req.provider}{model_hint}",
                                resolved_url=url,
                            )
                    last_error = f"HTTP {r.status_code}"
                except httpx.ConnectError:
                    last_error = "Connection refused"
                except httpx.TimeoutException:
                    last_error = "Timed out"
                except Exception as exc:
                    last_error = str(exc)[:80]

        tried = ", ".join(candidates)
        hint = ""
        if "Connection refused" in last_error:
            hint = (
                f" — Is {req.provider} running? On Linux run: "
                f"`OLLAMA_HOST=0.0.0.0 ollama serve` so it binds to all interfaces. "
                f"Docker: set OLLAMA_BASE_URL=http://host.docker.internal:11434 in your .env"
            )
        return TestLLMResponse(
            ok=False,
            message=f"Could not reach {req.provider} at [{tried}]: {last_error}{hint}",
        )

    elif req.provider == "openai":
        if not req.api_key:
            return TestLLMResponse(ok=False, message="OpenAI API key is required.")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {req.api_key}"},
                )
                if r.status_code == 200:
                    return TestLLMResponse(ok=True, message="OpenAI key is valid.")
                return TestLLMResponse(ok=False, message=f"OpenAI rejected the key: HTTP {r.status_code}")
        except Exception as exc:
            return TestLLMResponse(ok=False, message=f"OpenAI unreachable: {exc}")

    elif req.provider == "anthropic":
        if not req.api_key:
            return TestLLMResponse(ok=False, message="Anthropic API key is required.")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={"x-api-key": req.api_key, "anthropic-version": "2023-06-01"},
                )
                if r.status_code in (200, 401):
                    ok = r.status_code == 200
                    return TestLLMResponse(ok=ok, message="Anthropic key is valid." if ok else "Anthropic rejected the key — check it and retry.")
                return TestLLMResponse(ok=False, message=f"Anthropic returned HTTP {r.status_code}")
        except Exception as exc:
            return TestLLMResponse(ok=False, message=f"Anthropic unreachable: {exc}")

    elif req.provider == "groq":
        if not req.api_key:
            return TestLLMResponse(ok=False, message="Groq API key is required.")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {req.api_key}"},
                )
                if r.status_code == 200:
                    return TestLLMResponse(ok=True, message="Groq key is valid.")
                return TestLLMResponse(ok=False, message=f"Groq rejected the key: HTTP {r.status_code}")
        except Exception as exc:
            return TestLLMResponse(ok=False, message=f"Groq unreachable: {exc}")

    return TestLLMResponse(ok=False, message=f"Unknown provider: {req.provider}")


_GROQ_FALLBACK_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.2-90b-vision-preview",
    "llama-3.2-11b-vision-preview",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
]


# ── Job endpoints ─────────────────────────────────────────────────────────────

_jobs_router = APIRouter(prefix="/api/jobs")


def _llm_from_request(req) -> LLMClient:
    """Build an LLMClient from per-request overrides, falling back to .env defaults."""
    return LLMClient.from_override(req)


@_jobs_router.post("/search", response_model=list[JobResult])
async def search_jobs_endpoint(req: JobSearchRequest, response: Response):
    """Search for jobs using python-jobspy + extra sources and return structured results.

    Per-source outcome is returned in the X-Source-Status header:
    JSON {site: {"count": int, "error": str | null}} (ASCII-escaped).
    """
    if not req.keywords:
        raise HTTPException(status_code=400, detail="At least one keyword is required.")
    try:
        status: dict = {}
        results = await search_jobs(
            keywords=req.keywords,
            location=req.location,
            job_type=req.job_type,
            sites=req.sites,
            results_wanted=req.results_wanted,
            hours_old=req.hours_old,
            work_mode=req.work_mode,
            status_out=status,
        )
        response.headers["X-Source-Status"] = json.dumps(status)
        return [JobResult(**r) for r in results]
    except Exception as exc:
        logger.error("Job search failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Search failed: {exc}")


_ASSESS_SYSTEM = load("assess_system")


def _build_assess_user(profile, job, company_context: str) -> str:
    return render(
        "assess_user",
        name=profile.name or "Unknown",
        title=profile.title,
        experience_years=profile.experience_years,
        skills=', '.join(profile.skills[:20]) if profile.skills else 'Not specified',
        domains=', '.join(profile.domains) if profile.domains else 'Not specified',
        resume_extract=profile.raw_text[:1500] if profile.raw_text else 'Not available',
        job_title=job.title,
        company=job.company,
        location=job.location,
        salary=job.salary_range if job.salary_range else 'NOT DISCLOSED — estimate from market data',
        site=job.site,
        description=job.description[:2500] if job.description else 'No description available.',
        company_context=company_context,
    )


async def _run_assessment(llm: LLMClient, profile, job, include_company_research: bool) -> JobAssessment:
    """Core assessment logic — acquires local semaphore if needed."""
    import asyncio
    from backend.config import settings as app_settings

    company_info = ""
    if include_company_research and job.company:
        try:
            company_info = await search_company_info(job.company, job.title)
        except Exception as exc:
            logger.debug("Company web search failed (non-fatal): %s", exc)

    company_context = (
        "\n" + render(
            "assess_company_context",
            company_info=company_info or 'No external data found. Use your training knowledge about this company if available.',
        ) + "\n"
        if include_company_research else ""
    )

    user = _build_assess_user(profile, job, company_context)

    if needs_semaphore(llm.provider, llm._resolve_model()):
        async with get_local_sem():
            raw_response = await asyncio.to_thread(llm.complete, _ASSESS_SYSTEM, user)
    else:
        raw_response = await asyncio.to_thread(llm.complete, _ASSESS_SYSTEM, user)

    # Unparseable output raises (ValueError): the batch endpoint reports it per item,
    # the single endpoint returns 500 — never a fake score that would pollute ranking.
    assessment = JobAssessment(**clean_and_parse_json(raw_response))
    assessment.resume_generation_triggered = (
        assessment.match_score >= app_settings.resume_gen_threshold
        and assessment.is_relevant
    )
    return assessment


@_jobs_router.post("/assess", response_model=JobAssessment)
async def assess_job_endpoint(req: AssessmentRequest):
    """Assess candidate fit for a single job. Local LLM calls are serialized via semaphore."""
    llm = _llm_from_request(req)
    try:
        return await _run_assessment(llm, req.resume_profile, req.job, req.include_company_research)
    except Exception as exc:
        logger.error("Assessment endpoint error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Assessment failed: {exc}")


@_jobs_router.post("/assess-batch", response_model=list[BatchAssessmentItem])
async def assess_batch_endpoint(req: BatchAssessmentRequest):
    """
    Assess multiple jobs concurrently.
    Cloud providers: all run in parallel.
    Local providers: serialized via semaphore (no GPU contention).
    """
    import asyncio

    llm = _llm_from_request(req)

    async def _assess_one(job: JobResult) -> BatchAssessmentItem:
        try:
            result = await _run_assessment(llm, req.resume_profile, job, req.include_company_research)
            return BatchAssessmentItem(job_id=job.id, assessment=result)
        except Exception as exc:
            logger.warning("Batch assess failed for job %s: %s", job.id, exc)
            return BatchAssessmentItem(job_id=job.id, error=str(exc))

    results = await asyncio.gather(*[_assess_one(job) for job in req.jobs])
    return list(results)


class SynonymRequest(BaseModel):
    keywords: list[str]
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None


@_jobs_router.post("/suggest-keywords")
async def suggest_keywords(req: SynonymRequest):
    """Use the LLM to suggest related keywords/synonyms for better search coverage."""
    if not req.keywords:
        return {"suggestions": []}

    llm = _llm_from_request(req)

    system = load("suggest_keywords_system")
    user = render("suggest_keywords_user", keywords=', '.join(req.keywords))

    try:
        import asyncio
        raw = await asyncio.to_thread(llm.complete, system, user)
        suggestions = json.loads(_strip_fences(raw))
        if isinstance(suggestions, list):
            input_lower = {k.lower() for k in req.keywords}
            suggestions = [s for s in suggestions if isinstance(s, str) and s.lower() not in input_lower]
            return {"suggestions": suggestions[:10]}
    except Exception as exc:
        logger.warning("Keyword suggestion failed: %s", exc)

    return {"suggestions": []}


class TranslateRequest(BaseModel):
    keywords: list[str]
    target_language: str = "pt"  # default to Portuguese
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None


@_jobs_router.post("/translate-keywords")
async def translate_keywords(req: TranslateRequest):
    """Translate keywords to another language for broader job board coverage."""
    if not req.keywords:
        return {"translations": []}

    llm = _llm_from_request(req)
    lang_map = {"pt": "Portuguese", "en": "English", "de": "German", "es": "Spanish", "fr": "French"}
    lang_name = lang_map.get(req.target_language, req.target_language)

    system = load("translate_keywords_system")
    user = render("translate_keywords_user", language=lang_name, keywords=', '.join(req.keywords))

    try:
        import asyncio
        raw = await asyncio.to_thread(llm.complete, system, user)
        translations = json.loads(_strip_fences(raw))
        if isinstance(translations, list):
            return {"translations": [t for t in translations if isinstance(t, str)][:20]}
    except Exception as exc:
        logger.warning("Keyword translation failed: %s", exc)

    return {"translations": []}
