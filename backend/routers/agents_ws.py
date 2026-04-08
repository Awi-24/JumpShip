"""
JumpShip V2 — Agent WebSocket router.

Replaces the SSE stream in auto_apply.py with a bi-directional WebSocket
connection so the frontend can:
  1. Receive real-time agent status / trace events (push from server)
  2. Submit HITL responses when the Apply graph pauses (push from client)
  3. Trigger Scout / Matcher / Apply runs directly

Endpoints:
  WS  /api/ws/agents                  — main real-time channel
  POST /api/agents/scout              — start a Scout run
  POST /api/agents/apply              — enqueue an Apply run
  POST /api/agents/{thread_id}/resume — resume a paused (HITL) Apply run
  GET  /api/agents/threads            — list all agent threads
  GET  /api/agents/threads/{thread_id} — get a single thread snapshot
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import engine
from backend.models.db_models import AgentThread, UserProfile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents-v2"])


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    """Broadcast server-side events to all connected WebSocket clients."""

    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)
        logger.info("WS client connected (%d total)", len(self._connections))

    def disconnect(self, ws: WebSocket):
        try:
            self._connections.remove(ws)
        except ValueError:
            pass
        logger.info("WS client disconnected (%d total)", len(self._connections))

    async def broadcast(self, event: dict):
        msg = json.dumps(event)
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to(self, ws: WebSocket, event: dict):
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            self.disconnect(ws)


manager = ConnectionManager()


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.get("/agents/graphs/{graph_name}/svg")
async def get_graph_svg(graph_name: str):
    """
    Returns an SVG visualization of the requested agent graph (LangGraph).
    Uses .get_graph().draw_mermaid_png() if pygraphviz is available,
    but we'll prefer mermaid-to-svg via an internal helper.
    """
    try:
        if graph_name == "scout":
            from backend.agents.scout_graph import build_scout_graph
            graph = build_scout_graph()
        elif graph_name == "matcher":
            from backend.agents.matcher_graph import build_matcher_graph
            graph = build_matcher_graph()
        elif graph_name == "apply":
            from backend.agents.apply_graph import build_apply_graph
            graph = build_apply_graph()
        elif graph_name == "inbox":
            from backend.agents.inbox_graph import build_inbox_graph
            graph = build_inbox_graph()
        else:
            raise HTTPException(status_code=404, detail="Graph not found")

        # LangGraph .get_graph().draw_mermaid_png() requires extra dependencies.
        # We'll use draw_mermaid() and return it as a string if we don't want to add deps,
        # OR use the built-in draw_mermaid_png() if it works.
        # For now, let's return the Mermaid text so the frontend can render it,
        # OR use the .draw_mermaid_png() which returns bytes.
        
        # Try to get PNG bytes
        try:
            png_bytes = graph.get_graph().draw_mermaid_png()
            return Response(content=png_bytes, media_type="image/png")
        except Exception:
            # Fallback to Mermaid text if PNG generation fails
            mermaid_text = graph.get_graph().draw_mermaid()
            return {"mermaid": mermaid_text}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate graph: {e}")

@router.websocket("/ws/agents")
async def agents_websocket(ws: WebSocket):
    """
    Bi-directional WebSocket channel.

    Client → Server messages (JSON):
      {"type": "ping"}
      {"type": "hitl_response", "thread_id": "...", "response": "..."}
      {"type": "cancel", "thread_id": "..."}

    Server → Client messages (JSON):
      {"type": "pong"}
      {"type": "thread_update", "thread": {...}}
      {"type": "trace_event",   "thread_id": "...", "event": {...}}
      {"type": "hitl_needed",   "thread_id": "...", "question": "..."}
      {"type": "error",         "message": "..."}
    """
    await manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send_to(ws, {"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "ping":
                await manager.send_to(ws, {"type": "pong"})

            elif msg_type == "hitl_response":
                thread_id = msg.get("thread_id", "")
                response  = msg.get("response", "")
                asyncio.create_task(_resume_hitl(thread_id, response))

            elif msg_type == "cancel":
                thread_id = msg.get("thread_id", "")
                _cancel_thread(thread_id)

            else:
                await manager.send_to(ws, {"type": "error", "message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Active thread registry ────────────────────────────────────────────────────
# Maps thread_id → asyncio.Task so we can cancel running apply runs.
_active_tasks: dict[str, asyncio.Task] = {}


def _register_active_task(thread_id: str, task: asyncio.Task):
    """Add a task to the registry and ensure it's removed when done."""
    _active_tasks[thread_id] = task
    task.add_done_callback(lambda t: _active_tasks.pop(thread_id, None))


def _cancel_thread(thread_id: str):
    task = _active_tasks.get(thread_id)
    if task and not task.done():
        task.cancel()
        logger.info("Cancelled thread %s", thread_id)


# ── HITL resume ───────────────────────────────────────────────────────────────

async def _resume_hitl(thread_id: str, response: str):
    from backend.agents.apply_graph import resume_apply

    try:
        state = await resume_apply(
            thread_id=thread_id,
            hitl_response=response,
            on_update=lambda evt: manager.broadcast({
                "type": "trace_event",
                "thread_id": thread_id,
                "event": evt,
            }),
        )
        _update_thread_db(thread_id, state.get("status", "failed"), state.get("error", ""))
        await manager.broadcast({
            "type": "thread_update",
            "thread": _thread_snapshot(thread_id, state),
        })
    except Exception as exc:
        logger.error("HITL resume failed for %s: %s", thread_id, exc)
        await manager.broadcast({"type": "error", "message": str(exc)[:200]})


# ── REST: start Scout run ─────────────────────────────────────────────────────

class ScoutRequest(BaseModel):
    resume_text: str = ""
    preferences: dict[str, Any] = {}


@router.post("/agents/scout")
async def start_scout(req: ScoutRequest):
    """Kick off a Scout run and return the thread_id to track it."""
    from backend.agents.scout_graph import run_scout

    thread_id = str(uuid.uuid4())
    _register_thread(thread_id, "scout", summary="Discovering jobs…")

    async def _run():
        try:
            jobs = await run_scout(
                resume_text = req.resume_text,
                preferences = req.preferences,
                thread_id   = thread_id,
            )
            _update_thread_db(thread_id, "success", f"Found {len(jobs)} jobs")
            await manager.broadcast({
                "type": "thread_update",
                "thread": {"thread_id": thread_id, "status": "success", "jobs": jobs},
            })
        except Exception as exc:
            _update_thread_db(thread_id, "failed", str(exc)[:200])
            await manager.broadcast({
                "type": "error",
                "message": f"Scout failed: {exc}",
                "thread_id": thread_id,
            })

    task = asyncio.create_task(_run())
    _register_active_task(thread_id, task)
    return {"thread_id": thread_id, "status": "running"}


# ── REST: start Apply run ─────────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    job:            dict[str, Any]
    resume_text:    str  = ""
    resume_path:    str | None = None
    dry_run:        bool = True
    headless:       bool = True
    llm_model:      str | None = None
    ollama_base_url: str | None = None


@router.post("/agents/apply")
async def start_apply(req: ApplyRequest):
    """Enqueue an Apply run for a single job."""
    from backend.agents.apply_graph import run_apply

    thread_id = str(uuid.uuid4())
    job_title = req.job.get("title", "")
    company   = req.job.get("company", "")
    _register_thread(
        thread_id, "apply",
        job_title=job_title, company=company,
        summary="Queued",
    )

    # Load profile from DB
    with Session(engine) as db:
        profile_row = db.get(UserProfile, "singleton")
        if not profile_row:
            _update_thread_db(thread_id, "failed", "No user profile configured")
            return {"thread_id": thread_id, "status": "failed", "error": "No profile"}
        profile = {c.name: getattr(profile_row, c.name) for c in profile_row.__table__.columns}
        if profile.get("linkedin_password"):
            profile["linkedin_password"] = decrypt(profile["linkedin_password"])

    async def _run():
        try:
            async def on_update(evt: dict):
                await manager.broadcast({
                    "type": "trace_event",
                    "thread_id": thread_id,
                    "event": evt,
                })

            state = await run_apply(
                job             = req.job,
                profile         = profile,
                resume_text     = req.resume_text,
                resume_path     = req.resume_path,
                dry_run         = req.dry_run,
                headless        = req.headless,
                llm_model       = req.llm_model,
                ollama_base_url = req.ollama_base_url,
                thread_id       = thread_id,
                on_update       = on_update,
            )
            final_status = state.get("status", "failed")

            # If the graph paused for HITL, notify the frontend
            if final_status == "needs_help" and state.get("hitl_question"):
                _update_thread_db(thread_id, "waiting_hitl", state["hitl_question"])
                await manager.broadcast({
                    "type": "hitl_needed",
                    "thread_id": thread_id,
                    "question":  state["hitl_question"],
                })
                return

            _update_thread_db(thread_id, final_status, state.get("error", ""))
            await manager.broadcast({
                "type": "thread_update",
                "thread": _thread_snapshot(thread_id, state),
            })
        except asyncio.CancelledError:
            _update_thread_db(thread_id, "failed", "Cancelled")
            await manager.broadcast({
                "type": "thread_update",
                "thread": {"thread_id": thread_id, "status": "cancelled"},
            })
        except Exception as exc:
            logger.error("Apply run %s crashed: %s", thread_id, exc, exc_info=True)
            _update_thread_db(thread_id, "failed", str(exc)[:300])
            await manager.broadcast({
                "type": "error",
                "message": f"Apply crashed: {exc}",
                "thread_id": thread_id,
            })

    task = asyncio.create_task(_run())
    _register_active_task(thread_id, task)
    return {"thread_id": thread_id, "status": "running"}


# ── REST: resume HITL ─────────────────────────────────────────────────────────

class HITLReply(BaseModel):
    response: str


@router.post("/agents/{thread_id}/resume")
async def resume_thread(thread_id: str, body: HITLReply):
    """Resume a graph paused at a HITL interrupt."""
    asyncio.create_task(_resume_hitl(thread_id, body.response))
    return {"thread_id": thread_id, "status": "resuming"}


# ── REST: list / get threads ──────────────────────────────────────────────────

@router.get("/agents/threads")
def list_threads():
    with Session(engine) as db:
        rows = db.query(AgentThread).order_by(AgentThread.created_at.desc()).limit(100).all()
        return [_row_to_dict(r) for r in rows]


@router.get("/agents/threads/{thread_id}")
def get_thread(thread_id: str):
    with Session(engine) as db:
        row = db.query(AgentThread).filter(AgentThread.thread_id == thread_id).first()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Thread not found")
        return _row_to_dict(row)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _register_thread(
    thread_id: str,
    graph_name: str,
    job_title: str = "",
    company: str = "",
    summary: str = "",
):
    with Session(engine) as db:
        row = AgentThread(
            id=str(uuid.uuid4()),
            thread_id=thread_id,
            graph_name=graph_name,
            job_title=job_title,
            company=company,
            status="running",
            summary=summary,
        )
        db.add(row)
        db.commit()


def _update_thread_db(thread_id: str, status: str, summary: str = ""):
    with Session(engine) as db:
        row = db.query(AgentThread).filter(AgentThread.thread_id == thread_id).first()
        if row:
            row.status  = status
            row.summary = summary[:500]
            row.updated_at = datetime.now(timezone.utc)
            db.commit()


def _row_to_dict(row: AgentThread) -> dict:
    return {
        "id":         row.id,
        "thread_id":  row.thread_id,
        "graph_name": row.graph_name,
        "job_title":  row.job_title,
        "company":    row.company,
        "status":     row.status,
        "summary":    row.summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _thread_snapshot(thread_id: str, state: dict) -> dict:
    return {
        "thread_id":     thread_id,
        "status":        state.get("status", "unknown"),
        "fields_filled": state.get("fields_filled", {}),
        "error":         state.get("error", ""),
        "hitl_question": state.get("hitl_question"),
    }
