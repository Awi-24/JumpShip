"""
Integration tests for POST /api/jobs/search and POST /api/jobs/assess.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import pandas as pd


MOCK_DF = pd.DataFrame([{
    "title": "ML Engineer",
    "company": "Stripe",
    "location": "Remote",
    "job_type": "fulltime",
    "min_amount": 160000,
    "max_amount": 210000,
    "currency": "USD",
    "date_posted": "2026-03-20",
    "description": "Build ML pipelines at scale.",
    "job_url": "https://stripe.com/jobs/ml",
    "site": "linkedin",
}])


class TestJobSearch:
    def test_search_returns_list(self, client):
        with patch("backend.routers.jobs_v2.search_jobs", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = [{
                "id": "abc", "title": "ML Engineer", "company": "Stripe",
                "location": "Remote", "job_type": "fulltime",
                "salary_range": "USD 160,000 - 210,000", "posted_date": "2026-03-20",
                "description": "Build ML pipelines.", "url": "https://stripe.com/jobs/ml",
                "site": "linkedin", "match_score": None,
            }]
            resp = client.post("/api/jobs/search", json={
                "keywords": ["python", "machine learning"],
                "location": "Remote",
                "results_wanted": 5,
            })

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["title"] == "ML Engineer"
        assert data[0]["company"] == "Stripe"

    def test_search_no_keywords_returns_400(self, client):
        resp = client.post("/api/jobs/search", json={"keywords": []})
        assert resp.status_code == 400
        assert "keyword" in resp.json()["detail"].lower()

    def test_search_with_llm_override(self, client):
        with patch("backend.routers.jobs_v2.search_jobs", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = []
            resp = client.post("/api/jobs/search", json={
                "keywords": ["python"],
                "llm_provider": "openai",
                "llm_model": "gpt-4o",
                "llm_api_key": "sk-test",
            })
        # Accepted regardless of LLM config (search doesn't use LLM)
        assert resp.status_code == 200

    def test_search_scraper_error_returns_500(self, client):
        with patch("backend.routers.jobs_v2.search_jobs", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = RuntimeError("scraper failed")
            resp = client.post("/api/jobs/search", json={"keywords": ["python"]})
        assert resp.status_code == 500
        assert "failed" in resp.json()["detail"].lower()


class TestJobAssess:
    def _assess_payload(self, **overrides):
        payload = {
            "job": {
                "id": "j1", "title": "ML Engineer", "company": "Stripe",
                "location": "Remote", "job_type": "fulltime",
                "salary_range": "", "posted_date": "2026-03-20",
                "description": "We need Python ML engineers with GCP experience.",
                "url": "https://stripe.com", "site": "linkedin",
            },
            "resume_profile": {
                "name": "Ada", "title": "ML Engineer",
                "skills": ["Python", "GCP", "TensorFlow"],
                "experience_years": 5, "domains": ["MLOps"],
                "suggested_keywords": ["python"], "suggested_titles": ["ML Engineer"],
                "raw_text": "Ada is an ML engineer.",
            },
        }
        payload.update(overrides)
        return payload

    def test_assess_returns_assessment(self, client):
        good_json = '{"match_score": 88, "summary": "Great fit", "strong_points": ["Python", "GCP"], "gaps": ["Rust"], "career_suggestions": ["Learn Rust"]}'
        with patch("backend.routers.jobs_v2._llm_from_request") as mock_factory:
            mock_llm = MagicMock()
            mock_llm.complete = MagicMock(return_value=good_json)
            mock_factory.return_value = mock_llm
            resp = client.post("/api/jobs/assess", json=self._assess_payload())

        assert resp.status_code == 200
        data = resp.json()
        assert data["match_score"] == 88
        assert "Python" in data["strong_points"]
        assert data["gaps"] == ["Rust"]

    def test_assess_bad_llm_json_returns_fallback(self, client):
        with patch("backend.routers.jobs_v2._llm_from_request") as mock_factory:
            mock_llm = MagicMock()
            mock_llm.complete = MagicMock(return_value="sorry I cannot help with that")
            mock_factory.return_value = mock_llm
            resp = client.post("/api/jobs/assess", json=self._assess_payload())

        assert resp.status_code == 200
        data = resp.json()
        assert data["match_score"] == 50  # fallback
        assert "parse" in data["summary"].lower()

    def test_assess_uses_llm_override_fields(self, client):
        """Verify per-request LLM config is forwarded to _llm_from_request."""
        captured = {}

        def capture_req(req):
            captured["provider"] = req.llm_provider
            captured["key"] = req.llm_api_key
            mock_llm = MagicMock()
            mock_llm.complete = MagicMock(
                return_value='{"match_score":70,"summary":"ok","strong_points":[],"gaps":[],"career_suggestions":[],'
                '"company_insights":"","income_range":"","job_tags":[],"keywords_matched":[],"keywords_missing":[]}'
            )
            return mock_llm

        with patch("backend.routers.jobs_v2._llm_from_request", side_effect=capture_req):
            resp = client.post("/api/jobs/assess", json=self._assess_payload(
                llm_provider="anthropic",
                llm_api_key="sk-ant-test",
            ))

        assert resp.status_code == 200
        assert captured["provider"] == "anthropic"
        assert captured["key"] == "sk-ant-test"
