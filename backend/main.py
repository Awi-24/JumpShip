"""
JumpShip — FastAPI Backend
Run with: uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text

_REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_REPO_ROOT / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import engine, Base
from backend.config import settings
from backend.models.schemas import HealthResponse
from backend.services.llm_service import get_llm_service

# Legacy routers
from backend.routers import jobs, resume, analysis, applications, settings as settings_router
from backend.routers import brazilian_jobs, concursos

# Primary routers
from backend.routers import resume_v2, jobs_v2, profile, models, resume_gen, interview

logger = logging.getLogger(__name__)

# Validate SECRET_KEY at startup — fail hard outside DEBUG
if settings.secret_key == "dev-secret-change-me-in-production":
    if not settings.debug:
        raise RuntimeError(
            "SECRET_KEY is still the default dev value. Set SECRET_KEY in .env, "
            "or set DEBUG=true to allow the default in development."
        )
    logger.critical(
        "SECRET_KEY is using default dev value (DEBUG=true). Do not deploy this way."
    )

from backend.database import init_db  # noqa: E402

init_db()


def _migrate_db():
    migrations = [
        "ALTER TABLE analyses ADD COLUMN keywords_matched JSON",
        "ALTER TABLE analyses ADD COLUMN keywords_missing JSON",
        "ALTER TABLE applications ADD COLUMN is_easy_apply BOOLEAN DEFAULT 0",
        "ALTER TABLE applications ADD COLUMN assessment_data JSON",
        "ALTER TABLE applications ADD COLUMN match_score INTEGER",
        "ALTER TABLE applications ADD COLUMN job_description TEXT",
        "ALTER TABLE user_profiles ADD COLUMN llm_keys_encrypted TEXT",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception as exc:
                logger.debug("Migration skipped (%s): %s", stmt, exc)


_migrate_db()

app = FastAPI(
    title="JumpShip API",
    description="AI-powered job search. Resume parsing, multi-source scraping, LLM job assessment, tailored resume generation.",
    version="1.0.0",
)

origins = settings.cors_origins_list

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Primary routers
app.include_router(resume_v2.router)
app.include_router(resume_gen.router)
app.include_router(jobs_v2.router)
app.include_router(jobs_v2._jobs_router)
app.include_router(profile.router)
app.include_router(models.router)
app.include_router(interview.router)

# Legacy routers (backward compat)
app.include_router(jobs.router)
app.include_router(resume.router)
app.include_router(analysis.router)
app.include_router(applications.router)
app.include_router(settings_router.router)
app.include_router(brazilian_jobs.router)
app.include_router(concursos.router)


@app.get("/api/health", response_model=HealthResponse)
async def health():
    llm = get_llm_service()
    available = await llm.is_available()
    return HealthResponse(
        status="ok",
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_available=available,
        version="1.0.0",
    )


@app.get("/api/health/llm")
async def health_llm():
    llm = get_llm_service()
    try:
        reachable = await asyncio.wait_for(llm.is_available(), timeout=5)
    except asyncio.TimeoutError:
        return {"status": "timeout", "step": "connectivity", "error": "LLM did not respond within 5s"}
    except Exception as exc:
        return {"status": "error", "step": "connectivity", "error": str(exc)}

    if not reachable:
        return {
            "status": "unreachable",
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "error": "LLM provider not reachable. For Ollama: run `ollama serve`.",
        }

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
            "error": f"Model '{settings.llm_model}' timed out after 120s.",
        }
    except Exception as exc:
        return {"status": "error", "step": "completion", "error": str(exc)[:300]}


@app.get("/")
def root():
    return {"message": "JumpShip API 1.0 — visit /docs"}
