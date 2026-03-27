"""
JumpShip v2 — Job search and assessment endpoints.
POST /api/jobs/search  → list of JobResult
POST /api/jobs/assess  → JobAssessment
GET  /api/ollama/models → list[str]
"""
from __future__ import annotations

import json
import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

from backend.models.schemas import (
    JobSearchRequest,
    JobResult,
    AssessmentRequest,
    JobAssessment,
)
from backend.services.job_scraper_v2 import search_jobs
from backend.services.llm_service import get_llm_service, LLMService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs-v2"])

# ── Ollama model discovery ─────────────────────────────────────────────────────

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
            data = r.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        logger.warning(f"Could not fetch Ollama models from {url}: {e}")
        return []


# ── Job endpoints ─────────────────────────────────────────────────────────────

_jobs_router = APIRouter(prefix="/api/jobs")


def _llm_from_request(req) -> LLMService:
    """Build an LLMService from a per-request override, falling back to .env defaults."""
    from backend.config import settings

    provider  = req.llm_provider  or settings.llm_provider
    model     = req.llm_model     or settings.llm_model
    base_url  = req.llm_base_url  or settings.ollama_base_url

    # API key: use the one from the request first, then fall back to env
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
    """Search for jobs using python-jobspy and return structured results."""
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
    except Exception as e:
        logger.error(f"Job search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")


@_jobs_router.post("/assess", response_model=JobAssessment)
async def assess_job_endpoint(req: AssessmentRequest):
    """Use the LLM to assess how well a candidate matches a job."""
    llm = _llm_from_request(req)

    system = """You are a career coach and technical recruiter.
Compare a job description against a candidate's résumé profile.
Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "match_score": <integer 0-100>,
  "summary": "string",
  "strong_points": ["string"],
  "gaps": ["string"],
  "career_suggestions": ["string"]
}"""

    profile = req.resume_profile
    job = req.job

    user = f"""CANDIDATE PROFILE:
Title: {profile.title}
Skills: {', '.join(profile.skills)}
Domains: {', '.join(profile.domains)}
Experience: {profile.experience_years} years

JOB: {job.title} at {job.company}
Location: {job.location}
DESCRIPTION:
{job.description[:2000]}

Assess fit and return JSON."""

    response = ""
    try:
        response = await llm.complete(system, user)

        cleaned = response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:])
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

        data = json.loads(cleaned)
        return JobAssessment(**data)

    except json.JSONDecodeError:
        logger.error(f"LLM returned invalid JSON for assess: {response[:300]}")
        return JobAssessment(
            match_score=50,
            summary="Could not parse LLM response. Try again.",
            strong_points=[],
            gaps=[],
            career_suggestions=[],
        )
    except Exception as e:
        logger.error(f"Assessment failed: {e}")
        raise HTTPException(status_code=500, detail=f"Assessment failed: {e}")
