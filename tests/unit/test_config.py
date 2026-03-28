"""
Unit tests for Settings / config.py.
"""
import pytest
from backend.config import Settings


class TestSettings:
    def test_defaults(self):
        s = Settings()
        assert s.llm_provider == "ollama"
        assert s.llm_model == "llama3"
        assert s.ollama_base_url == "http://localhost:11434"
        assert s.openai_api_key == ""
        assert "http://localhost:5173" in s.cors_origins

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("LLM_MODEL", "gpt-4o")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
        s = Settings()
        assert s.llm_provider == "openai"
        assert s.llm_model == "gpt-4o"
        assert s.openai_api_key == "sk-test-key"

    def test_groq_provider(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "groq")
        monkeypatch.setenv("GROQ_API_KEY", "gsk_abc123")
        s = Settings()
        assert s.llm_provider == "groq"
        assert s.groq_api_key == "gsk_abc123"
