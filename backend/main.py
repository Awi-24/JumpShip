"""
Jumpship — FastAPI Backend
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
from fastapi.staticfiles import StaticFiles

from backend.database import engine, Base
from backend.routers import jobs, resume, analysis, applications, settings, brazilian_jobs, concursos

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
                # Column already exists or table doesn't exist yet — both are fine
                pass

_migrate_db()

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Jumpship API",
    description="Backend for Jumpship — job scraping, AI resume analysis and application automation. Built on python-jobspy.",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(jobs.router)
app.include_router(resume.router)
app.include_router(analysis.router)
app.include_router(applications.router)
app.include_router(settings.router)
app.include_router(brazilian_jobs.router)
app.include_router(concursos.router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
def root():
    return {"message": "Jumpship API — visit /docs for the interactive API docs"}
