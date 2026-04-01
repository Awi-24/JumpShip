"""
Tests for agent-related modules.

Does NOT require tls_client, playwright, or real env vars to be installed.
All tests are pure-Python / unit-level and use mocking where needed.
"""
from __future__ import annotations

import asyncio
import sys
import types
import unittest.mock as mock
from unittest.mock import MagicMock, patch, AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Helpers to stub out heavy optional dependencies before importing our modules
# ---------------------------------------------------------------------------

def _stub_playwright():
    """Register a minimal playwright stub so the import won't fail."""
    if "playwright" not in sys.modules:
        pkg = types.ModuleType("playwright")
        async_api = types.ModuleType("playwright.async_api")
        async_api.async_playwright = MagicMock()
        pkg.async_api = async_api
        sys.modules["playwright"] = pkg
        sys.modules["playwright.async_api"] = async_api


def _stub_fastapi_websocket():
    """Stub fastapi.WebSocket if fastapi itself is not installed."""
    try:
        import fastapi  # noqa: F401
    except ImportError:
        pkg = types.ModuleType("fastapi")
        pkg.WebSocket = object
        sys.modules["fastapi"] = pkg


_stub_playwright()
_stub_fastapi_websocket()


# ---------------------------------------------------------------------------
# 1.  AgentLLMConfig defaults and effective values
# ---------------------------------------------------------------------------

class TestAgentLLMConfig:
    def test_defaults(self):
        from backend.services.browser_agent import AgentLLMConfig
        cfg = AgentLLMConfig()
        assert cfg.provider == ""
        assert cfg.model == ""
        assert cfg.api_key == ""
        assert cfg.base_url == ""

    def test_custom_values(self):
        from backend.services.browser_agent import AgentLLMConfig
        cfg = AgentLLMConfig(provider="openai", model="gpt-4o", api_key="sk-test", base_url="")
        assert cfg.provider == "openai"
        assert cfg.model == "gpt-4o"
        assert cfg.api_key == "sk-test"

    def test_partial_values(self):
        from backend.services.browser_agent import AgentLLMConfig
        cfg = AgentLLMConfig(provider="ollama")
        assert cfg.provider == "ollama"
        assert cfg.model == ""


# ---------------------------------------------------------------------------
# 2.  ApplicationAgent instantiation with custom llm_config
# ---------------------------------------------------------------------------

class TestApplicationAgentInstantiation:
    def _make_agent(self, llm_config=None):
        from backend.services.browser_agent import ApplicationAgent, AgentLLMConfig
        return ApplicationAgent(
            agent_id="test-id",
            job_url="https://example.com/job/1",
            user_profile={"name": "Test User", "email": "test@example.com"},
            llm_config=llm_config,
        )

    def test_default_llm_config(self):
        from backend.services.browser_agent import AgentLLMConfig
        agent = self._make_agent()
        assert isinstance(agent.llm_config, AgentLLMConfig)
        assert agent.llm_config.provider == ""

    def test_custom_llm_config(self):
        from backend.services.browser_agent import AgentLLMConfig
        cfg = AgentLLMConfig(provider="anthropic", model="claude-opus-4")
        agent = self._make_agent(llm_config=cfg)
        assert agent.llm_config.provider == "anthropic"
        assert agent.llm_config.model == "claude-opus-4"

    def test_initial_state(self):
        agent = self._make_agent()
        assert agent.status == "pending"
        assert agent.log == []
        assert agent.screenshot_b64 is None
        assert agent.error is None
        assert agent.interaction_pending is None

    def test_stop_signal(self):
        agent = self._make_agent()
        assert not agent._stop_event.is_set()
        agent.stop()
        assert agent._stop_event.is_set()

    def test_set_human_response(self):
        agent = self._make_agent()
        agent.set_human_response("approve_submit")
        assert agent._human_response == "approve_submit"
        assert agent._human_event.is_set()
        assert agent.interaction_pending is None


# ---------------------------------------------------------------------------
# 3.  AgentManager create / start / stop / respond
# ---------------------------------------------------------------------------

class TestAgentManager:
    def _make_manager(self):
        # Import fresh instance each test
        from backend.services.agent_manager import AgentManager
        return AgentManager()

    def test_create_agent_returns_id(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        assert isinstance(agent_id, str)
        assert len(agent_id) > 0
        assert agent_id in mgr.agents

    def test_create_agent_with_llm_config(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
            llm_config={"provider": "openai", "model": "gpt-4o", "api_key": "sk-x", "base_url": ""},
        )
        agent = mgr.agents[agent_id]
        assert agent.llm_config.provider == "openai"
        assert agent.llm_config.model == "gpt-4o"

    def test_create_agent_metadata(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
            job_title="Software Engineer",
            company="Acme",
            application_id="app-123",
        )
        agent = mgr.agents[agent_id]
        assert agent.job_title == "Software Engineer"
        assert agent.company == "Acme"
        assert agent.application_id == "app-123"

    def test_stop_agent(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        # Agent not started, but stop should set the event
        mgr.stop_agent(agent_id)
        assert mgr.agents[agent_id]._stop_event.is_set()

    def test_remove_agent(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        mgr.remove_agent(agent_id)
        assert agent_id not in mgr.agents

    def test_respond_to_agent_not_found(self):
        mgr = self._make_manager()
        result = mgr.respond_to_agent("nonexistent-id", "approve_submit")
        assert result is False

    def test_respond_to_agent_wrong_status(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        # Agent is in "pending" status, not waiting
        result = mgr.respond_to_agent(agent_id, "approve_submit")
        assert result is False

    def test_respond_to_agent_review_requested(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        agent = mgr.agents[agent_id]
        agent.status = "review_requested"
        result = mgr.respond_to_agent(agent_id, "approve_submit")
        assert result is True
        assert agent._human_response == "approve_submit"

    def test_respond_to_agent_help_requested(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        agent = mgr.agents[agent_id]
        agent.status = "help_requested"
        result = mgr.respond_to_agent(agent_id, "skip_and_continue")
        assert result is True
        assert agent._human_response == "skip_and_continue"

    def test_list_all(self):
        mgr = self._make_manager()
        assert mgr.list_all() == []
        mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        lst = mgr.list_all()
        assert len(lst) == 1
        assert "id" in lst[0]
        assert "status" in lst[0]

    def test_snapshot_includes_new_fields(self):
        mgr = self._make_manager()
        agent_id = mgr.create_agent(
            job_url="https://example.com/job/1",
            user_profile={"name": "Alice", "email": "a@b.com"},
        )
        snap = mgr.get_info(agent_id)
        assert "interaction_pending" in snap
        assert "llm_provider" in snap
        assert "llm_model" in snap


# ---------------------------------------------------------------------------
# 4.  _detect_portal
# ---------------------------------------------------------------------------

class TestDetectPortal:
    def _agent(self, url: str):
        from backend.services.browser_agent import ApplicationAgent
        return ApplicationAgent(
            agent_id="x",
            job_url=url,
            user_profile={},
        )

    def test_linkedin(self):
        assert self._agent("https://www.linkedin.com/jobs/view/123")._detect_portal() == "linkedin"

    def test_greenhouse(self):
        assert self._agent("https://boards.greenhouse.io/company/job/1")._detect_portal() == "greenhouse"

    def test_lever(self):
        assert self._agent("https://jobs.lever.co/company/123")._detect_portal() == "lever"

    def test_workday(self):
        assert self._agent("https://company.myworkdayjobs.com/job")._detect_portal() == "workday"

    def test_icims(self):
        assert self._agent("https://company.icims.com/jobs/1")._detect_portal() == "icims"

    def test_indeed(self):
        assert self._agent("https://www.indeed.com/viewjob?jk=abc")._detect_portal() == "indeed"

    def test_smartrecruiters(self):
        assert self._agent("https://jobs.smartrecruiters.com/company/job")._detect_portal() == "smartrecruiters"

    def test_generic(self):
        assert self._agent("https://careers.randomcompany.com/job/1")._detect_portal() == "generic"


# ---------------------------------------------------------------------------
# 5.  _is_submit_action
# ---------------------------------------------------------------------------

class TestIsSubmitAction:
    def _agent(self):
        from backend.services.browser_agent import ApplicationAgent
        return ApplicationAgent(agent_id="x", job_url="https://example.com", user_profile={})

    def test_request_review_type(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "request_review"}) is True

    def test_click_submit_description(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "click", "description": "Click submit button", "selector": ".btn"}) is True

    def test_click_apply_description(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "click", "description": "Click apply now", "selector": ".btn"}) is True

    def test_click_apply_selector(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "click", "description": "Click button", "selector": "#submit-btn"}) is True

    def test_fill_action_not_submit(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "fill", "description": "Fill email field", "selector": "#email"}) is False

    def test_click_next_not_submit(self):
        agent = self._agent()
        assert agent._is_submit_action({"type": "click", "description": "Click next page", "selector": ".next-btn"}) is False


# ---------------------------------------------------------------------------
# 6.  _check_vision_available for all providers
# ---------------------------------------------------------------------------

class TestCheckVisionAvailable:
    def _agent(self, llm_config=None):
        from backend.services.browser_agent import ApplicationAgent
        return ApplicationAgent(
            agent_id="x",
            job_url="https://example.com",
            user_profile={},
            llm_config=llm_config,
        )

    def _mock_settings(self, provider="ollama", model="llava", **kwargs):
        s = MagicMock()
        s.llm_provider = provider
        s.llm_model = model
        s.openai_api_key = kwargs.get("openai_api_key", "")
        s.anthropic_api_key = kwargs.get("anthropic_api_key", "")
        s.groq_api_key = kwargs.get("groq_api_key", "")
        s.ollama_base_url = kwargs.get("ollama_base_url", "http://localhost:11434")
        return s

    def test_ollama_multimodal(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="ollama", model="llava:latest")):
            available, label = agent._check_vision_available()
        assert available is True
        assert "Ollama" in label

    def test_ollama_non_vision_model(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="ollama", model="llama3")):
            available, label = agent._check_vision_available()
        assert available is True  # Still returns True, but warns
        assert "may not support vision" in label

    def test_openai_with_key(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="openai", model="gpt-4o", openai_api_key="sk-test")):
            available, label = agent._check_vision_available()
        assert available is True
        assert "OpenAI" in label

    def test_openai_without_key(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="openai", model="gpt-4o", openai_api_key="")):
            with patch.dict("os.environ", {}, clear=True):
                available, label = agent._check_vision_available()
        assert available is False

    def test_anthropic_with_key(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="anthropic", model="claude-opus-4", anthropic_api_key="sk-ant-test")):
            available, label = agent._check_vision_available()
        assert available is True
        assert "Anthropic" in label

    def test_groq_with_key(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="groq", model="llama-3.2-vision", groq_api_key="gsk_test")):
            available, label = agent._check_vision_available()
        assert available is True
        assert "Groq" in label

    def test_unknown_provider(self):
        agent = self._agent()
        with patch("backend.config.settings", self._mock_settings(provider="unknownprovider", model="some-model")):
            available, label = agent._check_vision_available()
        assert available is False

    def test_agent_level_config_overrides_global(self):
        from backend.services.browser_agent import AgentLLMConfig
        cfg = AgentLLMConfig(provider="anthropic", model="claude-sonnet-4-6", api_key="sk-ant-override")
        agent = self._agent(llm_config=cfg)
        with patch("backend.config.settings", self._mock_settings(provider="ollama", model="llama3")):
            available, label = agent._check_vision_available()
        assert available is True
        assert "Anthropic" in label


# ---------------------------------------------------------------------------
# 7.  model_validator.check_cloud_provider_capabilities
# ---------------------------------------------------------------------------

class TestCheckCloudProviderCapabilities:
    def test_anthropic(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("anthropic", "claude-opus-4")
        assert caps["available"] is True
        assert caps["vision"] is True
        assert caps["tools"] is True
        assert caps["error"] is None

    def test_openai(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("openai", "gpt-4o")
        assert caps["available"] is True
        assert caps["vision"] is True
        assert caps["tools"] is True

    def test_groq_vision_model(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("groq", "llama-3.2-11b-vision-preview")
        assert caps["available"] is True
        assert caps["vision"] is True

    def test_groq_non_vision_model(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("groq", "llama3-8b-8192")
        # No vision hints in model name
        assert caps["available"] is True
        assert caps["vision"] is False

    def test_groq_tools_model(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("groq", "llama-3-70b-versatile")
        assert caps["tools"] is True

    def test_unknown_provider(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("unknownprovider", "some-model")
        assert caps["available"] is False
        assert caps["error"] is not None

    def test_lmstudio_vision_model(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("lmstudio", "llava-1.6")
        assert caps["available"] is True
        assert caps["vision"] is True

    def test_lmstudio_text_only_model(self):
        from backend.services.model_validator import check_cloud_provider_capabilities
        caps = check_cloud_provider_capabilities("lmstudio", "phi-2")
        assert caps["available"] is True
        assert caps["vision"] is False


# ---------------------------------------------------------------------------
# 8.  _build_prompt includes portal hint
# ---------------------------------------------------------------------------

class TestBuildPrompt:
    def _agent(self, url="https://boards.greenhouse.io/company/job/1"):
        from backend.services.browser_agent import ApplicationAgent
        return ApplicationAgent(
            agent_id="x",
            job_url=url,
            user_profile={"name": "Test User", "email": "test@example.com"},
        )

    def test_portal_hint_in_prompt(self):
        agent = self._agent()
        prompt = agent._build_prompt([], portal="greenhouse")
        assert "Greenhouse" in prompt

    def test_generic_portal_hint(self):
        agent = self._agent("https://careers.example.com/job/1")
        prompt = agent._build_prompt([], portal="generic")
        assert "Fill all visible" in prompt

    def test_stuck_warning_when_repeating(self):
        agent = self._agent()
        history = ["Click submit"] * 4
        prompt = agent._build_prompt(history, portal="generic")
        assert "stuck" in prompt.lower() or "repeating" in prompt.lower()

    def test_no_stuck_warning_with_varied_history(self):
        agent = self._agent()
        history = ["Fill email", "Fill name", "Click next", "Fill phone"]
        prompt = agent._build_prompt(history, portal="generic")
        # Should NOT have stuck warning
        assert "repeating the same action 4 times" not in prompt

    def test_request_help_instruction_present(self):
        agent = self._agent()
        prompt = agent._build_prompt([])
        assert "request_help" in prompt

    def test_request_review_instruction_present(self):
        agent = self._agent()
        prompt = agent._build_prompt([])
        assert "request_review" in prompt
