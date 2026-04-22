"""
Unit tests for job_scraper_v2 — jobspy wrapper and salary formatter.
"""
import sys
import pytest
from unittest.mock import patch, MagicMock
import pandas as pd

# Grab (or inject) the jobspy stub in sys.modules.
# conftest.py may have already put a MagicMock there; setdefault returns
# whatever is already present, so both conftest and this module share the
# same object when running together.
_mock_jobspy = sys.modules.setdefault("jobspy", MagicMock())

from backend.services.job_scraper_v2 import search_jobs, _format_salary  # noqa: E402


class TestFormatSalary:
    def test_both_min_max(self):
        row = {"min_amount": 100000, "max_amount": 150000, "currency": "USD"}
        assert "100,000" in _format_salary(row)
        assert "150,000" in _format_salary(row)
        assert "USD" in _format_salary(row)

    def test_min_only(self):
        row = {"min_amount": 80000, "max_amount": None, "currency": "USD"}
        assert "80,000+" in _format_salary(row)

    def test_max_only(self):
        row = {"min_amount": None, "max_amount": 120000, "currency": "BRL"}
        assert "Up to BRL" in _format_salary(row)

    def test_no_salary(self):
        row = {"min_amount": None, "max_amount": None, "currency": "USD"}
        assert _format_salary(row) == ""


class TestSearchJobs:
    @pytest.mark.asyncio
    async def test_returns_list_of_dicts(self):
        mock_df = pd.DataFrame([{
            "title": "ML Engineer",
            "company": "Stripe",
            "location": "Remote",
            "job_type": "fulltime",
            "min_amount": 160000,
            "max_amount": 200000,
            "currency": "USD",
            "date_posted": "2026-03-20",
            "description": "Build ML systems.",
            "job_url": "https://stripe.com/jobs/1",
            "site": "linkedin",
        }])

        _mock_jobspy.scrape_jobs.return_value = mock_df
        results = await search_jobs(
            keywords=["python", "ml"],
            location="Remote",
            job_type="fulltime",
            sites=["linkedin"],
            results_wanted=5,
        )

        assert len(results) == 1
        job = results[0]
        assert job["title"] == "ML Engineer"
        assert job["company"] == "Stripe"
        assert job["site"] == "linkedin"
        assert job["id"] != ""  # MD5 generated
        assert job["match_score"] is None

    @pytest.mark.asyncio
    async def test_empty_dataframe(self):
        mock_df = pd.DataFrame()
        _mock_jobspy.scrape_jobs.return_value = mock_df
        results = await search_jobs(keywords=["python"])
        assert results == []

    @pytest.mark.asyncio
    async def test_deduplicates_identical_rows(self):
        """Identical title+company rows collapse after post-processing dedup."""
        row = {
            "title": "Dev", "company": "Acme", "location": "NY",
            "job_type": "fulltime", "min_amount": None, "max_amount": None,
            "currency": "USD", "date_posted": "", "description": "",
            "job_url": "https://example.com/1", "site": "indeed",
        }
        mock_df = pd.DataFrame([row, row])
        _mock_jobspy.scrape_jobs.return_value = mock_df
        # Avoid default "Remote" post-filter dropping on-site "NY" rows.
        results = await search_jobs(keywords=["dev"], location="")
        assert len(results) == 1
        assert results[0]["title"] == "Dev"

    @pytest.mark.asyncio
    async def test_scrape_exception_yields_empty_batch(self):
        """JobSpy failures are logged; parallel gather keeps other batches (here: none)."""
        _mock_jobspy.scrape_jobs.side_effect = RuntimeError("network error")
        try:
            results = await search_jobs(keywords=["python"])
            assert results == []
        finally:
            _mock_jobspy.scrape_jobs.side_effect = None  # reset for other tests
