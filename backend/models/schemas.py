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


class AssessmentRequest(LLMOverride):
    job: JobResult
    resume_profile: ResumeProfile
    include_company_research: bool = True  # set False to skip web search


class JobAssessment(BaseModel):
    match_score: int = 0
    summary: str = ""
    strong_points: list[str] = []
    gaps: list[str] = []
    career_suggestions: list[str] = []
    company_insights: str = ""   # web-researched company info summary
    income_range: str = ""       # estimated market salary range for this role/location
    is_relevant: bool = True     # False when job is completely unrelated to candidate's field


class HealthResponse(BaseModel):
    status: str = "ok"
    llm_provider: str = ""
    llm_model: str = ""
    llm_available: bool = False
    version: str = "2.0.0"
