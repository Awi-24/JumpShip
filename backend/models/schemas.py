"""
JumpShip — Pydantic v2 schemas for all API request/response types
"""
from __future__ import annotations

from pydantic import BaseModel


class ResumeProfile(BaseModel):
    name: str = ""
    title: str = ""
    skills: list[str] = []
    experience_years: int = 0
    domains: list[str] = []
    suggested_keywords: list[str] = []
    suggested_titles: list[str] = []
    raw_text: str = ""


class LLMOverride(BaseModel):
    """Per-request LLM configuration. If omitted, falls back to .env / config.py defaults."""
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None


class JobSearchRequest(LLMOverride):
    keywords: list[str] = []
    location: str = "Remote"
    job_type: str = "fulltime"
    sites: list[str] = ["linkedin", "indeed", "glassdoor"]
    results_wanted: int = 20
    resume_profile: ResumeProfile | None = None


class JobResult(BaseModel):
    id: str = ""
    title: str = ""
    company: str = ""
    company_url: str = ""
    location: str = ""
    job_type: str = ""
    salary_range: str = ""
    posted_date: str = ""
    description: str = ""
    url: str = ""
    site: str = ""
    match_score: int | None = None
    is_remote: bool | None = None   # populated from jobspy's is_remote field
    tags: list[str] = []            # e.g. ["remote", "senior", "python", "fintech"]


class AssessmentRequest(LLMOverride):
    job: JobResult
    resume_profile: ResumeProfile
    include_company_research: bool = True  # set False to skip web search


class BatchAssessmentRequest(LLMOverride):
    jobs: list[JobResult]
    resume_profile: ResumeProfile
    include_company_research: bool = False  # default False for batch speed


class BatchAssessmentItem(BaseModel):
    job_id: str
    assessment: JobAssessment | None = None
    error: str | None = None


class JobAssessment(BaseModel):
    match_score: int = 0
    summary: str = ""
    strong_points: list[str] = []
    gaps: list[str] = []
    career_suggestions: list[str] = []
    company_insights: str = ""
    income_range: str = ""
    is_relevant: bool = True
    job_tags: list[str] = []
    keywords_matched: list[str] = []
    keywords_missing: list[str] = []
    resume_generation_triggered: bool = False  # True when score >= RESUME_GEN_THRESHOLD
    hire_recommendation: str = "borderline"  # strong_yes | yes | borderline | no | strong_no


class HealthResponse(BaseModel):
    status: str = "ok"
    llm_provider: str = ""
    llm_model: str = ""
    llm_available: bool = False
    version: str = "3.0.0"
