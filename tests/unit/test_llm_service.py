"""
Unit tests for LLMService (Ollama health wrapper).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.services.llm_service import LLMService, get_llm_service


@pytest.mark.asyncio
async def test_complete_posts_to_ollama_generate():
    llm = LLMService(provider="ollama", model="gemma3:27b", ollama_base_url="http://localhost:11434")
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"response": "hello from model"})

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        out = await llm.complete("system", "user prompt")
    assert out == "hello from model"
    mock_client.post.assert_called_once()
    args, kwargs = mock_client.post.call_args
    assert args[0] == "http://localhost:11434/api/generate"
    assert kwargs["json"]["model"] == "gemma3:27b"


@pytest.mark.asyncio
async def test_is_available_true_when_tags_ok():
    llm = LLMService(ollama_base_url="http://localhost:11434")
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client
        assert await llm.is_available() is True


@pytest.mark.asyncio
async def test_is_available_false_on_error():
    llm = LLMService(ollama_base_url="http://localhost:11434")
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=RuntimeError("down"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client
        assert await llm.is_available() is False


def test_get_llm_service_reads_settings(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "llama3.1:8b")
    import importlib
    import backend.config as cfg
    import backend.services.llm_service as svc_mod
    importlib.reload(cfg)
    importlib.reload(svc_mod)
    svc = svc_mod.get_llm_service()
    assert svc.provider == "ollama"
    assert svc.model == "llama3.1:8b"
