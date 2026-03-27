"""
JumpShip — FastAPI Backend
Run with: uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import os
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

# Legacy routers (kept for backward compat)
from backend.routers import jobs, resume, analysis, applications, settings as settings_router
from backend.routers import brazilian_jobs, concursos

# v2 routers (JumpShip new API)
from backend.routers import resume_v2, jobs_v2

# Create all DB tables on startup
Base.metadata.create_all(bind=engine)


# Lightweight migration: add new columns to existing databases without Alembic
def _migrate_db():
    """Add columns that may be missing from databases created before this version."""
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

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="JumpShip API",
    description="Backend for JumpShip — AI-powered job search built on python-jobspy. "
    "Supports resume parsing, multi-source scraping, and LLM-powered job assessment.",
    version="2.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

origins = settings.cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Legacy Routers ────────────────────────────────────────────────────────────

app.include_router(jobs.router)
app.include_router(resume.router)
app.include_router(analysis.router)
app.include_router(applications.router)
app.include_router(settings_router.router)
app.include_router(brazilian_jobs.router)
app.include_router(concursos.router)

# ── v2 Routers (JumpShip) ────────────────────────────────────────────────────
# Note: v2 resume router uses /api/resume/parse which doesn't conflict with
# the legacy /api/resume/upload endpoint

app.include_router(resume_v2.router)
app.include_router(jobs_v2.router)


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


@app.get("/")
def root():
    return {"message": "JumpShip API v2 — visit /docs for interactive API docs"}
