"""
LLM integration tests.
- Marked with @pytest.mark.llm_integration — skipped by default.
- Run with: pytest -m llm_integration
- Requires Ollama running locally with llama3 pulled.
"""
import pytest
import httpx
from backend.services.llm_service import LLMService

pytestmark = pytest.mark.llm_integration


def ollama_is_up() -> bool:
    try:
        r = httpx.get("http://localhost:11434/api/tags", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


@pytest.fixture(scope="module", autouse=True)
def require_ollama():
    if not ollama_is_up():
        pytest.skip("Ollama not running — skipping LLM integration tests")


@pytest.fixture(scope="module")
def ollama_llm():
    return LLMService(
        provider="ollama",
        model="llama3:8b",
        ollama_base_url="http://localhost:11434",
    )


class TestOllamaLive:
    @pytest.mark.asyncio
    async def test_is_available_true(self, ollama_llm):
        result = await ollama_llm.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_complete_returns_string(self, ollama_llm):
        response = await ollama_llm.complete(
            system_prompt="You are a helpful assistant. Reply with exactly one word.",
            user_prompt="Say the word: hello",
        )
        assert isinstance(response, str)
        assert len(response) > 0

    @pytest.mark.asyncio
    async def test_complete_json_profile(self, ollama_llm):
        """Verify LLM can parse a resume and return valid JSON."""
        import json
        system = (
            "You are a resume parser. Return ONLY valid JSON with these fields: "
            '{"name": str, "title": str, "skills": [str], "experience_years": int, '
            '"domains": [str], "suggested_keywords": [str], "suggested_titles": [str]}'
        )
        user = "Ada Lovelace is a Senior ML Engineer with 5 years experience in Python, GCP, and TensorFlow."

        response = await ollama_llm.complete(system, user)
        # Strip markdown fences if present
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
            cleaned = cleaned.rstrip("`").strip()

        data = json.loads(cleaned)
        assert "name" in data
        assert "skills" in data
        assert isinstance(data["skills"], list)

    @pytest.mark.asyncio
    async def test_complete_json_assessment(self, ollama_llm):
        """Verify LLM can assess a job and return valid JSON."""
        import json
        system = (
            "You are a career coach. Compare a candidate to a job. "
            "Return ONLY valid JSON: "
            '{"match_score": int, "summary": str, "strong_points": [str], '
            '"gaps": [str], "career_suggestions": [str]}'
        )
        user = (
            "Candidate: Senior Python engineer, 5 yrs, skills: Python, GCP, TensorFlow.\n"
            "Job: ML Engineer at Stripe, requires Python, GCP, MLflow.\n"
            "Assess fit."
        )

        response = await ollama_llm.complete(system, user)
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
            cleaned = cleaned.rstrip("`").strip()

        data = json.loads(cleaned)
        assert "match_score" in data
        assert isinstance(data["match_score"], int)
        assert 0 <= data["match_score"] <= 100
        assert isinstance(data["strong_points"], list)
