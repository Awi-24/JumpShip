"""
JumpShip — Auto-apply & Agent Queue endpoints.

Queue management:
  POST   /api/auto-apply/queue            Add a job to the agent queue
  GET    /api/auto-apply/queue            Current queue state
  DELETE /api/auto-apply/queue/{id}       Cancel a queued task
  POST   /api/auto-apply/queue/clear      Remove completed/failed tasks
  POST   /api/auto-apply/pause            Pause all workers
  POST   /api/auto-apply/resume           Resume workers
  POST   /api/auto-apply/workers          Set concurrency (1-5)
  POST   /api/auto-apply/llm-config       Store LLM config for agent use
  GET    /api/auto-apply/stream           SSE — real-time task updates

Legacy (single-shot, kept for backward compat):
  POST   /api/auto-apply/run              Fire-and-forget single apply
  GET    /api/auto-apply/logs             Past apply log entries
  GET    /api/auto-apply/logs/{id}        Single log entry
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import engine
from backend.models.db_models import AutoApplyLog, UserProfile
from backend.services.apply_agent import _detect_platform
from backend.services.orchestrator import AgentOrchestrator, ApplyTask

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auto-apply"])

_PROFILE_ID = "singleton"


# ── Schemas ───────────────────────────────────────────────────────────────────────

class EnqueueRequest(BaseModel):
    job_url:     str
    job_title:   Optional[str] = ""
    company:     Optional[str] = ""
    dry_run:     bool = True
    headless:    bool = True
    resume_path: Optional[str] = None

class WorkersRequest(BaseModel):
    count: int   # 1-5

class LLMConfigRequest(BaseModel):
    provider: Optional[str] = None
    model:    Optional[str] = None
    api_key:  Optional[str] = None
    base_url: Optional[str] = None

class HumanHelpResponse(BaseModel):
    response: str

class ApplyLogOut(BaseModel):
    id:            str
    job_url:       str
    job_title:     Optional[str]
    company:       Optional[str]
    platform:      Optional[str]
    status:        str
    error:         Optional[str]
    screenshot:    Optional[str]
    fields_filled: Optional[dict]
    started_at:    str
    finished_at:   Optional[str]

    model_config = {"from_attributes": True}

# Legacy single-shot schema
class LegacyApplyRequest(BaseModel):
    job_url:      str
    job_title:    Optional[str] = ""
    company:      Optional[str] = ""
    platform:     Optional[str] = ""
    resume_path:  Optional[str] = None
    dry_run:      bool = True
    headless:     bool = True
    llm_provider: Optional[str] = None
    llm_model:    Optional[str] = None
    llm_api_key:  Optional[str] = None
    llm_base_url: Optional[str] = None


# ── Orchestrator accessor ─────────────────────────────────────────────────────────

def _orc(request: Request) -> AgentOrchestrator:
    return request.app.state.orchestrator


# ── Queue endpoints ────────────────────────────────────────────────────────────────

@router.post("/api/auto-apply/queue")
async def enqueue_job(req: EnqueueRequest, request: Request):
    """Add a job to the autonomous agent queue."""
    orc = _orc(request)
    task = ApplyTask(
        job_url    = req.job_url,
        job_title  = req.job_title or "",
        company    = req.company   or "",
        platform   = _detect_platform(req.job_url),
        dry_run    = req.dry_run,
        headless   = req.headless,
        resume_path= req.resume_path,
    )
    await orc.enqueue(task)
    return {"ok": True, "task_id": task.id, "message": f"Queued: {task.job_title or task.job_url[:60]}"}


@router.get("/api/auto-apply/queue")
def get_queue(request: Request):
    """Return current orchestrator state and all tasks."""
    return _orc(request).get_state()


@router.delete("/api/auto-apply/queue/{task_id}")
def cancel_task(task_id: str, request: Request):
    ok = _orc(request).cancel_task(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found or already completed.")
    return {"ok": True}


@router.post("/api/auto-apply/queue/clear")
def clear_completed(request: Request):
    _orc(request).clear_completed()
    return {"ok": True}


@router.post("/api/auto-apply/queue/{task_id}/retry")
async def retry_task(task_id: str, request: Request):
    """Manually retry a failed or needs_review task."""
    ok = await _orc(request).retry_task(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found or not in a retryable state.")
    return {"ok": True}


@router.post("/api/auto-apply/pause")
def pause_queue(request: Request):
    _orc(request).pause()
    return {"ok": True, "paused": True}


@router.post("/api/auto-apply/resume")
def resume_queue(request: Request):
    _orc(request).resume()
    return {"ok": True, "paused": False}


@router.post("/api/auto-apply/workers")
def set_workers(req: WorkersRequest, request: Request):
    orc = _orc(request)
    orc.set_workers(req.count)
    return {"ok": True, "max_workers": orc.max_workers}


@router.post("/api/auto-apply/llm-config")
def set_llm_config(req: LLMConfigRequest, request: Request):
    """Store LLM config so workers use the user's chosen model."""
    orc = _orc(request)
    orc.llm_config = {k: v for k, v in req.model_dump().items() if v}
    return {"ok": True}


@router.post("/api/auto-apply/queue/{task_id}/help")
def deliver_human_help(task_id: str, req: HumanHelpResponse, request: Request):
    """
    Deliver a human response to an agent that called request_human_help.
    The agent resumes immediately after receiving this.
    """
    orc = _orc(request)
    delivered = orc.deliver_human_response(task_id, req.response)
    if not delivered:
        raise HTTPException(
            status_code=409,
            detail="Task is not currently waiting for human help, or does not exist.",
        )
    return {"ok": True, "task_id": task_id}


# ── SSE stream ────────────────────────────────────────────────────────────────────

@router.get("/api/auto-apply/stream")
async def sse_stream(request: Request):
    """
    Server-Sent Events endpoint. Streams real-time task updates to the frontend.
    Each event is a JSON object: { type, task? | state? }
    """
    orc = _orc(request)
    q = orc.subscribe()

    async def event_gen():
        try:
            # Initial state dump on connect
            state = orc.get_state()
            yield f"data: {json.dumps({'type': 'init', 'state': state})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield msg
                except asyncio.TimeoutError:
                    yield 'data: {"type":"ping"}\n\n'
        finally:
            orc.unsubscribe(q)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Legacy single-shot endpoint ───────────────────────────────────────────────────

@router.post("/api/auto-apply/run", response_model=ApplyLogOut)
async def legacy_run(req: LegacyApplyRequest, request: Request):
    """
    Single-shot apply (legacy). Adds to the orchestrator queue and returns
    immediately with a task ID. Use GET /api/auto-apply/queue to monitor.
    """
    orc = _orc(request)
    if req.llm_provider or req.llm_model or req.llm_api_key or req.llm_base_url:
        orc.llm_config = {
            "provider": req.llm_provider,
            "model":    req.llm_model,
            "api_key":  req.llm_api_key,
            "base_url": req.llm_base_url,
        }

    task = ApplyTask(
        job_url    = req.job_url,
        job_title  = req.job_title or "",
        company    = req.company   or "",
        platform   = req.platform  or _detect_platform(req.job_url),
        dry_run    = req.dry_run,
        headless   = req.headless,
        resume_path= req.resume_path,
    )
    await orc.enqueue(task)

    # Create a DB log entry so legacy polling still works
    with Session(engine) as db:
        log_row = AutoApplyLog(
            job_url   = task.job_url,
            job_title = task.job_title,
            company   = task.company,
            platform  = task.platform,
            status    = "running",
        )
        db.add(log_row)
        db.commit()
        db.refresh(log_row)
        return ApplyLogOut.model_validate(log_row)


# ── Log history ───────────────────────────────────────────────────────────────────

@router.get("/api/auto-apply/logs", response_model=list[ApplyLogOut])
def list_logs(limit: int = 50):
    with Session(engine) as db:
        rows = (
            db.query(AutoApplyLog)
            .order_by(AutoApplyLog.started_at.desc())
            .limit(limit)
            .all()
        )
        return [ApplyLogOut.model_validate(r) for r in rows]


@router.get("/api/auto-apply/logs/{log_id}", response_model=ApplyLogOut)
def get_log(log_id: str):
    with Session(engine) as db:
        row = db.get(AutoApplyLog, log_id)
        if not row:
            raise HTTPException(status_code=404, detail="Log not found.")
        return ApplyLogOut.model_validate(row)


# ── Trace history ─────────────────────────────────────────────────────────────────

class TraceEventOut(BaseModel):
    id: str
    task_id: str
    step: int
    event_type: str
    content: dict
    timestamp: str

    model_config = {"from_attributes": True}


@router.get("/api/auto-apply/queue/{task_id}/trace", response_model=list[TraceEventOut])
def get_task_trace(task_id: str):
    """Return all trace events for a given task, ordered by step."""
    from backend.models.db_models import TraceEvent
    with Session(engine) as db:
        rows = (
            db.query(TraceEvent)
            .filter(TraceEvent.task_id == task_id)
            .order_by(TraceEvent.step, TraceEvent.timestamp)
            .all()
        )
        return [
            TraceEventOut(
                id=r.id,
                task_id=r.task_id,
                step=r.step,
                event_type=r.event_type,
                content=r.content or {},
                timestamp=r.timestamp.isoformat() if r.timestamp else "",
            )
            for r in rows
        ]
