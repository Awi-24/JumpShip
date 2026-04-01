"""
Router for multi-agent job application automation and real-time monitoring.

REST endpoints:
  GET  /api/agents           — list all agents
  POST /api/agents/start     — launch a new agent
  GET  /api/agents/{id}      — get agent details + screenshot
  POST /api/agents/{id}/stop — signal agent to stop
  POST /api/agents/{id}/respond — deliver human response to waiting agent
  DELETE /api/agents/{id}    — remove finished agent
  GET  /api/agents/models/check  — check model capabilities
  GET  /api/agents/models/list   — list Ollama models

WebSocket endpoints:
  WS /api/agents/ws          — subscribe to ALL agent events
  WS /api/agents/ws/{id}     — subscribe to a specific agent
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.agent_manager import agent_manager

router = APIRouter(prefix="/api/agents", tags=["agents"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class StartAgentRequest(BaseModel):
    job_url: str
    job_title: str = ""
    company: str = ""
    resume_path: Optional[str] = None
    application_id: Optional[str] = None
    # Per-agent LLM config (overrides global settings)
    llm_provider: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    llm_base_url: str = ""


class RespondRequest(BaseModel):
    response: str


# ── REST Endpoints ────────────────────────────────────────────────────────────


@router.get("")
def list_agents():
    """Return all agents (running and historical)."""
    agents = agent_manager.list_all()
    return {
        "agents": agents,
        "count": len(agents),
        "running": sum(1 for a in agents if a["status"] == "running"),
    }


@router.post("/start")
async def start_agent(req: StartAgentRequest, db: Session = Depends(get_db)):
    """
    Start a new application agent for the given job URL.
    The user's stored profile is loaded from the database automatically.
    """
    from backend.routers.user_profile import _get_profile_dict

    user_profile = _get_profile_dict(db)

    if not user_profile.get("name") or not user_profile.get("email"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Your profile is incomplete. "
                "Please fill in at least your name and email in the Profile page first."
            ),
        )

    # Build per-agent LLM config dict (only pass non-empty values)
    llm_config: Optional[dict] = None
    if any([req.llm_provider, req.llm_model, req.llm_api_key, req.llm_base_url]):
        llm_config = {
            "provider": req.llm_provider,
            "model": req.llm_model,
            "api_key": req.llm_api_key,
            "base_url": req.llm_base_url,
        }

    agent_id = agent_manager.create_agent(
        job_url=req.job_url,
        user_profile=user_profile,
        job_title=req.job_title,
        company=req.company,
        resume_path=req.resume_path,
        application_id=req.application_id,
        llm_config=llm_config,
    )

    agent_manager.start_agent(agent_id)

    return {"agent_id": agent_id, "status": "started", "message": "Agent launched successfully."}


@router.get("/models/check")
async def check_model(provider: str, model: str, api_key: str = "", base_url: str = ""):
    """Check if a model has vision and tool capabilities."""
    from backend.services.model_validator import check_ollama_model, check_cloud_provider_capabilities
    from backend.config import settings

    if provider in ("ollama", "lmstudio", "openclaw"):
        effective_base_url = base_url or settings.ollama_base_url
        caps = await check_ollama_model(model, effective_base_url)
    else:
        caps = check_cloud_provider_capabilities(provider, model)

    return {"provider": provider, "model": model, "capabilities": caps}


@router.get("/models/list")
async def list_models(base_url: str = ""):
    """List available Ollama models with their capabilities."""
    from backend.services.model_validator import list_ollama_models
    from backend.config import settings

    effective_base_url = base_url or settings.ollama_base_url
    models = await list_ollama_models(effective_base_url)
    return {"models": models, "count": len(models)}


@router.get("/{agent_id}")
def get_agent(agent_id: str):
    """Return full details (including latest screenshot) for a single agent."""
    info = agent_manager.get_info(agent_id)
    if not info:
        raise HTTPException(status_code=404, detail="Agent not found.")
    return info


@router.post("/{agent_id}/stop")
def stop_agent(agent_id: str):
    """Send a stop signal to a running agent."""
    if agent_id not in agent_manager.agents:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent_manager.stop_agent(agent_id)
    return {"message": "Stop signal sent.", "agent_id": agent_id}


@router.post("/{agent_id}/respond")
def respond_to_agent(agent_id: str, req: RespondRequest):
    """Human responds to an agent's help/review request."""
    if agent_id not in agent_manager.agents:
        raise HTTPException(status_code=404, detail="Agent not found.")
    delivered = agent_manager.respond_to_agent(agent_id, req.response)
    if not delivered:
        raise HTTPException(
            status_code=409,
            detail="Agent is not currently waiting for a response.",
        )
    return {"message": "Response delivered.", "agent_id": agent_id, "response": req.response}


@router.delete("/{agent_id}")
def delete_agent(agent_id: str):
    """Remove an agent (stops it first if still running)."""
    if agent_id not in agent_manager.agents:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent_manager.remove_agent(agent_id)
    return {"message": "Agent removed.", "agent_id": agent_id}


# ── WebSocket Endpoints ───────────────────────────────────────────────────────


@router.websocket("/ws")
async def ws_all_agents(websocket: WebSocket):
    """WebSocket: receive lightweight real-time updates from ALL agents."""
    await agent_manager.connect_global(websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        agent_manager.disconnect_global(websocket)


@router.websocket("/ws/{agent_id}")
async def ws_single_agent(agent_id: str, websocket: WebSocket):
    """WebSocket: receive full real-time updates (including screenshots) for one agent."""
    await agent_manager.connect_agent(agent_id, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        agent_manager.disconnect_agent(agent_id, websocket)
