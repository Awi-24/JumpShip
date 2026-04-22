# JumpShip

> AI-powered job search built around your résumé. Aggregates multiple job boards, scores each listing with an LLM (local or cloud), and generates **tailored résumé PDFs** per job, designed to run locally with your data under your control.

---

## Table of contents

1. [Why JumpShip exists](#why-jumpship-exists)
2. [What it does](#what-it-does)
3. [Stack](#stack)
4. [Repository layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [How to run (without Docker)](#how-to-run-without-docker)
7. [How to run (with Docker)](#how-to-run-with-docker)
8. [LLM setup](#llm-setup)
9. [Environment variables](#environment-variables)
10. [API overview](#api-overview)
11. [Troubleshooting](#troubleshooting)
12. [Roadmap](#roadmap)
13. [License](#license)

---

## Why JumpShip exists

Employers automate candidate filtering before anyone reads a résumé. JumpShip helps you respond in kind: find roles that fit, see honest gaps and salary context, and export materials tuned to each posting, with optional cloud LLMs or fully **local** inference (Ollama / LM Studio).

---

## What it does

| Feature | Details |
|--------|---------|
| **Job aggregation** | Unified search across many boards (via JobSpy and related sources: LinkedIn, Indeed, Glassdoor, and regional boards such as Gupy, Programathor, Trampos, etc., depending on configuration). |
| **AI scoring** | LLM assesses each job (0–100), strengths, gaps, salary line, and company-oriented notes, grounded in your parsed résumé. |
| **Batch assessment** | Cloud-capable providers can assess many jobs concurrently; **local** providers share a semaphore so one GPU-heavy call runs at a time. |
| **Tailored résumé PDFs** | LLM fills an ATS-oriented **HTML** template → **xhtml2pdf** one-page PDF. Locally, pip usually installs pre-built wheels; **Docker** uses a multi-stage image so **pycairo** (a transitive dependency) can compile in the builder without keeping a compiler in the runtime image (see [How to run (with Docker)](#how-to-run-with-docker)). |
| **Job tracker** | Kanban-style flow: Saved → Applied → Interview → Offer → Rejected (drag-and-drop UI). |
| **Local-first** | Ollama or LM Studio by default; Anthropic, OpenAI, Groq, Gemini, and others supported when API keys are set (see `.env.example`). |

---

## Stack

**Backend:** Python 3.11 · FastAPI · SQLAlchemy 2.0 (SQLite) · JobSpy / custom scrapers · unified `LLMClient`  
**Frontend:** React 19 · TypeScript · Vite · TanStack Query v5 · @dnd-kit  
**LLM:** Ollama (default) · LM Studio (OpenAI-compatible) · Anthropic · OpenAI · Groq · Google Gemini · additional providers wired in `LLMClient`  
**PDF:** xhtml2pdf (+ HTML résumé template; requires **libcairo2** at runtime and, in Docker, a **builder** stage with Cairo headers + a C toolchain to build **pycairo**)

---

## Repository layout

```
JumpShip/
├── backend/
│   ├── Dockerfile       # Multi-stage backend image (wheels for pycairo / xhtml2pdf; slim runtime)
│   ├── models/          # SQLAlchemy models + Pydantic schemas
│   ├── routers/         # FastAPI routers (jobs_v2, resume_v2, resume_gen, profile, …)
│   ├── services/        # job_scraper_v2, ai_evaluator, resume_parser_v2, resume_generator, llm_client, …
│   └── main.py          # App entry + router registration
├── frontend/
│   └── src/
│       ├── pages/       # Landing, Search, JobTracker
│       └── components/  # Job cards, settings, upload, …
├── start.sh             # Bash: backend :8000 + frontend :5173 (no Docker)
├── docker-compose.yml   # Backend + nginx-served frontend
└── .env.example         # Copy to `.env` at repo root (backend reads it from there)
```

---

## Prerequisites

**Local (no Docker)**

- **Python 3.11+**
- **Node.js 20+** (18+ usually works; LTS 20 recommended)
- An LLM runtime: **Ollama** or **LM Studio** on the same machine, **or** API keys for cloud providers (see `.env.example`)

**Docker**

- **Docker** and **Docker Compose** v2 (`docker compose`)
- For local models from containers: **Ollama on the host** (default compose URL points at `host.docker.internal`)

---

## How to run (without Docker)

### Option A: One command (macOS / Linux / Git Bash)

From the repository root:

```bash
bash ./start.sh
```

This creates `.venv` if needed, installs `backend/requirements.txt`, copies `.env` from `.env.example` if missing, starts **uvicorn** on **http://localhost:8000**, and **Vite** on **http://localhost:5173**. Press `Ctrl+C` to stop both.

### Option B: Manual (all platforms)

**1. Environment**

```bash
# At repo root: copy example env if you do not have .env yet
cp .env.example .env
# Edit .env: set LLM_PROVIDER / LLM_MODEL and any API keys you need
```

**2. Backend**

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r backend/requirements.txt

# Repo root must be on PYTHONPATH so `backend` imports resolve
# Windows PowerShell:
$env:PYTHONPATH = (Get-Location).Path
# Windows cmd:
#   set PYTHONPATH=%CD%
# macOS / Linux:
export PYTHONPATH=$(pwd)

uvicorn backend.main:app --reload --port 8000
```

- API: **http://localhost:8000**  
- Interactive docs: **http://localhost:8000/docs**  
- Health: **http://localhost:8000/api/health**  
- LLM probe: **http://localhost:8000/api/health/llm**

**3. Frontend** (new terminal, repo root)

```bash
cd frontend
npm install
npm run dev
```

- UI: **http://localhost:5173** (Vite proxies `/api` to `http://localhost:8000`)

**4. Production-style frontend build** (optional)

```bash
cd frontend
npm run build
npm run preview    # serves the built assets; still expects API at /api or configure proxy/host
```

---

## How to run (with Docker)

Compose builds a **backend** image (FastAPI on port **8000**) and a **frontend** image (static build behind nginx on port **80**).

### Backend image (`backend/Dockerfile`)

The backend Dockerfile is **multi-stage** so `python:3.11-slim` stays small while dependencies that need native builds still install cleanly:

| Stage | What it installs | Why |
|--------|-------------------|-----|
| **builder** | `build-essential`, `pkg-config`, `libcairo2-dev` | Lets `pip wheel -r backend/requirements.txt` build wheels for packages that compile from source—especially **pycairo** (pulled in by **xhtml2pdf** → svglib / rlpycairo). On slim images there is no `gcc` by default, which otherwise causes Meson errors like “Unknown compiler(s): cc, gcc, clang…”. |
| **final** | `curl`, `libcairo2` | `curl` is for the container healthcheck. **libcairo2** is the runtime shared library **pycairo** links against. Python packages are installed with `pip install --no-index --find-links=/wheels`, then `/wheels` is deleted—**no compiler or `-dev` headers** remain in the running image. |

If you fork the Dockerfile, keep **libcairo2** in the final stage and keep building wheels in a stage that has **libcairo2-dev** (or equivalent) whenever **xhtml2pdf** stays in `requirements.txt`.

### 1. Configure environment for containers

Create a `.env` file at the repo root (Compose substitutes variables from it). Minimum for local Ollama on the host:

```env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://host.docker.internal:11434
# Optional: OLLAMA_HOST=... (legacy alias, same purpose as OLLAMA_BASE_URL)
```

Add cloud keys to the same file if you use OpenAI / Anthropic / Groq, etc. (see `.env.example` for names).

### 2. Build and start

```bash
docker compose build
docker compose up -d
```

| Service | URL |
|--------|-----|
| **Web UI** | http://localhost (port **80**) |
| **API** | http://localhost:8000 |
| **OpenAPI** | http://localhost:8000/docs |

### 3. Ollama on the host

The backend container talks to Ollama at **`host.docker.internal:11434`** by default (`docker-compose.yml`). On Linux, `extra_hosts` maps `host.docker.internal` to the host gateway. Start Ollama on the machine running Docker before relying on local models.

### 4. Useful Docker commands

```bash
docker compose logs -f backend    # follow API logs
docker compose logs -f frontend
docker compose down               # stop and remove containers (named volumes kept)
docker compose build --no-cache && docker compose up -d   # full rebuild
```

**Persistence:** Named volumes mount SQLite at `/app/data/jobspy_ui.db`, résumé uploads at `/app/uploads`, and generated PDFs at `/app/generated_resumes` inside the backend container (`docker-compose.yml`).

**CORS:** Default `CORS_ORIGINS` in Compose includes `http://localhost` and `http://localhost:8000`. If you serve the UI from another origin, extend `CORS_ORIGINS` in `docker-compose.yml` or override via env supported by your deployment.

---

## LLM setup

### Local: Ollama (default)

```bash
ollama pull gemma3:27b    # or a smaller model your GPU can hold
ollama serve
```

Use `LLM_PROVIDER=ollama` and set `LLM_MODEL` to the pulled model name. Tailored résumé generation and job assessment use JSON-style structured completions; pick a model that follows instructions reliably.

### Local: LM Studio

Run LM Studio’s local server (OpenAI-compatible). Point the app at it (base URL and provider) via **Settings** in the UI or via `.env` / request overrides, depending on how you configure the project.

### Cloud

Set the appropriate API keys in `.env` (see `.env.example`) and choose the matching provider in settings. Cloud batches can run assessments in parallel; local providers stay behind the shared semaphore to avoid starving the GPU.

---

## Environment variables

Copy **`.env.example`** to **`.env`** at the repo root. Common entries:

| Variable | Typical default | Notes |
|----------|-----------------|--------|
| `LLM_PROVIDER` | `ollama` | Also: `lmstudio`, `openai`, `anthropic`, `groq`, `gemini`, and others implemented in `LLMClient` |
| `LLM_MODEL` | `gemma3:27b` | Must match a model available to that provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Use `http://host.docker.internal:11434` from Docker to reach host Ollama |
| `OLLAMA_HOST` | _(optional)_ | Legacy alias; some health paths read it if `OLLAMA_BASE_URL` is unset |
| `DATABASE_URL` | `sqlite:///./jobspy_ui.db` | Main SQLite database |
| `UPLOAD_DIR` | `./uploads` | Parsed résumé uploads (legacy `/api/resume` paths) |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated origins for browser access |
| `RESUME_OUTPUT_DIR` | `./generated_resumes` | Directory for tailored PDF output (`resume_output_dir` in `backend/config.py`) |

Pydantic-settings reads env with **case-insensitive** names; the full field list is in `backend/config.py`. **`.env.example`** lists the variables this repo expects day-to-day (extend with any extra keys your `LLMClient` provider needs).

---

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/jobs/search` | Search jobs (structured `JobResult` list) |
| `POST` | `/api/jobs/assess` | Score one job against the résumé profile |
| `POST` | `/api/jobs/assess-batch` | Batch assessments |
| `POST` | `/api/resume/parse` | Parse PDF/DOCX → structured profile (v2 stack) |
| `POST` | `/api/resume/generate` | Generate tailored résumé PDF for a job |
| `GET` | `/api/resume/generated` | List generated résumé metadata |
| `GET` | `/api/resume/generated/{id}/download` | Download a stored PDF |
| `GET` | `/api/health` | Liveness + LLM provider summary |
| `GET` | `/api/health/llm` | Connectivity + sample completion check |

Legacy routes under `/api/...` from older modules may still be mounted for compatibility. Prefer the v2 `/api/jobs` and `/api/resume` paths above. Full detail: **`/docs`** on a running server.

---

## Tests (optional)

From the repository root, install dev tools and run the Python suite:

```bash
pip install -r backend/requirements.txt
pip install -r requirements-dev.txt
pytest
```

Frontend: `cd frontend && npm run test:run`

## Troubleshooting

**`ModuleNotFoundError: No module named 'backend'`**  
Set `PYTHONPATH` to the **repository root** (not `backend/`) before `uvicorn`.

**`UnicodeEncodeError` or odd characters in PDFs**  
Tailored PDFs use UTF-8 HTML (DejaVu Sans via xhtml2pdf). If a rare glyph fails, simplify that character in the source résumé and retry.

**Job search returns few or no results**  
Some boards rate-limit or require specific sites/keywords. Narrow sites, reduce `results_wanted`, or retry later.

**Docker: UI cannot reach API**  
Check browser console for CORS errors; align `CORS_ORIGINS` with the exact URL you use (`http://localhost` vs `http://127.0.0.1`).

**Docker: LLM unreachable**  
Confirm Ollama is listening on the host and that `OLLAMA_BASE_URL` / `OLLAMA_HOST` in Compose points at `host.docker.internal` (or your host IP on Linux if you customise it).

**Docker: `pip install` fails on `pycairo` / Meson “Unknown compiler(s)”**  
`xhtml2pdf` depends on **svglib**, which pulls **pycairo**. On minimal images, pycairo often builds from source and needs a C compiler plus Cairo **development** headers. The repo’s **`backend/Dockerfile`** fixes this with a **builder** stage (`build-essential`, `pkg-config`, `libcairo2-dev`) and `pip wheel`, then installs from those wheels in the final image with **`libcairo2`** only. If you see this error, ensure you are using the current Dockerfile (or add the same build deps before `pip install`). Rebuild with `docker compose build backend --no-cache`.

---

## Roadmap

| Item | Status |
|------|--------|
| Deeper Brazilian / regional aggregation | Planned |
| Multi-résumé profiles (switch persona without re-upload) | Planned |
| Interview prep from gap analysis | Planned |
| Richer inbox / email workflows tied to the tracker | Planned |

---

## License

MIT. See `LICENSE`.
