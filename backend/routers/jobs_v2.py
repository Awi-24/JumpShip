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
import re

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

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
from backend.services.llm_client import LLMClient, get_local_sem, is_local_provider
from backend.services.web_search import search_company_info

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs-v2"])

# ── Model discovery ────────────────────────────────────────────────────────────

@router.get("/api/ollama/models", response_model=list[str])
async def ollama_models(
    base_url: str = Query(default=None, description="Override base URL"),
    provider: str = Query(default="ollama", description="ollama | lmstudio"),
):
    """Return available models for Ollama or LM Studio."""
    from backend.config import settings
    url = (base_url or settings.ollama_base_url).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            if provider == "lmstudio":
                # LM Studio exposes OpenAI-compatible /v1/models
                # Strip /v1 suffix if user already included it, then add it once
                clean = url.rstrip("/")
                if clean.endswith("/v1"):
                    clean = clean[:-3]
                r = await client.get(f"{clean}/v1/models")
                r.raise_for_status()
                data = r.json().get("data", [])
                return [m["id"] for m in data if m.get("id")]
            else:
                # Ollama native API
                r = await client.get(f"{url}/api/tags")
                r.raise_for_status()
                return [m["name"] for m in r.json().get("models", [])]
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
async def search_jobs_endpoint(req: JobSearchRequest):
    """Search for jobs using python-jobspy + extra sources and return structured results."""
    if not req.keywords:
        raise HTTPException(status_code=400, detail="At least one keyword is required.")
    try:
        results = await search_jobs(
            keywords=req.keywords,
            location=req.location,
            job_type=req.job_type,
            sites=req.sites,
            results_wanted=req.results_wanted,
        )
        return [JobResult(**r) for r in results]
    except Exception as exc:
        logger.error("Job search failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Search failed: {exc}")


_ASSESS_SYSTEM = """\
You are a blunt, experienced Technical Recruiter. Your value is calibrated accuracy — not encouragement.
Candidates use your assessment to decide whether to apply or move on. Inflated scores waste their time.

SCORING RULES (enforce strictly — do not round to comfortable numbers):
  90-100 = near-perfect; candidate would likely pass every round as-is
  70-89  = strong fit, minor gaps
  50-69  = borderline; notable gaps — name them plainly
  0-49   = significant mismatch — be specific about what's missing
  0      = always when is_relevant is FALSE

HIRE RECOMMENDATION (mandatory — commit to a position):
  strong_yes = 85+ with no blocking gaps
  yes        = 70-84
  borderline = 50-69
  no         = 30-49
  strong_no  = below 30 OR blocking disqualifier (wrong field, required clearance/visa not held)

FIELD RULES:
- is_relevant: FALSE only if categorically different profession. Tangential roles = TRUE. Low score ≠ irrelevant.
- summary: First sentence MUST be the verdict ("This is a strong match." / "This is a weak match — candidate lacks X and Y."). \
  Then 1-2 sentences of specifics. No hedging, no softening.
- strong_points: Cite specific evidence from both resume AND job description. No generic praise ("team player", "fast learner").
- gaps: List every material gap plainly. Phrase "could benefit from" is banned. State gaps directly. If no gaps, say so.
- career_suggestions: Concrete, actionable. Not "consider improving soft skills" or "continue learning."
- company_insights: Use provided web intelligence first. If none, use training knowledge. \
  If unknown: "Limited public data on this company." Never fabricate specifics.
- income_range: Disclosed = exact value + "(disclosed)". Not disclosed = market estimate + "(estimated)". Never blank.
- job_tags: 3-8 lowercase tags describing the JOB: tech stack, domain, seniority, work mode. 1-2 words each.

ANTI-PATTERNS (these will invalidate your assessment):
- Using "transferable skills" without naming which skill transfers and exactly how
- Giving 70+ to a candidate missing a stated core requirement
- Softening a gap with "while the candidate doesn't have X, they have Y"
- Scores ending in 0 or 5 when evidence doesn't support a round number
- Any sentence that begins with "While" to pivot away from a negative

CRITICAL: Return ONLY valid JSON — no markdown, no explanation, no trailing text."""


def _build_assess_user(profile, job, company_context: str) -> str:
    return f"""\
CANDIDATE PROFILE:
Name: {profile.name or "Unknown"}
Current Title: {profile.title}
Experience: {profile.experience_years} year(s) of professional experience
Core Skills: {', '.join(profile.skills[:20]) if profile.skills else 'Not specified'}
Domains: {', '.join(profile.domains) if profile.domains else 'Not specified'}
Resume Extract: {profile.raw_text[:1500] if profile.raw_text else 'Not available'}

TARGET JOB:
Title: {job.title}
Company: {job.company}
Location: {job.location}
Salary (from job post): {job.salary_range if job.salary_range else 'NOT DISCLOSED — estimate from market data'}
Source: {job.site}
Description (first 2500 chars):
{job.description[:2500] if job.description else 'No description available.'}
{company_context}
Assess the candidate's fit and return JSON matching this schema exactly:
{{
  "is_relevant": <true or false — false ONLY if the job is from a completely different professional field>,
  "match_score": <integer 0-100>,
  "hire_recommendation": "<strong_yes|yes|borderline|no|strong_no>",
  "summary": "<verdict in first sentence, then 1-2 sentences of specifics — no hedging>",
  "strong_points": ["<specific strength citing evidence from resume AND job description>", ...],
  "gaps": ["<specific gap stated plainly — no softening phrases>", ...],
  "career_suggestions": ["<concrete actionable suggestion>", ...],
  "company_insights": "<company culture, reputation, growth stage — or 'Limited public data on this company.'>",
  "income_range": "<salary — use job's disclosed value with '(disclosed)' or estimate with '(estimated)'>",
  "job_tags": ["<3-8 short tags describing the job: tech stack items, domain, seniority, work mode>"],
  "keywords_matched": ["<skill or keyword present in both resume and job description>"],
  "keywords_missing": ["<skill or keyword required by job but absent from resume>"]
}}"""


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
        f"\nCOMPANY INTELLIGENCE (sourced from the web — use this to enrich your assessment):\n"
        f"{company_info or 'No external data found. Use your training knowledge about this company if available.'}\n"
        if include_company_research else ""
    )

    user = _build_assess_user(profile, job, company_context)

    raw_response = ""
    try:
        if is_local_provider(llm.provider):
            async with get_local_sem():
                raw_response = await asyncio.to_thread(llm.complete, _ASSESS_SYSTEM, user)
        else:
            raw_response = await asyncio.to_thread(llm.complete, _ASSESS_SYSTEM, user)

        cleaned = _clean_json(raw_response)
        data = json.loads(cleaned)
        assessment = JobAssessment(**data)
        assessment.resume_generation_triggered = (
            assessment.match_score >= app_settings.resume_gen_threshold
            and assessment.is_relevant
        )
        return assessment

    except json.JSONDecodeError:
        logger.error("LLM returned invalid JSON for assess: %s", raw_response[:400])
        return JobAssessment(
            match_score=50,
            summary="Could not parse the assessment. Please try Re-assess.",
            strong_points=[], gaps=[], career_suggestions=[], company_insights="",
        )


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

    system = "You are a job search assistant. Given a list of skills/keywords, suggest related search terms that would help find more relevant job postings. Include synonyms, related technologies, and common job title variations."
    user = f"""Given these job search keywords: {', '.join(req.keywords)}

Return a JSON array of 5-10 additional related keywords/phrases that would help find more relevant jobs.
Only include genuinely useful terms — no duplicates of the input.
Return ONLY valid JSON array, no explanation. Example: ["keyword1", "keyword2"]"""

    try:
        import asyncio
        raw = await asyncio.to_thread(llm.complete, system, user)
        cleaned = _clean_json(raw)
        suggestions = json.loads(cleaned)
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

    system = "You are a multilingual job search assistant."
    user = f"""Translate these job search keywords to {lang_name}: {', '.join(req.keywords)}

Return a JSON array of translated keywords, preserving technical terms that don't need translation.
Return ONLY valid JSON array. Example: ["palavra1", "palavra2"]"""

    try:
        import asyncio
        raw = await asyncio.to_thread(llm.complete, system, user)
        cleaned = _clean_json(raw)
        translations = json.loads(cleaned)
        if isinstance(translations, list):
            return {"translations": [t for t in translations if isinstance(t, str)][:20]}
    except Exception as exc:
        logger.warning("Keyword translation failed: %s", exc)

    return {"translations": []}


def _clean_json(text: str) -> str:
    """Strip markdown fences and whitespace from an LLM JSON response."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r'^```[a-zA-Z]*\n?', '', cleaned)
        cleaned = re.sub(r'\n?```\s*$', '', cleaned)
        cleaned = cleaned.strip()
    if cleaned.lower().startswith("json"):
        cleaned = cleaned[4:].strip()
    return cleaned
