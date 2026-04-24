# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## HiveMind Protocol — Active

**Governance framework**: `.jumpship/` (HiveMind Protocol).
**Full protocol spec**: `.jumpship/CLAUDE.md` — read it on every session start.
**Project state**: `.jumpship/.hivemind/memory/MANIFEST.md` — read before any technical decision.

### Session initialization (mandatory)

1. Read `.jumpship/.hivemind/memory/MANIFEST.md` (Tier 0 — always)
2. Read `.jumpship/.hivemind/memory/shared-context.md` (Tier 1)
3. Check MANIFEST counters — load Tier 2/3 only if flags require it

### Model routing

| Tier | Model | When |
|------|-------|------|
| Lite | `claude-haiku-4-5-20251001` | reads, logs, reports, status |
| Standard | `claude-sonnet-4-6` | code, debug, tests, reviews |
| Heavy | `claude-opus-4-6` | architecture, security audits, cross-system refactors |

### Communication default: `heavy` compression

Drop articles/filler, fragments OK, no preamble/postamble. Suspend for: security warnings, irreversible ops, order-sensitive multi-step sequences.

### Key HiveMind commands

`/hm-status` · `/hm-standup` · `/hm-report` · `/hm-decision` · `/hm-blocker` · `/hm-checkpoint` · `/hm-handoff`

### Change tracking (refactoring sessions)

- Log every architectural decision: `.jumpship/.hivemind/memory/decisions.log`
- Log every completed change: `.jumpship/.hivemind/reports/CHANGELOG.md`
- Register blockers immediately: `.jumpship/.hivemind/memory/blockers.md`
- Update MANIFEST after every write

---

## Project: JumpShip

AI-powered job search: aggregate boards, parse your résumé, LLM-fit scoring, optional tailored résumé PDFs — local-first (Ollama / LM Studio) with optional cloud providers.

**Stack**: FastAPI (Python 3.11+) · React 19 + TypeScript · SQLite · `LLMClient` (multi-provider) · Ollama (default)

## Commands

### Quick Start
```bash
bash ./start.sh          # backend + frontend in parallel
```

### Backend
```bash
source .venv/bin/activate                              # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
pip install -r requirements-dev.txt                    # pytest, pytest-asyncio, httpx
export PYTHONPATH=$(pwd)                               # Windows: $env:PYTHONPATH = (Get-Location).Path
uvicorn backend.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
npm run build
npm run lint
npm run test             # Vitest watch
npm run test:run         # single run
npm run test:coverage
```

### Docker
```bash
docker compose build && docker compose up -d
# UI: http://localhost  |  API: http://localhost:8000
```

### Python Tests
```bash
pytest                                        # all unit tests
pytest tests/unit/                            # unit only
pytest tests/integration/                     # integration (requires running backend)
pytest -k test_resume_parser                  # single test file/function match
pytest -m llm_integration                     # opt-in: calls a real LLM (skipped by default)
```

### Health
```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/health/llm    # full LLM diagnostic
```

## Architecture

### Backend (`backend/`)

FastAPI app (`main.py`). Config: pydantic-settings (`config.py`), reading **repo-root** `.env` (see `load_dotenv` in `main.py`).

**Primary routers:** `resume_v2`, `resume_gen`, `jobs_v2` (includes `/api/jobs/*` and model-discovery helpers), `profile`, `models`. **Legacy:** `jobs`, `resume`, `analysis`, `applications`, `settings`, `brazilian_jobs`, `concursos` for backward compatibility.

**Key services:**
- `services/job_scraper_v2.py` — JobSpy + extra regional sources
- `services/llm_client.py` — unified LLM calls (local semaphore for Ollama/LM Studio); supports 11 providers via `LLMClient(provider, model).complete()` / `.complete_json()`
- `services/resume_parser_v2.py` — PDF/DOCX → `ResumeProfile`
- `services/ai_evaluator.py` — helpers still used by legacy analysis routes and résumé Markdown generation
- `services/resume_generator.py` — tailored résumé HTML (LLM template) → xhtml2pdf PDF
- `services/llm_service.py` — lightweight Ollama probe for `/api/health`

**Schemas:** `backend/models/schemas.py` defines all Pydantic v2 request/response types. `LLMOverride` fields (`llm_provider`, `llm_model`, `llm_api_key`, `llm_base_url`) can be embedded in any request to override `.env` config per-call.

**Database:** SQLite (`jobspy_ui.db` by default). ORM models in `backend/models/db_models.py`; SQLAlchemy session via `backend/database.py:get_db()`. Notable tables: `SavedJob`, `Application`, `UserProfile`, `GeneratedResume`.

### Frontend (`frontend/src/`)

SPA: `App.tsx` → Landing, Search, JobTracker.

- `pages/Search.tsx` — search, batch assess, settings, profile modal, résumé generation triggers
- `pages/JobTracker.tsx` — Kanban (`@dnd-kit`)
- `components/` — `SettingsModal`, `ResumeUpload`, `JobCard`, `AssessmentLoader`, `ScoreRing`, `CustomSelect`, `LocationSelect`, `ThemeToggle`
- `hooks/` — TanStack Query v5 hooks: `useJobs`, `useResume`, `useResumeCache`, `useSettings`, `useTheme`

Vite dev server proxies `/api` to the backend (configured in `vite.config.ts`).

### Data Flow

1. Search: `POST /api/jobs/search` → `job_scraper_v2.py`
2. Resume: `POST /api/resume/parse` → `resume_parser_v2.py`
3. Assess: `POST /api/jobs/assess` / `assess-batch` → `LLMClient` + prompts in `jobs_v2.py`
4. Tailored PDF: `POST /api/resume/generate` → `resume_generator.py`

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` · `lmstudio` · `openai` · `anthropic` · `groq` · `gemini` · `deepseek` · `mistral` · `openrouter` · `cohere` · `huggingface` |
| `LLM_MODEL` | `gemma3:27b` | Must be installed / available for that provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Docker: `http://host.docker.internal:11434` |
| `DATABASE_URL` | `sqlite:///./jobspy_ui.db` | |
| `RESUME_OUTPUT_DIR` | `./generated_resumes` | Tailored PDF output directory |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | `""` | Required when using cloud providers |
| `SECRET_KEY` | `dev-secret-change-me-in-production` | Fernet encryption key — change in production |
| `API_KEY` | `""` | Optional HTTP basic auth gate for the API |
| `RESUME_GEN_THRESHOLD` | `70` | Score (0-100) above which a tailored résumé auto-generates |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated; `*` to allow all |

## Important Notes

- `PYTHONPATH` must be the **repository root** for `uvicorn backend.main:app` (Dockerfile sets `ENV PYTHONPATH=/app`).
- Legacy routers remain; prefer `/api/jobs/*` and `/api/resume/*` v2 paths.
- Docker: Ollama on host; backend reaches it via `host.docker.internal` (see `docker-compose.yml`).
