"""
AgentManager: singleton that manages all running ApplicationAgent instances
and broadcasts real-time events (screenshots, logs, status) to connected
WebSocket clients.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Optional

from fastapi import WebSocket


class AgentManager:
    """Central registry and broadcaster for all application agents."""

    def __init__(self):
        # agent_id -> ApplicationAgent
        self.agents: dict[str, "ApplicationAgent"] = {}
        # agent_id -> asyncio.Task
        self.tasks: dict[str, asyncio.Task] = {}
        # agent_id -> set[WebSocket]  (per-agent subscribers)
        self._agent_ws: dict[str, set[WebSocket]] = {}
        # global subscribers (receive lightweight events from every agent)
        self._global_ws: set[WebSocket] = set()

    # ── WebSocket management ──────────────────────────────────────────────────

    async def connect_global(self, ws: WebSocket):
        await ws.accept()
        self._global_ws.add(ws)
        # Send current state snapshot
        await self._send_ws(ws, "snapshot", self._all_snapshots())

    def disconnect_global(self, ws: WebSocket):
        self._global_ws.discard(ws)

    async def connect_agent(self, agent_id: str, ws: WebSocket):
        await ws.accept()
        self._agent_ws.setdefault(agent_id, set()).add(ws)
        # Send current agent state
        agent = self.agents.get(agent_id)
        if agent:
            await self._send_ws(ws, "snapshot", self._snapshot(agent))

    def disconnect_agent(self, agent_id: str, ws: WebSocket):
        self._agent_ws.get(agent_id, set()).discard(ws)

    # ── Agent lifecycle ───────────────────────────────────────────────────────

    def create_agent(
        self,
        job_url: str,
        user_profile: dict,
        job_title: str = "",
        company: str = "",
        resume_path: Optional[str] = None,
        application_id: Optional[str] = None,
        llm_config: Optional[dict] = None,
    ) -> str:
        from backend.services.browser_agent import ApplicationAgent, AgentLLMConfig

        agent_id = str(uuid.uuid4())

        # Convert dict to AgentLLMConfig if provided
        config_obj: Optional[AgentLLMConfig] = None
        if llm_config:
            config_obj = AgentLLMConfig(
                provider=llm_config.get("provider", ""),
                model=llm_config.get("model", ""),
                api_key=llm_config.get("api_key", ""),
                base_url=llm_config.get("base_url", ""),
            )

        agent = ApplicationAgent(
            agent_id=agent_id,
            job_url=job_url,
            user_profile=user_profile,
            resume_path=resume_path,
            headless=True,
            llm_config=config_obj,
        )
        agent.job_title = job_title
        agent.company = company
        agent.application_id = application_id

        # Wire up broadcast callback
        async def _cb(event_type: str, data):
            await self._on_event(agent_id, event_type, data)

        agent.add_callback(_cb)
        self.agents[agent_id] = agent
        return agent_id

    def start_agent(self, agent_id: str) -> asyncio.Task:
        agent = self.agents[agent_id]
        task = asyncio.create_task(agent.run())
        self.tasks[agent_id] = task
        return task

    def stop_agent(self, agent_id: str):
        agent = self.agents.get(agent_id)
        if agent:
            agent.stop()

    def remove_agent(self, agent_id: str):
        agent = self.agents.get(agent_id)
        if agent and agent.status == "running":
            agent.stop()
        self.agents.pop(agent_id, None)
        self.tasks.pop(agent_id, None)
        self._agent_ws.pop(agent_id, None)

    def respond_to_agent(self, agent_id: str, response: str) -> bool:
        """Deliver human response to a waiting agent. Returns True if agent was found and waiting."""
        agent = self.agents.get(agent_id)
        if not agent:
            return False
        if agent.status not in ("review_requested", "help_requested"):
            return False
        agent.set_human_response(response)
        return True

    def get_info(self, agent_id: str) -> dict | None:
        agent = self.agents.get(agent_id)
        return self._snapshot(agent) if agent else None

    def list_all(self) -> list[dict]:
        return [self._snapshot(a) for a in self.agents.values()]

    # ── Event broadcasting ────────────────────────────────────────────────────

    async def _on_event(self, agent_id: str, event_type: str, data):
        """Called by agent callbacks; fans out to subscribed WebSockets."""
        msg = json.dumps({"agent_id": agent_id, "type": event_type, "data": data})

        # Per-agent subscribers get full events (including full screenshots)
        await self._fan_out(msg, self._agent_ws.get(agent_id, set()))

        # Global subscribers get lightweight versions (no full screenshot data)
        if event_type == "screenshot":
            # Send only status refresh to global listeners
            status_msg = json.dumps({
                "agent_id": agent_id,
                "type": "agent_update",
                "data": self._snapshot_light(self.agents.get(agent_id)),
            })
            await self._fan_out(status_msg, self._global_ws)
        else:
            await self._fan_out(msg, self._global_ws)

    async def _fan_out(self, msg: str, ws_set: set[WebSocket]):
        dead: set[WebSocket] = set()
        for ws in ws_set:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        ws_set -= dead

    @staticmethod
    async def _send_ws(ws: WebSocket, event_type: str, data):
        try:
            await ws.send_text(json.dumps({"type": event_type, "data": data}))
        except Exception:
            pass

    # ── Snapshot helpers ──────────────────────────────────────────────────────

    def _snapshot(self, agent) -> dict:
        llm_config = getattr(agent, "llm_config", None)
        return {
            "id": agent.agent_id,
            "job_url": agent.job_url,
            "job_title": getattr(agent, "job_title", ""),
            "company": getattr(agent, "company", ""),
            "status": agent.status,
            "current_action": agent.current_action,
            "log": agent.log[-30:],
            "screenshot_b64": agent.screenshot_b64,
            "error": agent.error,
            "application_id": getattr(agent, "application_id", None),
            "interaction_pending": getattr(agent, "interaction_pending", None),
            "llm_provider": llm_config.provider if llm_config else "",
            "llm_model": llm_config.model if llm_config else "",
        }

    def _snapshot_light(self, agent) -> dict | None:
        if not agent:
            return None
        llm_config = getattr(agent, "llm_config", None)
        return {
            "id": agent.agent_id,
            "job_url": agent.job_url,
            "job_title": getattr(agent, "job_title", ""),
            "company": getattr(agent, "company", ""),
            "status": agent.status,
            "current_action": agent.current_action,
            "error": agent.error,
            "interaction_pending": getattr(agent, "interaction_pending", None),
            "llm_provider": llm_config.provider if llm_config else "",
            "llm_model": llm_config.model if llm_config else "",
        }

    def _all_snapshots(self) -> list[dict]:
        return [self._snapshot(a) for a in self.agents.values()]


# ── Module-level singleton ────────────────────────────────────────────────────

agent_manager = AgentManager()
