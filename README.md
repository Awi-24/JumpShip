# JumpShip

> An AI-powered job search and assessment tool that helps you push back against opaque, automated hiring filters. Aggregates many job boards via [python-jobspy](https://github.com/Bunsly/JobSpy) plus extra sources (RemoteOK, Arbeitnow, Brazilian boards).

---

## Table of contents

1. [Why JumpShip exists](#why-jumpship-exists)
2. [What it does](#what-it-does)
3. [Stack](#stack)
4. [Repository layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [How to run (all options)](#how-to-run-all-options)
7. [Ollama (local LLM) — full setup](#ollama-local-llm--full-setup)
8. [Other LLM providers](#other-llm-providers)
9. [Environment variables](#environment-variables)
10. [Docker Compose](#docker-compose)
11. [CORS and proxies](#cors-and-proxies)
12. [API overview (v2)](#api-overview-v2)
13. [Development](#development)
14. [Troubleshooting](#troubleshooting)
15. [Roadmap](#roadmap)
16. [Development notes](#development-notes)
17. [Credits & license](#credits--license)

---

## Why JumpShip exists

Many companies automate how they filter candidates: ATS rules, keyword scoring, and black-box scoring remove people **before anyone reads their story**. Applicants often never get **a real chance** to show what they can do. The system can discard them even when they are **well aligned with the role**, or when they are **motivated to grow** and develop the skills the job needs.

JumpShip exists to rebalance that dynamic. If employers use automation to screen people out, job seekers deserve tools that help them **find fit, understand gaps, and use their time on roles that matter**—instead of losing silently to a filter.

---

## What it does

### Job search

- **Sources**: LinkedIn, Indeed, Glassdoor, ZipRecruiter (via JobSpy), plus **RemoteOK**, **Arbeitnow**, **Gupy**, **Programathor**, **Trampos**.
- **Keywords**: OR-style queries across boards so multiple short keywords broaden results (very long single phrases can return fewer hits).
- **Deduplication**: Fuzzy matching on title + company across sources.
- **Caching**: In-memory search cache (~15 minutes TTL) to avoid repeat scraping.
- **UI**: Paginated results with “Load more”, location picker (countries, cities, remote), and per-board toggles.

### AI-powered assessment

- Per-job **match score (0–100)**, summary, **strengths**, **gaps**, **career suggestions**.
- Optional **company research** from the open web (culture, salary hints, sentiment).
- **Assessment speed**: Careful (1 concurrent), Balanced (3), Turbo (6).
- Retry on flaky LLM JSON parses; jobs can be flagged **irrelevant** with a “show hidden” review toggle.

### Résumé intelligence

- Upload **PDF** or **DOCX**; text extraction plus **LLM structured profile** (skills, seniority, domains, suggested keywords/titles).
- Can **auto-fill** keyword chips from the profile.
- **Suggest related keywords** and **Portuguese translations** (LLM endpoints).

### Job tracking & export

- **Bookmarks** with status: Saved → Applied → Interview → Rejected → Offer.
- **Export** CSV or JSON including assessment fields when present.
- **Search history** with one-click restore.
- Warns when a listing has **very little description** (weaker assessments).

### Privacy-first defaults

- Résumé parsing runs through **your** backend; the file is not sent to a third-party SaaS for storage by JumpShip itself.
- **Ollama** (or another local OpenAI-compatible server) is the default path—no cloud API key required.
- Cloud keys are **opt-in** (settings UI + env).
- No accounts or analytics in the app design.

---

## Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI (Python 3.11+), SQLAlchemy, SQLite, pydantic-settings, httpx |
| **Frontend** | React 19, TypeScript, Vite 8, TanStack Query, Framer Motion |
| **LLM** | Ollama / LM Studio / OpenClaw-compatible (local), OpenAI, Anthropic, Groq |
| **Résumé** | pdfminer.six, python-docx, LLM extraction |
| **Job data** | python-jobspy + custom scrapers (`extra_sources.py`, `br_sources.py`) |
| **UI** | Custom CSS (dark theme, gold accents) |

---

## Repository layout

```
JumpShip/
├── backend/
│   ├── main.py                 # FastAPI app, CORS, router registration
│   ├── config.py               # pydantic-settings (LLM, CORS)
│   ├── database.py             # SQLAlchemy engine (DATABASE_URL)
│   ├── models/schemas.py       # Pydantic v2 API models
│   ├── routers/
│   │   ├── resume_v2.py        # POST /api/resume/parse
│   │   ├── jobs_v2.py          # /api/jobs/*, /api/ollama/models, /api/groq/models
│   │   └── …                   # legacy routers (backward compatibility)
│   └── services/
│       ├── llm_service.py      # Unified LLM calls
│       ├── resume_parser_v2.py
│       ├── job_scraper_v2.py   # JobSpy + merge/dedup/cache
│       ├── extra_sources.py    # RemoteOK, Arbeitnow
│       ├── br_sources.py       # Gupy, Programathor, Trampos
│       ├── web_search.py       # Company enrichment
│       └── …
├── frontend/
│   ├── src/pages/              # Landing, Search
│   ├── src/components/         # JobCard, SettingsModal, LocationSelect, …
│   ├── vite.config.ts          # Dev proxy /api → localhost:8000
│   ├── Dockerfile              # Multi-stage build + nginx
│   └── nginx.conf              # SPA + /api → backend (Docker)
├── docker-compose.yml          # backend + frontend containers
├── start.sh                    # Local dev: venv, backend + Vite
├── .env.example                # Example env (see also backend/.env.example)
└── README.md
```

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Python 3.11+** | Backend |
| **Node.js 18+** (20+ for Docker frontend image) | Frontend |
| **Git** | Clone |
| **Ollama** (optional but recommended) | Local inference, default provider |

**Windows**: `start.sh` is a Bash script—use **Git Bash**, **WSL**, or the [manual commands](#b-manual-backend--frontend-no-docker) below.

---

## How to run (all options)

### A. One-command local dev (`start.sh`)

From the **repository root**:

```bash
chmod +x start.sh
./start.sh
```

What it does:

1. Creates `.venv` at the repo root if missing, activates it, and runs `pip install -r backend/requirements.txt`.
2. Copies `.env.example` → `.env` at the repo root if `.env` is missing (you should edit `.env` afterward).
3. Starts **FastAPI** with reload: `PYTHONPATH=<repo> uvicorn backend.main:app --reload --port 8000`.
4. Starts **Vite**: `npm run dev` in `frontend/` (port **5173**).

Then open:

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Web UI |
| http://localhost:8000/docs | Swagger UI |
| http://localhost:8000/api/health | JSON health (includes `llm_available`) |

Stop with **Ctrl+C** (both processes are killed via the script’s trap).

---

### B. Manual backend + frontend (no Docker)

**1. Backend** (from repo root):

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

Set environment variables (see [Environment variables](#environment-variables)) or create a **`.env` file in the repo root** with `LLM_PROVIDER`, `LLM_MODEL`, `OLLAMA_BASE_URL`, etc.

```bash
# Linux/macOS — repo root as cwd
export PYTHONPATH="$(pwd)"   # Windows PowerShell: $env:PYTHONPATH = (Get-Location).Path
uvicorn backend.main:app --reload --port 8000
```

**2. Frontend** (second terminal):

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:8000` (see `frontend/vite.config.ts`).

**3. Production build of the UI only** (optional):

```bash
cd frontend
npm run build      # tsc -b && vite build
npm run preview    # serves dist (default preview port)
```

`preview` does **not** start the API; point the preview at a running backend or use Docker/nginx as below.

---

### C. Backend only or frontend only

- **API only**: run `uvicorn` as above; use `/docs` or any HTTP client.
- **UI only** (against a remote API): you would need to change the Vite proxy or set `fetch` base URL (default app uses relative `/api`).

---

### D. Docker Compose (full stack)

Build and run **backend** (port **8000**) + **frontend** nginx (port **80**):

```bash
docker compose build
docker compose up -d
```

- **UI**: http://localhost  
- **API** (direct): http://localhost:8000  
- Through nginx, the browser calls **`/api/...`** on port 80 and nginx proxies to the `backend` service.

Compose mounts volumes for SQLite and uploads (`jumpship-db`, `jumpship-uploads`). Override LLM settings with a root `.env` and:

```bash
docker compose --env-file .env up -d --build
```

**Ollama on the host while backend is in Docker**: the default `OLLAMA_BASE_URL` is `http://host.docker.internal:11434` (see `docker-compose.yml`). Ollama must be listening on the host (typically `0.0.0.0:11434` or localhost reachable from Docker).

---

## Ollama (local LLM) — full setup

### 1. Install Ollama

Follow the official installer for your OS: https://ollama.ai  

After install, the default API is **`http://127.0.0.1:11434`**.

### 2. Pull a model

Examples (pick one that fits your RAM):

```bash
ollama pull llama3
ollama pull qwen2.5:7b-instruct
ollama pull mistral
```

### 3. Align JumpShip with the model name

- **Backend defaults** (`backend/config.py`): `LLM_PROVIDER=ollama`, `LLM_MODEL=llama3` (override via env or UI).
- In the app **Settings**, choose **Ollama**; the UI can list installed models from `GET /api/ollama/models` and auto-select the first if your model field is empty.

### 4. Verify

```bash
curl http://localhost:11434/api/tags
curl http://localhost:8000/api/health
```

`llm_available` should be `true` when the backend can reach Ollama and the provider is set to a local one.

### 5. Docker + Ollama on the same machine

- Start Ollama on the host.
- Use `OLLAMA_BASE_URL=http://host.docker.internal:11434` for the backend container (already the default in `docker-compose.yml` on many setups).
- On **Linux**, `extra_hosts: host.docker.internal:host-gateway` is included in compose so the hostname resolves.

### 6. LM Studio & OpenClaw

The backend treats **`lmstudio`** and **`openclaw`** like Ollama: same **`/api/generate`** and **`/api/tags`** shape. Point **`OLLAMA_BASE_URL`** (or the Settings “Ollama URL” field, which maps to the same base URL for local providers) at your server, e.g. LM Studio’s local port.

---

## Other LLM providers

| Provider | Auth | Notes |
|----------|------|--------|
| **OpenAI** | `OPENAI_API_KEY` | Chat Completions API |
| **Anthropic** | `ANTHROPIC_API_KEY` | Messages API |
| **Groq** | `GROQ_API_KEY` | Fast inference; model list via `GET /api/groq/models?api_key=…` |

You can set keys in **`.env`** for server defaults and/or paste them in the **in-app Settings** (per-browser). Resume parse and job assess requests can also send per-request overrides in the JSON body where the schema allows it.

---

## Environment variables

Variables are read from the process environment. **pydantic-settings** maps fields in `backend/config.py` to env names (typically **UPPER_SNAKE_CASE**).

| Variable | Default (code) | Purpose |
|----------|----------------|---------|
| `LLM_PROVIDER` | `ollama` | `ollama` \| `lmstudio` \| `openclaw` \| `openai` \| `anthropic` \| `groq` |
| `LLM_MODEL` | `llama3` | Model id for the chosen provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL for Ollama-compatible servers |
| `OPENAI_API_KEY` | empty | OpenAI |
| `ANTHROPIC_API_KEY` | empty | Anthropic |
| `GROQ_API_KEY` | empty | Groq |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000,http://localhost` | Comma-separated browser origins, or `*` |
| `DATABASE_URL` | `sqlite:///./jobspy_ui.db` | SQLAlchemy URL (`backend/database.py`) |
| `UPLOAD_DIR` | (see legacy routers) | Uploads path when using legacy features |

**Docker Compose** also sets `DATABASE_URL`, `UPLOAD_DIR`, and `CORS_ORIGINS` for container layout—see `docker-compose.yml`.

**Note**: `backend/main.py` loads **`backend/.env`** with `python-dotenv` if present. Keeping a **single `.env` at the repo root** (as `start.sh` creates) works when you run `uvicorn` with cwd = repo root, because pydantic-settings will still pick up those variables. If something does not load, add the same keys to `backend/.env` or export them in the shell.

The root **`.env.example`** may list extra third-party keys for other experiments; the **backend only requires** the variables above for JumpShip v2 behavior.

---

## Docker Compose

| Service | Image build | Ports | Role |
|---------|-------------|-------|------|
| `backend` | `backend/Dockerfile` | `8000:8000` | FastAPI, no `--reload` |
| `frontend` | `frontend/Dockerfile` | `80:80` | nginx → static SPA + `/api` proxy |

Healthcheck: `GET http://localhost:8000/api/health` inside the backend container.

---

## CORS and proxies

- **Local dev**: Vite on **5173** proxies **`/api`** to **8000**, so the browser origin is `localhost:5173` and the API sees proxied requests from the dev server.
- **Docker**: Browser talks to **80**; nginx proxies **`/api/`** to **`http://backend:8000`**. Set `CORS_ORIGINS` to include `http://localhost` when testing from port 80.

---

## API overview (v2)

Primary routes used by the React app:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + `llm_available` |
| GET | `/api/ollama/models` | Optional `base_url` query: list models |
| GET | `/api/groq/models` | Optional `api_key` query: list Groq models |
| POST | `/api/resume/parse` | Multipart file + optional LLM override fields → `ResumeProfile` |
| POST | `/api/jobs/search` | Job search → list of `JobResult` |
| POST | `/api/jobs/assess` | Job + résumé profile → `JobAssessment` |
| POST | `/api/jobs/suggest-keywords` | Related keywords |
| POST | `/api/jobs/translate-keywords` | Translations (e.g. PT) |

Legacy routes under other prefixes may still exist for older clients; new work should target the v2 paths above.

Interactive docs: **`/docs`** (Swagger).

---

## Development

```bash
# Frontend
cd frontend
npm run lint
npm run test        # vitest
npm run test:run    # CI-style single run

# Backend — run from repo root with PYTHONPATH set
pytest              # if tests exist in your tree
```

Optional: `.pre-commit-config.yaml` can hook formatters/linters if you install pre-commit.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| UI cannot reach API | Dev: is `uvicorn` on 8000? Docker: use port **80** for UI so `/api` hits nginx, or open **8000** for direct API. |
| `llm_available: false` | Ollama running? Correct `OLLAMA_BASE_URL`? Model pulled? Firewall? From Docker: `host.docker.internal` reachable? |
| CORS errors | Add your exact origin (scheme + host + port) to `CORS_ORIGINS`. |
| Job boards empty / warnings in logs | Third-party sites change layout or rate-limit; check logs for `Gupy`, `Programathor`, `Trampos`, `Arbeitnow`. Some sources paginate or scrape HTML. |
| Windows script issues | Use Git Bash/WSL for `start.sh`, or [manual](#b-manual-backend--frontend-no-docker) commands. |

---

## Roadmap

**Near term**

1. **Auto-application** — Form fill, cover letters, safer submission flows where allowed.
2. **Agentic workflows** — Scheduled discovery, scoring, notifications, with human oversight.

**Broader ideas**

- Application analytics (funnel, response times).
- Résumé optimization per target role.
- Interview prep from job text + profile gaps.
- Full i18n (e.g. Portuguese + English).

---

## Development notes

JumpShip was built with help from **Claude** (Anthropic) for **code review** and for **parts of the UI**—repetitive layout, styling, and component wiring. Product direction, scraping logic, and architecture choices are author-driven.

---

## Credits & license

Built by [Adrian Widmer](https://awi-24.github.io).

Job aggregation builds on **[python-jobspy](https://github.com/Bunsly/JobSpy)** (Bunsly). This project **inherits the license terms** of that upstream project where applicable—see the original repository for the exact license text.

Repository clone URL (adjust if you forked): `https://github.com/Awi-24/JumpShip.git`
