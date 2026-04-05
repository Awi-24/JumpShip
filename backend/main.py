"""
JumpShip — FastAPI Backend
Run with: uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend directory
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import engine, Base
from backend.config import settings
from backend.models.schemas import HealthResponse
from backend.services.llm_service import get_llm_service
from backend.services.orchestrator import AgentOrchestrator

# Legacy routers (kept for backward compat)
from backend.routers import jobs, resume, analysis, applications, settings as settings_router
from backend.routers import brazilian_jobs, concursos

# v2 routers (JumpShip new API)
from backend.routers import resume_v2, jobs_v2, profile, auto_apply, models

# Create all DB tables on startup
Base.metadata.create_all(bind=engine)


# Lightweight migration: add new columns to existing databases without Alembic
def _migrate_db():
    """Add columns/tables that may be missing from databases created before this version."""
    migrations = [
        "ALTER TABLE analyses ADD COLUMN keywords_matched JSON",
        "ALTER TABLE analyses ADD COLUMN keywords_missing JSON",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(__import__("sqlalchemy").text(stmt))
                conn.commit()
            except Exception:
                pass


_migrate_db()

# ── App lifespan (orchestrator lifecycle) ────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the agent orchestrator
    orchestrator = AgentOrchestrator(max_workers=2)
    app.state.orchestrator = orchestrator
    await orchestrator.start()
    yield
    # Shutdown: stop workers gracefully
    await orchestrator.stop()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="JumpShip API",
    lifespan=lifespan,
    description="Backend for JumpShip — AI-powered job search built on python-jobspy. "
    "Supports resume parsing, multi-source scraping, and LLM-powered job assessment.",
    version="2.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

origins = settings.cors_origins_list

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── v2 Routers (JumpShip primary API) ────────────────────────────────────────
# Registered first so v2 routes take priority over legacy routes with
# the same path (e.g. POST /api/jobs/search uses the v2 schema).

app.include_router(resume_v2.router)
app.include_router(jobs_v2.router)       # /api/ollama/models, /api/test-llm
app.include_router(jobs_v2._jobs_router) # /api/jobs/search, /api/jobs/assess
app.include_router(profile.router)       # /api/profile
app.include_router(auto_apply.router)    # /api/auto-apply/*
app.include_router(models.router)        # /api/models/discover

# ── Legacy Routers (kept for backward compat) ─────────────────────────────────

app.include_router(jobs.router)
app.include_router(resume.router)
app.include_router(analysis.router)
app.include_router(applications.router)
app.include_router(settings_router.router)
app.include_router(brazilian_jobs.router)
app.include_router(concursos.router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse)
async def health():
    llm = get_llm_service()
    available = await llm.is_available()
    return HealthResponse(
        status="ok",
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_available=available,
        version="2.0.0",
    )


@app.get("/api/health/llm")
async def health_llm():
    """
    Detailed LLM health check — tests connectivity AND a real completion.
    Use this to diagnose agent startup issues before launching a task.
    """
    llm = get_llm_service()

    # Step 1: connectivity
    try:
        reachable = await asyncio.wait_for(llm.is_available(), timeout=5)
    except asyncio.TimeoutError:
        return {"status": "timeout", "step": "connectivity", "error": "Ollama did not respond within 5s — is it running?"}
    except Exception as exc:
        return {"status": "error", "step": "connectivity", "error": str(exc)}

    if not reachable:
        return {
            "status": "unreachable",
            "step": "connectivity",
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "error": (
                "LLM provider not reachable. "
                "For Ollama: run `ollama serve` and confirm `ollama list` shows your model."
            ),
        }

    # Step 2: real completion test (model may need to load into VRAM on first call)
    try:
        response = await asyncio.wait_for(
            llm.complete("You are helpful.", "Reply with exactly: OK"),
            timeout=120,
        )
        return {
            "status": "ok",
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "response_preview": response[:80],
        }
    except asyncio.TimeoutError:
        return {
            "status": "timeout",
            "step": "completion",
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "error": (
                f"Model '{settings.llm_model}' timed out after 120s. "
                "It may be loading into VRAM — try again in 30s, or check `nvidia-smi`."
            ),
        }
    except RuntimeError as exc:
        return {"status": "error", "step": "completion", "error": str(exc)}
    except Exception as exc:
        return {"status": "error", "step": "completion", "error": str(exc)[:300]}


@app.get("/")
def root():
    return {"message": "JumpShip API v2 — visit /docs for interactive API docs"}
