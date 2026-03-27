"""
Unit tests for LLMService abstraction.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from backend.services.llm_service import LLMService, get_llm_service


class TestLLMServiceRouting:
    def _make(self, provider="ollama", model="llama3"):
        return LLMService(
            provider=provider,
            model=model,
            ollama_base_url="http://localhost:11434",
            openai_api_key="sk-test",
            anthropic_api_key="sk-ant-test",
            groq_api_key="gsk-test",
        )

    @pytest.mark.asyncio
    async def test_ollama_route(self):
        llm = self._make("ollama")
        with patch.object(llm, "_ollama_complete", new_callable=AsyncMock) as mock:
            mock.return_value = "ollama response"
            result = await llm.complete("sys", "user")
            mock.assert_called_once_with("sys", "user")
            assert result == "ollama response"

    @pytest.mark.asyncio
    async def test_openai_route(self):
        llm = self._make("openai", "gpt-4o")
        with patch.object(llm, "_openai_complete", new_callable=AsyncMock) as mock:
            mock.return_value = "openai response"
            result = await llm.complete("sys", "user")
            mock.assert_called_once()
            assert result == "openai response"

    @pytest.mark.asyncio
    async def test_anthropic_route(self):
        llm = self._make("anthropic", "claude-sonnet-4-5")
        with patch.object(llm, "_anthropic_complete", new_callable=AsyncMock) as mock:
            mock.return_value = "anthropic response"
            result = await llm.complete("sys", "user")
            mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_groq_route(self):
        llm = self._make("groq", "llama3-70b-8192")
        with patch.object(llm, "_groq_complete", new_callable=AsyncMock) as mock:
            mock.return_value = "groq response"
            result = await llm.complete("sys", "user")
            mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_provider_raises(self):
        llm = self._make("unknown_provider")
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            await llm.complete("sys", "user")

    @pytest.mark.asyncio
    async def test_is_available_ollama_up(self):
        llm = self._make("ollama")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            result = await llm.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_is_available_ollama_down(self):
        llm = self._make("ollama")
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            result = await llm.is_available()
        assert result is False

    @pytest.mark.asyncio
    async def test_is_available_openai_with_key(self):
        llm = self._make("openai")
        result = await llm.is_available()
        assert result is True  # has api key set

    @pytest.mark.asyncio
    async def test_is_available_openai_without_key(self):
        llm = LLMService(provider="openai", model="gpt-4o", openai_api_key="")
        result = await llm.is_available()
        assert result is False


class TestGetLLMService:
    def test_returns_llm_service_instance(self):
        from backend.services.llm_service import LLMService
        svc = get_llm_service()
        assert isinstance(svc, LLMService)

    def test_uses_settings(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "groq")
        monkeypatch.setenv("LLM_MODEL", "mixtral-8x7b-32768")
        # Re-import to pick up env
        import importlib
        import backend.config as cfg
        importlib.reload(cfg)
        import backend.services.llm_service as svc_mod
        importlib.reload(svc_mod)
        svc = svc_mod.get_llm_service()
        assert svc.provider == "groq"
