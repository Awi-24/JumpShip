"""
Integration tests for GET /api/health.
"""
import pytest
from unittest.mock import AsyncMock, patch


class TestHealthEndpoint:
    def test_health_ok_structure(self, client):
        with patch("backend.main.get_llm_service") as mock_factory:
            mock_llm = AsyncMock()
            mock_llm.is_available = AsyncMock(return_value=True)
            mock_factory.return_value = mock_llm
            resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "llm_provider" in data
        assert "llm_model" in data
        assert "llm_available" in data
        assert data["version"] == "1.0.0"

    def test_health_llm_unavailable(self, client):
        with patch("backend.main.get_llm_service") as mock_factory:
            mock_llm = AsyncMock()
            mock_llm.is_available = AsyncMock(return_value=False)
            mock_factory.return_value = mock_llm
            resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["llm_available"] is False
