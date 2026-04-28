"""
Unit tests for Pydantic v2 schemas.
"""
import pytest
from pydantic import ValidationError
from backend.models.schemas import (
    ResumeProfile,
    JobSearchRequest,
    JobResult,
    AssessmentRequest,
    JobAssessment,
    LLMOverride,
    HealthResponse,
)


class TestResumeProfile:
    def test_defaults(self):
        p = ResumeProfile()
        assert p.name == ""
        assert p.skills == []
        assert p.experience_years == 0

    def test_full(self):
        p = ResumeProfile(
            name="Jane",
            title="Engineer",
            skills=["Python", "Go"],
            experience_years=3,
            domains=["Backend"],
            suggested_keywords=["python"],
            suggested_titles=["SWE"],
            raw_text="Jane is an engineer.",
        )
        assert p.name == "Jane"
        assert len(p.skills) == 2


class TestJobSearchRequest:
    def test_defaults(self):
        req = JobSearchRequest(keywords=["python"])
        assert req.location == "Remote"
        assert req.results_wanted == 20
        assert "linkedin" in req.sites

    def test_llm_override_fields(self):
        req = JobSearchRequest(
            keywords=["python"],
            llm_provider="openai",
            llm_model="gpt-4o",
            llm_api_key="sk-test",
        )
        assert req.llm_provider == "openai"
        assert req.llm_api_key == "sk-test"

    def test_empty_keywords_allowed(self):
        # Schema itself allows empty; router validates
        req = JobSearchRequest()
        assert req.keywords == []


class TestJobResult:
    def test_minimal(self):
        j = JobResult(title="Dev", company="Acme")
        assert j.id == ""
        assert j.match_score is None

    def test_with_score(self):
        j = JobResult(title="Dev", company="Acme", match_score=92)
        assert j.match_score == 92


class TestAssessmentRequest:
    def test_requires_job_and_profile(self):
        profile = ResumeProfile(name="Ada")
        job = JobResult(title="SWE", company="Corp")
        req = AssessmentRequest(job=job, resume_profile=profile)
        assert req.job.title == "SWE"
        assert req.resume_profile.name == "Ada"

    def test_llm_override_optional(self):
        profile = ResumeProfile()
        job = JobResult()
        req = AssessmentRequest(job=job, resume_profile=profile, llm_provider="groq")
        assert req.llm_provider == "groq"
        assert req.llm_model is None  # not required


class TestJobAssessment:
    def test_defaults(self):
        a = JobAssessment()
        assert a.match_score == 0
        assert a.strong_points == []

    def test_full(self):
        a = JobAssessment(
            match_score=88,
            summary="Great fit",
            strong_points=["Python", "GCP"],
            gaps=["Rust"],
            career_suggestions=["Learn Rust"],
        )
        assert a.match_score == 88
        assert len(a.strong_points) == 2


class TestHealthResponse:
    def test_defaults(self):
        h = HealthResponse()
        assert h.status == "ok"
        assert h.llm_available is False
        assert h.version == "1.0.0"
