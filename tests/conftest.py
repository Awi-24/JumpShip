"""
Shared pytest fixtures for JumpShip tests.
"""
from __future__ import annotations

import sys
import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock

# Make sure "backend" package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ── jobspy stub ──────────────────────────────────────────────────────────────
# The real jobspy depends on tls_client which is not installed in the test
# environment. Stub it out in sys.modules *before* any backend module imports
# it, so all `from jobspy import scrape_jobs` calls get our MagicMock.
_mock_jobspy = MagicMock()
_mock_jobspy.scrape_jobs = MagicMock()
for _mod in ["jobspy", "jobspy.bayt", "jobspy.util", "jobspy.linkedin",
             "jobspy.indeed", "jobspy.glassdoor", "jobspy.zip_recruiter",
             "jobspy.scrapers"]:
    sys.modules.setdefault(_mod, _mock_jobspy)


@pytest.fixture()
def client():
    """FastAPI TestClient with overridden LLM and DB dependencies."""
    from backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def mock_llm():
    """An LLMService whose complete() always returns valid JSON."""
    from backend.services.llm_service import LLMService
    llm = MagicMock(spec=LLMService)
    llm.complete = AsyncMock(return_value='{"match_score": 85, "summary": "Good fit", "strong_points": ["Python"], "gaps": ["Rust"], "career_suggestions": ["Learn Rust"]}')
    llm.is_available = AsyncMock(return_value=True)
    return llm


@pytest.fixture()
def sample_profile():
    from backend.models.schemas import ResumeProfile
    return ResumeProfile(
        name="Ada Lovelace",
        title="Senior ML Engineer",
        skills=["Python", "TensorFlow", "GCP"],
        experience_years=5,
        domains=["MLOps", "Data Engineering"],
        suggested_keywords=["machine learning", "python", "mlops"],
        suggested_titles=["ML Engineer", "MLOps Engineer"],
        raw_text="Ada Lovelace — Senior ML Engineer with 5 years experience...",
    )


@pytest.fixture()
def sample_job():
    from backend.models.schemas import JobResult
    return JobResult(
        id="abc123",
        title="ML Engineer",
        company="Acme Corp",
        location="Remote",
        job_type="fulltime",
        salary_range="USD 120,000 - 160,000",
        posted_date="2026-03-20",
        description="We need a Python ML Engineer with GCP experience to build production ML systems.",
        url="https://example.com/job/1",
        site="linkedin",
    )
