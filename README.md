# JumpShip

> AI-powered, privacy-first job search and auto-apply tool. Aggregates job boards, scores fit with LLM, and autonomously fills applications via a browser agent — all running locally on your machine.

---

## Table of contents

1. [Why JumpShip exists](#why-jumpship-exists)
2. [What it does](#what-it-does)
3. [Stack](#stack)
4. [Repository layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [How to run](#how-to-run)
7. [Ollama setup (required for agents)](#ollama-setup-required-for-agents)
8. [Environment variables](#environment-variables)
9. [API overview](#api-overview)
10. [Docker Compose](#docker-compose)
11. [Troubleshooting](#troubleshooting)
12. [Roadmap](#roadmap)
13. [Credits & license](#credits--license)

---

## Why JumpShip exists

Many companies automate candidate filtering: ATS rules and keyword scoring remove people before anyone reads their story. JumpShip rebalances that dynamic — if employers use automation to screen people out, job seekers deserve tools that help them find fit, understand gaps, and apply efficiently.

---

## What it does

### Job search
- **9 job boards**: LinkedIn, Indeed, Glassdoor, ZipRecruiter (via python-jobspy), RemoteOK, Arbeitnow, Gupy, Programathor, Trampos.
- OR-style keyword queries, deduplication, 15-minute in-memory cache.
- Paginated UI with location picker, remote toggle, and per-board filters.

### AI assessment
- Per-job **match score (0–100)**, summary, strengths, gaps, and suggestions.
- Optional company research (culture, salary hints) from the open web.
- Assessment speed: Careful / Balanced / Turbo concurrency.

### Resume intelligence
- Upload PDF or DOCX — extracts text, builds structured profile via LLM.
- Auto-fills keyword chips. Suggests related keywords and PT translations.

### Auto-apply agent (LangChain + Playwright)
- **ReAct agent loop**: reads the page → reasons → calls tools → fills fields → navigates → repeats.
- **Resume adaptation**: before filling, the agent rewrites your resume in the job's vocabulary (no lies — rephrasing and reordering only).
- **Platform strategies** with hints for Greenhouse, Lever, LinkedIn Easy Apply, Indeed, generic ATS.
- **Dry-run mode**: fills everything but stops before submitting — review screenshots first.
- **Human-help pause**: agent calls `request_human_help` for CAPTCHAs, login walls, or ambiguous questions; resumes when you respond via `POST /api/auto-apply/queue/{id}/help`.
- **SSE live updates**: every agent step streams to the UI in real time.
- 1–5 parallel workers, pause/resume queue.

### Profile
- Full form: identity, work eligibility, education, salary, LinkedIn credentials, custom Q&A answers.
- Stored locally in SQLite — credentials never leave your machine.

### Job tracking
- Kanban board: Saved → Applied → Interview → Offer → Rejected.
- Export CSV/JSON. Search history with one-click restore.

---

## Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI (Python 3.11+), SQLAlchemy 2, SQLite, pydantic-settings, httpx |
| **Agent** | LangChain + langchain-ollama, Playwright (Chromium) |
| **LLM** | Ollama (local — default and only supported for agents) |
| **Frontend** | React 19, TypeScript, Vite, TanStack Query, lucide-react |
| **Resume** | pdfminer.six, python-docx |
| **Job data** | python-jobspy + custom scrapers |

---

## Repository layout

```
JumpShip/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, lifespan, routers
│   ├── config.py                # pydantic-settings — LLM_MODEL, OLLAMA_BASE_URL, etc.
│   ├── database.py              # SQLAlchemy engine (SQLite)
│   ├── models/
│   │   ├── db_models.py         # ORM tables (SavedJob, UserProfile, AgentTask, TraceEvent…)
│   │   └── schemas.py           # Pydantic v2 request/response models
│   ├── routers/
│   │   ├── auto_apply.py        # /api/auto-apply/* — queue, SSE, human help
│   │   ├── jobs_v2.py           # /api/jobs/search, /api/jobs/assess, /api/ollama/models
│   │   ├── resume_v2.py         # /api/resume/parse
│   │   ├── profile.py           # /api/profile
│   │   └── models.py            # /api/models/discover
│   └── services/
│       ├── apply_agent.py       # LangChain ApplicationAgent — the core agent
│       ├── orchestrator.py      # asyncio worker pool + SSE broadcast
│       ├── llm_service.py       # Thin Ollama wrapper (health checks, legacy routes)
│       ├── ai_evaluator.py      # Multi-provider job assessment (non-agent LLM calls)
│       ├── job_scraper_v2.py    # JobSpy + dedup + cache
│       ├── extra_sources.py     # RemoteOK, Arbeitnow
│       ├── br_sources.py        # Gupy, Programathor, Trampos
│       └── resume_parser_v2.py  # PDF/DOCX → structured profile
├── frontend/
│   ├── src/pages/               # Landing, Search, Profile, Agents, JobTracker
│   ├── src/components/          # JobCard, SettingsModal, LLMConfig, ResumeUpload…
│   └── vite.config.ts           # Dev proxy /api → localhost:8000
├── docker-compose.yml
├── start.sh                     # One-command local dev
└── README.md
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Python 3.11+ | Backend |
| Node.js 18+ | Frontend |
| Ollama | Required for agents and LLM features |
| RTX 3060 Ti / 8 GB VRAM or better | For running Llama3.1:8b or Gemma2:9b locally |

---

## How to run

### Quick start (local dev)

```bash
# Install Python dependencies
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
playwright install chromium

# Run backend
export PYTHONPATH=$(pwd)           # Windows PowerShell: $env:PYTHONPATH = (pwd).Path
uvicorn backend.main:app --reload --port 8000

# Second terminal — frontend
cd frontend
npm install
npm run dev
```

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Web UI |
| http://localhost:8000/docs | Swagger API docs |
| http://localhost:8000/api/health | Health check |
| http://localhost:8000/api/health/llm | LLM + Ollama diagnostic |

### Docker Compose

```bash
docker compose build
docker compose up -d
# UI: http://localhost  |  API: http://localhost:8000
```

---

## Ollama setup (required for agents)

```bash
# 1. Install Ollama — https://ollama.ai
# 2. Pull a model that fits your VRAM:
ollama pull llama3.1:8b            # recommended — best tool-calling, 6-7 GB VRAM
# or:
ollama pull gemma2:9b              # alternative, 6-7 GB VRAM

# 3. Confirm it's available
ollama list
curl http://localhost:11434/api/tags

# 4. Check JumpShip can reach it
curl http://localhost:8000/api/health/llm
```

Set the model in `backend/.env`:
```
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://localhost:11434
```

The agent selects Ollama automatically. You can also pick the model in the UI Agent Queue header.

### VRAM guide (RTX 3060 Ti — 8 GB)

| Model | VRAM (Q4) | Tool-calling |
|-------|-----------|--------------|
| llama3.1:8b | ~6 GB | Yes |
| gemma2:9b | ~6 GB | Yes |
| mistral:7b | ~5 GB | Partial |

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLM_PROVIDER` | `ollama` | Provider — `ollama` only for agents |
| `LLM_MODEL` | `llama3` | Model name (e.g. `llama3.1:8b`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated browser origins |
| `DATABASE_URL` | `sqlite:///./jobspy_ui.db` | SQLAlchemy connection string |

---

## API overview

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Basic health + `llm_available` |
| GET | `/api/health/llm` | Full Ollama diagnostic — tests connectivity + a real completion |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs/search` | Search all boards |
| POST | `/api/jobs/assess` | Score a job against a resume |
| GET | `/api/ollama/models` | List available Ollama models |

### Resume
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/resume/parse` | Upload PDF/DOCX → structured profile |

### Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profile` | Load user profile |
| POST | `/api/profile` | Save user profile |

### Agent queue
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auto-apply/queue` | Add a job to the queue |
| GET | `/api/auto-apply/queue` | Queue state + all tasks |
| DELETE | `/api/auto-apply/queue/{id}` | Cancel a task |
| POST | `/api/auto-apply/queue/{id}/retry` | Retry a failed task |
| POST | `/api/auto-apply/queue/{id}/help` | Send human response to waiting agent |
| POST | `/api/auto-apply/queue/clear` | Remove completed/cancelled tasks |
| POST | `/api/auto-apply/pause` | Pause all workers |
| POST | `/api/auto-apply/resume` | Resume workers |
| POST | `/api/auto-apply/workers` | Set concurrency (1–5) |
| POST | `/api/auto-apply/llm-config` | Set model for agents |
| GET | `/api/auto-apply/stream` | SSE — live task updates |

---

## Docker Compose

| Service | Ports | Role |
|---------|-------|------|
| `backend` | `8000:8000` | FastAPI |
| `frontend` | `80:80` | nginx SPA + `/api` proxy |

Ollama on host from Docker: use `OLLAMA_BASE_URL=http://host.docker.internal:11434`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Agent stays `queued` forever | Hit `GET /api/health/llm` — see exact error. Common: Ollama not running (`ollama serve`) or model not pulled (`ollama pull llama3.1:8b`). |
| Agent starts but freezes | Model loading cold into VRAM can take 60–120 s on first run. Check `nvidia-smi`. |
| `Model not found` error | Run `ollama list` — name must match exactly (e.g. `llama3.1:8b` not `llama3.1`). |
| CORS errors | Add your exact browser origin to `CORS_ORIGINS` in `.env`. |
| Playwright not found | Run `playwright install chromium` in your virtualenv. |
| Job boards empty | Third-party sites rate-limit or change layout — check backend logs. |

---

## Roadmap

**Shipped**
- [x] 9-board job search + dedup + cache
- [x] LLM resume parsing + per-job scoring
- [x] Application tracking kanban
- [x] LangChain ReAct auto-apply agent
- [x] Resume adaptation per job (reword, no lies)
- [x] Human-help pause/resume in agent
- [x] Dry-run mode with screenshots
- [x] SSE live step streaming

**Planned**
- [ ] Agent screenshot review UI
- [ ] Scheduled auto-discovery (score new jobs overnight)
- [ ] CAPTCHA handling improvements
- [ ] Interview prep from job + profile gaps
- [ ] Portuguese / full i18n

---

## Credits & license

Built by [Adrian Widmer](https://awi-24.github.io).

Job aggregation built on **[python-jobspy](https://github.com/Bunsly/JobSpy)** (Bunsly). This project inherits the license terms of that upstream project where applicable.

`https://github.com/Awi-24/JumpShip.git`
