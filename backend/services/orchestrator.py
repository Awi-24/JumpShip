"""
JumpShip — Agent Orchestrator.

Manages a queue of auto-apply tasks and runs them with configurable concurrency.
One singleton instance is attached to the FastAPI app state during startup.

Features:
  - Configurable worker pool (1-5 concurrent Playwright sessions)
  - Pause / resume all workers
  - Cancel individual queued tasks
  - SSE broadcast so the frontend gets real-time status without polling
  - Per-task step messages piped back via status_callback
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ── Ollama connectivity check (replaces the old 120 s readiness test) ────────────

async def _check_ollama(base_url: str, model: str) -> dict:
    """
    Fast check (< 5 s): is Ollama reachable and is the requested model available?
    Returns {"ready": bool, "error": str | None}.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{base_url}/api/tags")
            if r.status_code != 200:
                return {"ready": False, "error": f"Ollama returned HTTP {r.status_code}"}
            models = [m["name"] for m in r.json().get("models", [])]
            model_base = model.split(":")[0].lower()
            found = any(model_base in m.lower() for m in models)
            if not found:
                available = ", ".join(models) or "none"
                return {
                    "ready": False,
                    "error": (
                        f"Model '{model}' not found in Ollama. "
                        f"Run: ollama pull {model}  |  Available: {available}"
                    ),
                }
            return {"ready": True, "error": None}
    except httpx.ConnectError:
        return {
            "ready": False,
            "error": f"Cannot connect to Ollama at {base_url}. Run: ollama serve",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc)[:200]}


# ── Task model ───────────────────────────────────────────────────────────────────

TRANSIENT_ERRORS = ("timeout", "net::", "ERR_CONNECTION", "Page crashed", "Navigation failed")

@dataclass
class ApplyTask:
    id:           str       = field(default_factory=lambda: str(uuid.uuid4())[:8])
    job_url:      str       = ""
    job_title:    str       = ""
    company:      str       = ""
    platform:     str       = ""
    dry_run:      bool      = True
    headless:     bool      = True
    resume_path:  str | None = None
    # runtime state
    status:       str       = "queued"   # queued | running | success | failed | cancelled | needs_review
    message:      str       = ""
    error:        str       = ""
    fields_filled: dict     = field(default_factory=dict)
    queued_at:    str       = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at:   str | None = None
    finished_at:  str | None = None
    # retry support
    max_retries:  int       = 1
    retry_count:  int       = 0

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "job_url":      self.job_url,
            "job_title":    self.job_title,
            "company":      self.company,
            "platform":     self.platform,
            "dry_run":      self.dry_run,
            "status":       self.status,
            "message":      self.message,
            "error":        self.error,
            "fields_count": len(self.fields_filled),
            "queued_at":    self.queued_at,
            "started_at":   self.started_at,
            "finished_at":  self.finished_at,
            "retry_count":  self.retry_count,
            "max_retries":  self.max_retries,
        }

    def is_transient_error(self) -> bool:
        """Check if the error looks transient and worth retrying."""
        if not self.error:
            return False
        err_lower = self.error.lower()
        return any(t.lower() in err_lower for t in TRANSIENT_ERRORS)


# ── Orchestrator ─────────────────────────────────────────────────────────────────

class AgentOrchestrator:
    """
    Async worker pool that processes ApplyTask items from an internal queue.

    Lifecycle (managed by FastAPI lifespan):
        await orchestrator.start()
        ...
        await orchestrator.stop()
    """

    def __init__(self, max_workers: int = 2):
        self.max_workers = max(1, min(max_workers, 5))
        self._queue:   asyncio.Queue[ApplyTask] = asyncio.Queue()
        self._tasks:   dict[str, ApplyTask]     = {}   # id → task (all, including done)
        self._workers: list[asyncio.Task]        = []
        self._running: bool                      = False
        self._paused:  bool                      = False
        self._resume:  asyncio.Event             = asyncio.Event()
        self._resume.set()                               # start un-paused
        self._sse_subs: list[asyncio.Queue[str]] = []   # one per SSE client
        self._cancel_events: dict[str, asyncio.Event] = {}
        # Active ApplicationAgent instances keyed by task_id (for human help delivery)
        self._active_agents: dict[str, "ApplicationAgent"] = {}
        # LLM config set by the frontend (persisted in memory, reset on restart)
        self.llm_config: dict = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True

        # Restore task history from DB so UI shows past runs
        self._load_persisted_tasks()

        for i in range(self.max_workers):
            t = asyncio.create_task(self._worker(i), name=f"apply-worker-{i}")
            self._workers.append(t)
        logger.info("AgentOrchestrator started (%d workers)", self.max_workers)

        if not self.llm_config:
            asyncio.create_task(self._auto_select_model())

    async def _auto_select_model(self):
        """Probe local providers and auto-populate llm_config with the first available model."""
        try:
            from backend.routers.models import discover_providers
            providers = await discover_providers()
            for p in providers:
                if p.reachable and p.models:
                    self.llm_config = {
                        "provider": p.id,
                        "model": p.models[0].id,
                        "base_url": p.base_url,
                    }
                    logger.info(
                        "Auto-selected model: %s / %s from %s",
                        p.id, p.models[0].id, p.base_url,
                    )
                    await self._broadcast({
                        "type": "model_selected",
                        "provider": p.id,
                        "model": p.models[0].id,
                    })
                    return
            logger.info("No local LLM providers found — agent will use .env defaults")
        except Exception as exc:
            logger.warning("Auto-select model failed: %s", exc)

    async def stop(self):
        self._running = False
        for w in self._workers:
            w.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        logger.info("AgentOrchestrator stopped")

    # ── Queue control ─────────────────────────────────────────────────────────────

    async def enqueue(self, task: ApplyTask) -> ApplyTask:
        self._tasks[task.id] = task
        self._persist_task(task)
        await self._queue.put(task)
        await self._broadcast({"type": "task_added", "task": task.to_dict()})
        logger.info("Enqueued task %s (%s)", task.id, task.job_title or task.job_url[:60])
        return task

    def cancel_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if not task:
            return False
        if task.status == "queued":
            task.status = "cancelled"
            task.message = "Cancelled by user"
            task.finished_at = datetime.now(timezone.utc).isoformat()
            self._persist_task(task)
            asyncio.create_task(self._broadcast({"type": "task_update", "task": task.to_dict()}))
            return True
        if task.status == "running":
            cancel_evt = self._cancel_events.get(task_id)
            if cancel_evt:
                cancel_evt.set()
            task.status = "cancelled"
            task.message = "Cancelled by user (stopping agent…)"
            task.finished_at = datetime.now(timezone.utc).isoformat()
            self._persist_task(task)
            asyncio.create_task(self._broadcast({"type": "task_update", "task": task.to_dict()}))
            return True
        return False

    def clear_completed(self):
        done_ids = [
            tid for tid, t in self._tasks.items()
            if t.status in ("success", "failed", "cancelled", "needs_review")
        ]
        for tid in done_ids:
            del self._tasks[tid]
        asyncio.create_task(self._broadcast({"type": "cleared"}))

    def set_workers(self, count: int):
        """Update desired concurrency (takes effect after restart)."""
        self.max_workers = max(1, min(count, 5))

    # ── Pause / Resume ────────────────────────────────────────────────────────────

    def pause(self):
        self._paused = True
        self._resume.clear()
        asyncio.create_task(self._broadcast({"type": "paused"}))

    def resume(self):
        self._paused = False
        self._resume.set()
        asyncio.create_task(self._broadcast({"type": "resumed"}))

    # ── State snapshot ────────────────────────────────────────────────────────────

    def get_state(self) -> dict:
        tasks = sorted(self._tasks.values(), key=lambda t: t.queued_at, reverse=True)
        return {
            "paused":       self._paused,
            "running":      self._running,
            "max_workers":  self.max_workers,
            "active":       sum(1 for t in tasks if t.status == "running"),
            "queued":       sum(1 for t in tasks if t.status == "queued"),
            "done":         sum(1 for t in tasks if t.status in ("success", "needs_review")),
            "failed":       sum(1 for t in tasks if t.status == "failed"),
            "tasks":        [t.to_dict() for t in tasks],
        }

    # ── SSE subscriptions ─────────────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
        self._sse_subs.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]):
        try:
            self._sse_subs.remove(q)
        except ValueError:
            pass

    async def _broadcast(self, event: dict):
        msg = f"data: {json.dumps(event)}\n\n"
        dead = []
        for q in self._sse_subs:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    # ── Worker loop ───────────────────────────────────────────────────────────────

    async def _worker(self, worker_id: int):
        while self._running:
            await self._resume.wait()
            try:
                task = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            if task.status == "cancelled":
                self._queue.task_done()
                continue

            try:
                await self._run_task(task, worker_id)

                # Retry logic: if task failed with a transient error and has retries left
                if task.status == "failed" and task.is_transient_error() and task.retry_count < task.max_retries:
                    task.retry_count += 1
                    backoff_seconds = 2 ** task.retry_count
                    task.status = "queued"
                    task.message = f"Retrying in {backoff_seconds}s (attempt {task.retry_count + 1}/{task.max_retries + 1})…"
                    task.error = ""
                    task.finished_at = None
                    self._persist_task(task)
                    await self._broadcast({"type": "task_update", "task": task.to_dict()})
                    logger.info("Retrying task %s in %ds (attempt %d)", task.id, backoff_seconds, task.retry_count + 1)
                    await asyncio.sleep(backoff_seconds)
                    await self._queue.put(task)

            except Exception as exc:
                logger.error("Worker %d unhandled error: %s", worker_id, exc)
            finally:
                self._queue.task_done()

    async def retry_task(self, task_id: str) -> bool:
        """Manually retry a failed task."""
        task = self._tasks.get(task_id)
        if not task or task.status not in ("failed", "needs_review"):
            return False
        task.status = "queued"
        task.message = "Manually retrying…"
        task.error = ""
        task.started_at = None
        task.finished_at = None
        task.retry_count += 1
        task.fields_filled = {}
        self._persist_task(task)
        await self._queue.put(task)
        await self._broadcast({"type": "task_update", "task": task.to_dict()})
        return True

    def deliver_human_response(self, task_id: str, response: str) -> bool:
        """Deliver a human response to an agent waiting for help."""
        agent = self._active_agents.get(task_id)
        if not agent or not agent.human_help.requested:
            return False
        agent.human_help.resolve(response)
        return True

    TASK_TIMEOUT_SECONDS = 300  # 5 minutes max per task

    async def _run_task(self, task: ApplyTask, worker_id: int):
        from backend.services.apply_agent import ApplicationAgent, _detect_platform
        from backend.services.llm_service import LLMService
        from backend.models.db_models import UserProfile
        from backend.database import engine
        from backend.config import settings
        from sqlalchemy.orm import Session

        cancel_event = asyncio.Event()
        self._cancel_events[task.id] = cancel_event

        task.status     = "running"
        task.started_at = datetime.now(timezone.utc).isoformat()
        task.message    = "Starting agent…"
        if not task.platform:
            task.platform = _detect_platform(task.job_url)
        await self._broadcast({"type": "task_update", "task": task.to_dict()})

        # ── Load user profile ─────────────────────────────────────────────────
        with Session(engine) as db:
            profile_row = db.get(UserProfile, "singleton")
            if not profile_row:
                task.status      = "failed"
                task.error       = "No profile configured. Open Profile → fill in your info first."
                task.finished_at = datetime.now(timezone.utc).isoformat()
                self._cancel_events.pop(task.id, None)
                self._persist_task(task)
                await self._broadcast({"type": "task_update", "task": task.to_dict()})
                return
            profile = {c.name: getattr(profile_row, c.name) for c in profile_row.__table__.columns}

        # ── Resolve Ollama config ─────────────────────────────────────────────
        cfg        = self.llm_config
        model_name = cfg.get("model") or settings.llm_model
        base_url   = cfg.get("base_url") or settings.ollama_base_url or "http://localhost:11434"

        if not model_name:
            task.status      = "failed"
            task.error       = "No model configured. Select a model in the Agent Queue first."
            task.finished_at = datetime.now(timezone.utc).isoformat()
            self._cancel_events.pop(task.id, None)
            self._persist_task(task)
            await self._broadcast({"type": "task_update", "task": task.to_dict()})
            return

        # ── Quick Ollama connectivity check (< 5 s, replaces 120 s readiness test) ──
        task.message = f"Checking Ollama ({model_name})…"
        await self._broadcast({"type": "task_update", "task": task.to_dict()})

        ollama_ok = await _check_ollama(base_url, model_name)
        if not ollama_ok["ready"]:
            task.status      = "failed"
            task.error       = ollama_ok["error"]
            task.finished_at = datetime.now(timezone.utc).isoformat()
            self._cancel_events.pop(task.id, None)
            self._persist_task(task)
            await self._broadcast({"type": "task_update", "task": task.to_dict()})
            return

        # ── Build LLMService shim (for backward compat with run_apply_agent signature) ──
        llm = LLMService(provider="ollama", model=model_name, ollama_base_url=base_url)

        # ── Callbacks ────────────────────────────────────────────────────────
        async def on_status(msg: str):
            task.message = msg
            await self._broadcast({"type": "task_update", "task": task.to_dict()})

        async def on_trace(event: dict):
            trace_event = {
                "id":        str(uuid.uuid4())[:8],
                "task_id":   task.id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **event,
            }
            await self._broadcast({"type": "trace_event", "task_id": task.id, "event": trace_event})
            self._store_trace_event(trace_event)

        # ── Build and store agent (for human help delivery) ───────────────────
        from backend.services.apply_agent import ApplicationAgent
        agent = ApplicationAgent(
            job_url         = task.job_url,
            profile         = profile,
            llm_model       = model_name,
            ollama_base_url = base_url,
            resume_path     = task.resume_path,
            dry_run         = task.dry_run,
            headless        = task.headless,
            status_callback = on_status,
            trace_callback  = on_trace,
            cancel_event    = cancel_event,
        )
        self._active_agents[task.id] = agent

        # ── Run ───────────────────────────────────────────────────────────────
        try:
            result = await asyncio.wait_for(
                agent.run(),
                timeout=self.TASK_TIMEOUT_SECONDS,
            )
            if task.status == "cancelled":
                return
            task.status        = result.get("status", "failed")
            task.fields_filled = result.get("fields_filled", {})
            task.error         = result.get("error", "")
            task.message       = result.get("note") or ("Applied!" if task.status == "success" else task.error)
        except asyncio.TimeoutError:
            task.status  = "failed"
            task.error   = f"Task timed out after {self.TASK_TIMEOUT_SECONDS}s"
            task.message = task.error
            logger.warning("Worker %d task %s timed out", worker_id, task.id)
        except asyncio.CancelledError:
            task.status  = "cancelled"
            task.message = "Cancelled"
        except Exception as exc:
            task.status  = "failed"
            task.error   = str(exc)[:300]
            task.message = task.error
            logger.error("Worker %d task %s crashed: %s", worker_id, task.id, exc, exc_info=True)
        finally:
            task.finished_at = datetime.now(timezone.utc).isoformat()
            self._cancel_events.pop(task.id, None)
            self._active_agents.pop(task.id, None)
            self._persist_task(task)
            await self._broadcast({"type": "task_update", "task": task.to_dict()})

    def _store_trace_event(self, event: dict):
        """Persist a trace event to SQLite (best-effort, non-blocking)."""
        try:
            from backend.models.db_models import TraceEvent
            from backend.database import engine
            from sqlalchemy.orm import Session
            with Session(engine) as db:
                row = TraceEvent(
                    id=event.get("id", str(uuid.uuid4())[:8]),
                    task_id=event["task_id"],
                    step=event.get("step", 0),
                    event_type=event.get("event_type", "status"),
                    content=event.get("content", {}),
                )
                db.add(row)
                db.commit()
        except Exception as exc:
            logger.debug("Failed to store trace event: %s", exc)

    # ── Task persistence ──────────────────────────────────────────────────────

    def _persist_task(self, task: ApplyTask):
        """Save or update a task in the agent_tasks table."""
        try:
            from backend.models.db_models import AgentTask as AgentTaskDB
            from backend.database import engine
            from sqlalchemy.orm import Session
            with Session(engine) as db:
                row = db.get(AgentTaskDB, task.id)
                if not row:
                    row = AgentTaskDB(id=task.id)
                    db.add(row)
                row.job_url = task.job_url
                row.job_title = task.job_title
                row.company = task.company
                row.platform = task.platform
                row.dry_run = task.dry_run
                row.status = task.status
                row.message = task.message
                row.error = task.error
                row.fields_filled = task.fields_filled
                if task.started_at:
                    try:
                        row.started_at = datetime.fromisoformat(task.started_at)
                    except (ValueError, TypeError):
                        pass
                if task.finished_at:
                    try:
                        row.finished_at = datetime.fromisoformat(task.finished_at)
                    except (ValueError, TypeError):
                        pass
                db.commit()
        except Exception as exc:
            logger.debug("Failed to persist task %s: %s", task.id, exc)

    def _load_persisted_tasks(self):
        """Load completed/failed tasks from DB so the UI shows history on restart."""
        try:
            from backend.models.db_models import AgentTask as AgentTaskDB
            from backend.database import engine
            from sqlalchemy.orm import Session
            with Session(engine) as db:
                rows = (
                    db.query(AgentTaskDB)
                    .order_by(AgentTaskDB.queued_at.desc())
                    .limit(50)
                    .all()
                )
                for row in rows:
                    if row.id not in self._tasks:
                        task = ApplyTask(
                            id=row.id,
                            job_url=row.job_url or "",
                            job_title=row.job_title or "",
                            company=row.company or "",
                            platform=row.platform or "",
                            dry_run=row.dry_run if row.dry_run is not None else True,
                            status=row.status or "failed",
                            message=row.message or "",
                            error=row.error or "",
                            fields_filled=row.fields_filled or {},
                            queued_at=row.queued_at.isoformat() if row.queued_at else "",
                            started_at=row.started_at.isoformat() if row.started_at else None,
                            finished_at=row.finished_at.isoformat() if row.finished_at else None,
                        )
                        self._tasks[row.id] = task
                logger.info("Loaded %d persisted tasks from database", len(rows))
        except Exception as exc:
            logger.debug("Failed to load persisted tasks: %s", exc)
