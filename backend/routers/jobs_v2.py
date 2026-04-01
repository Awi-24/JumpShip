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
from pydantic import BaseModel

from backend.models.schemas import (
    JobSearchRequest,
    JobResult,
    AssessmentRequest,
    JobAssessment,
)
from backend.services.job_scraper_v2 import search_jobs
from backend.services.llm_service import get_llm_service, LLMService
from backend.services.web_search import search_company_info

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs-v2"])

# ── Model discovery ────────────────────────────────────────────────────────────

@router.get("/api/ollama/models", response_model=list[str])
async def ollama_models(
    base_url: str = Query(default=None, description="Override the Ollama base URL"),
):
    """Return the list of models installed in the running Ollama instance."""
    from backend.config import settings
    url = (base_url or settings.ollama_base_url).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(f"{url}/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
    except Exception as exc:
        logger.warning("Could not fetch Ollama models from %s: %s", url, exc)
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


def _llm_from_request(req) -> LLMService:
    """Build an LLMService from per-request overrides, falling back to .env defaults."""
    from backend.config import settings

    provider = req.llm_provider or settings.llm_provider
    model    = req.llm_model    or settings.llm_model
    base_url = req.llm_base_url or settings.ollama_base_url

    if req.llm_api_key:
        openai_key    = req.llm_api_key if provider == "openai"    else settings.openai_api_key
        anthropic_key = req.llm_api_key if provider == "anthropic" else settings.anthropic_api_key
        groq_key      = req.llm_api_key if provider == "groq"      else settings.groq_api_key
    else:
        openai_key    = settings.openai_api_key
        anthropic_key = settings.anthropic_api_key
        groq_key      = settings.groq_api_key

    return LLMService(
        provider=provider,
        model=model,
        ollama_base_url=base_url,
        openai_api_key=openai_key,
        anthropic_api_key=anthropic_key,
        groq_api_key=groq_key,
    )


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


@_jobs_router.post("/assess", response_model=JobAssessment)
async def assess_job_endpoint(req: AssessmentRequest):
    """
    Use the LLM to assess candidate fit for a job.
    Optionally enriches the prompt with live company data from the web.
    """
    llm = _llm_from_request(req)
    profile = req.resume_profile
    job = req.job

    # ── Optional: fetch company info from the web ───────────────────────────
    company_info = ""
    if req.include_company_research and job.company:
        try:
            company_info = await search_company_info(job.company, job.title)
        except Exception as exc:
            logger.debug("Company web search failed (non-fatal): %s", exc)

    # ── Build prompt ─────────────────────────────────────────────────────────
    company_context = f"""
COMPANY INTELLIGENCE (sourced from the web — use this to enrich your assessment):
{company_info if company_info else "No external data found. Use your training knowledge about this company if available."}
""" if req.include_company_research else ""

    system = """\
You are a senior technical recruiter and career coach with 20+ years of experience \
placing engineers and technical professionals.

Your task is to assess how well a candidate's profile matches a specific job, \
and provide actionable career intelligence.

ASSESSMENT GUIDELINES:
- is_relevant (boolean): Set to FALSE if the job is completely unrelated to the candidate's \
  professional field or domain (e.g. a software engineer receiving a nurse job posting). \
  If the job is even tangentially related to the candidate's background, set to TRUE. \
  A low match_score does NOT make a job irrelevant — only use FALSE for clear field mismatches.
- match_score (0-100): Be calibrated. 90+ = near-perfect fit. 70-89 = strong fit with minor gaps.
  50-69 = moderate fit, notable gaps. Below 50 = significant mismatch. \
  If is_relevant is FALSE, set match_score to 0.
- summary: 2-3 sentences capturing the core fit story and most important insight. \
  If is_relevant is FALSE, briefly explain why the job is unrelated to the candidate's field.
- strong_points: Specific matches between candidate and role (not generic praise).
  Reference actual skills/experience from the resume and job description. Empty list if irrelevant.
- gaps: Honest, specific gaps. If there are none, say so. Do not fabricate gaps. Empty list if irrelevant.
- career_suggestions: Actionable next steps. Empty list if irrelevant.
- company_insights: Summarise what you know about the company (culture, growth stage,
  engineering culture, Glassdoor/Blind sentiment if known).
  Draw from the provided web data AND your training knowledge. Be specific and honest.
  If you have no reliable data, say so clearly.
- income_range: Provide a realistic market salary range for this SPECIFIC role and location \
  based on your training data and the provided web context. Format as e.g. \
  "USD 90,000 – 130,000/yr" or "BRL 8,000 – 15,000/month". \
  If the salary is already disclosed in the job post, use that as a reference and note the source. \
  Use ranges from reliable sources (Glassdoor, LinkedIn Salary, Levels.fyi, local market data). \
  Never leave this blank — always provide a best-effort estimate with a confidence note if uncertain.
- job_tags: Short characteristic labels extracted directly from the job description (max 8 tags). \
  Include: (1) work mode tag — exactly one of "Remote", "Hybrid", or "On-site"; \
  (2) up to 4 main tech stack tags (e.g. "Python", "React", "AWS", "PostgreSQL"); \
  (3) salary tag if disclosed in the posting (e.g. "$90k-120k", "BRL 12k/mês") — omit if not present; \
  (4) contract type if mentioned (e.g. "Full-time", "Contract", "Part-time"). \
  Tags must be short (1-3 words). Use title case. Extract from the job text — do NOT fabricate.

CRITICAL: Return ONLY valid JSON — no markdown, no explanation, no trailing text."""

    user = f"""\
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
Salary: {job.salary_range or 'Not disclosed'}
Source: {job.site}
Description (first 2500 chars):
{job.description[:2500] if job.description else 'No description available.'}
{company_context}
Assess the candidate's fit and return JSON matching this schema exactly:
{{
  "is_relevant": <true or false — false ONLY if the job is from a completely different professional field>,
  "match_score": <integer 0-100>,
  "summary": "<2-3 sentence overview>",
  "strong_points": ["<specific strength 1>", "<specific strength 2>", ...],
  "gaps": ["<specific gap 1>", ...],
  "career_suggestions": ["<actionable suggestion 1>", ...],
  "company_insights": "<paragraph about the company: culture, reputation, growth stage>",
  "income_range": "<realistic salary range for this role and location, e.g. USD 90,000 – 130,000/yr>"
}}"""

    raw_response = ""
    try:
        raw_response = await llm.complete(system, user)
        cleaned = _clean_json(raw_response)
        data = json.loads(cleaned)
        return JobAssessment(**data)

    except json.JSONDecodeError:
        logger.error("LLM returned invalid JSON for assess: %s", raw_response[:400])
        return JobAssessment(
            match_score=50,
            summary="Could not parse the assessment. Please try Re-assess.",
            strong_points=[],
            gaps=[],
            career_suggestions=[],
            company_insights="",
        )
    except Exception as exc:
        logger.error("Assessment endpoint error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Assessment failed: {exc}")


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

    system = (
        "You are a job search assistant. Given a list of skills/keywords, suggest related search terms "
        "that would help find more relevant job postings. "
        "IMPORTANT: Each keyword must be SHORT — 1 or 2 words maximum. "
        "No phrases, no sentences, no articles or prepositions. "
        "Think of atomic terms that someone types into a job board search box."
    )
    user = f"""Given these job search keywords: {', '.join(req.keywords)}

Return a JSON array of 5-10 additional SHORT related keywords (1-2 words each) that would help find more relevant jobs.
Only include genuinely useful terms — no duplicates of the input.
GOOD: ["fastapi", "django", "rest api", "aws", "docker"]
BAD: ["Python backend developer with FastAPI", "cloud infrastructure management"]
Return ONLY valid JSON array, no explanation."""

    try:
        raw = await llm.complete(system, user)
        cleaned = _clean_json(raw)
        suggestions = json.loads(cleaned)
        if isinstance(suggestions, list):
            # Filter out any that are already in the input
            input_lower = {k.lower() for k in req.keywords}
            cleaned: list[str] = []
            for s in suggestions:
                if not isinstance(s, str):
                    continue
                s = s.strip()
                if not s or s.lower() in input_lower:
                    continue
                # Truncate to first 2 words to enforce atomic keywords
                words = s.split()
                cleaned.append(" ".join(words[:2]) if len(words) > 2 else s)
            return {"suggestions": cleaned[:10]}
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
        raw = await llm.complete(system, user)
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
