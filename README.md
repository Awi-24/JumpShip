<div align="center">
  <table align="center" cellpadding="24"><tbody><tr><td align="center" bgcolor="#0a0a0a"><img src="frontend/public/jumpship-logo.png" alt="JumpShip" width="380"></td></tr></tbody></table>
</div>

# JumpShip

> AI-powered job search built around your résumé. Aggregates multiple job boards, scores each listing with an LLM (local or cloud), and generates **tailored résumé PDFs** per job, designed to run locally with your data under your control.

**JumpShip 2.0** (October 2026) is a **native Windows app**: the whole backend rewritten in Rust and shipped in a 7 MB installer, with no Python, no Docker and no browser tab. Everything from 1.0 is there (search, LLM scoring, tailored PDFs, Kanban tracker, mock interviews, local-first LLMs), plus streaming search, an assessment cache, more sources and a filter for postings you can't apply to.

The Python / Docker web version from 1.0 still runs from this repo (see [Web mode](#web-mode-run-without-docker)).

---

## Table of contents

1. [Install the desktop app (Windows)](#install-the-desktop-app-windows)
2. [What's new in 2.0](#whats-new-in-20)
3. [JumpShip at a glance](#jumpship-at-a-glance)
4. [Why JumpShip exists](#why-jumpship-exists)
5. [What it does](#what-it-does)
6. [Stack](#stack)
7. [Repository layout](#repository-layout)
8. [Prerequisites](#prerequisites)
9. [Web mode: run without Docker](#web-mode-run-without-docker)
10. [Web mode: run with Docker](#web-mode-run-with-docker)
11. [LLM setup (local models guide)](#llm-setup)
12. [Environment variables](#environment-variables)
13. [API overview](#api-overview)
14. [Troubleshooting](#troubleshooting)
15. [Roadmap](#roadmap)
16. [License](#license)

---

## Install the desktop app (Windows)

1. Download the installer (`JumpShip_<version>_x64-setup.exe`) from the [latest release](https://github.com/Awi-24/JumpShip/releases/latest) and run it. It installs for your user only, so no admin rights are needed.
2. **Windows SmartScreen** may say "Windows protected your PC" because the installer isn't code-signed yet. Click **More info → Run anyway**.
3. If the machine lacks Microsoft Edge WebView2 (rare on Windows 10/11), the installer downloads it.
4. Install an LLM runtime: [Ollama](https://ollama.com/download) (then `ollama pull gemma3:12b` or another ≥7B instruct model) or [LM Studio](https://lmstudio.ai). Cloud providers work too, with your API key.
5. Open JumpShip → **config** → pick the provider and model → **Test Connection**. Then drop your résumé in **search**, choose boards and search.

Your data stays on your machine in `%APPDATA%\com.jumpship.desktop\` (`jobspy_ui.db`, `generated_resumes\`, `jumpship.log`). API keys are encrypted with a per-install secret kept in Windows Credential Manager. Uninstall from *Settings → Apps*; the uninstaller asks whether to delete that data too.

**Build it yourself:** Rust (stable), Node 20+ and `cargo install tauri-cli`, then `cd crates/desktop && cargo tauri build` → `target/release/bundle/nsis/JumpShip_<version>_x64-setup.exe`. Tailored PDFs use the installed Edge or Chrome in headless mode.

---

## What's new in 2.0

- **Native desktop app**: Rust backend (axum + SQLite) inside a Tauri window; opens the 1.0 database in place.
- **Retro-terminal UI**: filters | results | detail panes, collapsible menu and filters, keyboard views (`Ctrl+1..5`), launch splash, themed installer.
- **Streaming search**: each board's jobs show up as it answers, and assessment starts on the first batch instead of waiting for the slowest board.
- **More sources**: Remotive, Himalayas, Jobicy, Amazon, Ashby, SmartRecruiters, Inhire tenants and a rewritten **Career Pages** scraper (ATS APIs + headless Edge/Chrome); 9 Lever boards; Gupy filtered by city on city searches.
- **Smarter pipeline**: keyword ranking before truncation, salaries normalized to annual USD for sorting, per-host politeness with retry on 429, an assessment cache (the same job + résumé + model is never scored twice), "new since last search" and dismiss.
- **Eligibility filter**: set gender / PcD in **Profile**, and postings restricted to women or to people with disabilities that you can't apply to are hidden (listed under "not eligible").
- **Ollama native API** with a context window sized to each prompt.

---

## JumpShip at a glance

| Area | What you get |
|------|--------------|
| **Search** | LinkedIn, Indeed, RemoteOK, Arbeitnow, Remotive, Himalayas, Jobicy, Gupy, Programathor, Trampos, plus **JumpShip Scrapper**: Greenhouse, Lever, Workday, SmartRecruiters, Ashby, Amazon and Career Pages (`backend/data/brazil-career-sources.json`). Toggle sources in the UI. Glassdoor only in web mode (see [Known limitations](#known-limitations)). |
| **LLM** | **Ollama** (default) and **LM Studio** with discovery + semaphore for local batch scoring; OpenAI, Anthropic, Groq, Gemini, and others via env or Settings. |
| **Résumé** | PDF/DOCX → structured profile; tailored one-page PDF per job from an ATS-oriented HTML template. |
| **Tracker** | Drag-and-drop Kanban (Saved → Applied → Interview → Offer → Rejected). |
| **Interview** | Stateless chat endpoints: company/role research (DuckDuckGo) + persona; full conversation state stays in the browser. |
| **Privacy** | No account required; optional API keys can be stored encrypted (Fernet) from Settings when you choose cloud providers. |

**Fastest path (web mode, local LLM):** install [Ollama](https://ollama.com/download) → `ollama pull` a 7B+ instruct model → `ollama serve` → copy `.env.example` to `.env`, set `LLM_PROVIDER=ollama` and `LLM_MODEL` → run backend + frontend (see [How to run](#web-mode-run-without-docker)) → in the app, **Settings → Test Connection**. Details: [LLM setup](#llm-setup).

---

## Why JumpShip exists

Employers automate candidate filtering before anyone reads a résumé. JumpShip helps you respond in kind: find roles that fit, see honest gaps and salary context, and export materials tuned to each posting, with optional cloud LLMs or fully **local** inference (Ollama / LM Studio).

---

## What it does

| Feature | Details |
|--------|---------|
| **Job aggregation** | Unified search across many boards (via JobSpy and related sources: LinkedIn, Indeed, Glassdoor, and regional boards such as Gupy, Programathor, Trampos, etc.) **plus the JumpShip Scrapper** — a set of four purpose-built scrapers that pull directly from company career portals not syndicated to aggregators (see below). |
| **AI scoring** | LLM assesses each job (0–100), strengths, gaps, salary line, and company-oriented notes, grounded in your parsed résumé. |
| **Batch assessment** | Cloud-capable providers can assess many jobs concurrently; **local** providers share a semaphore so one GPU-heavy call runs at a time. |
| **Tailored résumé PDFs** | LLM fills an ATS-oriented **HTML** template → **xhtml2pdf** one-page PDF. Locally, pip usually installs pre-built wheels; **Docker** uses a multi-stage image so **pycairo** (a transitive dependency) can compile in the builder without keeping a compiler in the runtime image (see [How to run (with Docker)](#web-mode-run-with-docker)). |
| **Job tracker** | Kanban-style flow: Saved → Applied → Interview → Offer → Rejected (drag-and-drop UI). |
| **Local-first** | Ollama or LM Studio by default; Anthropic, OpenAI, Groq, Gemini, and others supported when API keys are set (see `.env.example`). |

---

## Stack

**Desktop (2.0):** Rust · Tauri v2 (WebView2) · axum · rusqlite · reqwest; the same React UI, served by the in-process server
**Web backend (1.0):** Python 3.11 · FastAPI · SQLAlchemy 2.0 (SQLite) · JobSpy / JumpShip Scrapper (Greenhouse · Lever · Workday · Playwright) · unified `LLMClient`  
**Frontend:** React 19 · TypeScript · Vite · TanStack Query v5 · @dnd-kit  
**LLM:** Ollama (default) · LM Studio (OpenAI-compatible) · Anthropic · OpenAI · Groq · Google Gemini · additional providers wired in `LLMClient`  
**PDF:** xhtml2pdf (+ HTML résumé template; requires **libcairo2** at runtime and, in Docker, a **builder** stage with Cairo headers + a C toolchain to build **pycairo**)

---

## Repository layout

```
JumpShip/
├── crates/
│   ├── core/            # Job model, location / keyword tables, ranking
│   ├── sources/         # Every job source (golden-tested against the Python parsers)
│   ├── server/          # axum API: search, assessment, résumé, tracker, interview, LLM client
│   └── desktop/         # Tauri shell + NSIS installer (installer/ holds its look)
├── docs/rust-migration/ # Plan, API contract, source specs, DB schema
├── backend/
│   ├── Dockerfile       # Multi-stage backend image (wheels for pycairo / xhtml2pdf; slim runtime)
│   ├── models/          # SQLAlchemy models + Pydantic schemas
│   ├── routers/         # FastAPI routers (jobs_v2, resume_v2, resume_gen, profile, …)
│   ├── data/            # brazil-career-sources.json — registry of ~100 company career portals
│   ├── services/        # job_scraper_v2, ai_evaluator, resume_parser_v2, resume_generator, llm_client, …
│   │                    # JumpShip Scrapper: career_sources, greenhouse_scraper, lever_scraper,
│   │                    #                   workday_scraper, playwright_scraper
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

## Web mode: run without Docker

The 1.0 web stack (FastAPI + Vite) still works for development or a server deployment. To run the Rust API behind the same Vite UI instead of FastAPI: `cargo run -p jumpship-server` (port 8000).

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

## Web mode: run with Docker

Compose builds a **backend** image (FastAPI on port **8000**) and a **frontend** image (static build behind nginx on port **80**). The backend service sets **`DEBUG=true`** so the default `SECRET_KEY` from settings does not abort startup (your `.env` is not copied into the image). For a real deployment, override with a strong `SECRET_KEY` and `DEBUG=false`. The same compose file passes **host** defaults for **`OLLAMA_BASE_URL`** / **`OLLAMA_HOST`** and **`LMSTUDIO_BASE_URL`** via `host.docker.internal` so local LLMs on the machine running Docker are reachable from the container.

### Backend image (`backend/Dockerfile`)

The backend Dockerfile is **multi-stage** so `python:3.11-slim` stays small while dependencies that need native builds still install cleanly:

| Stage | What it installs | Why |
|--------|-------------------|-----|
| **builder** | `build-essential`, `pkg-config`, `libcairo2-dev` | Lets `pip wheel -r backend/requirements.txt` build wheels for packages that compile from source—especially **pycairo** (pulled in by **xhtml2pdf** → svglib / rlpycairo). On slim images there is no `gcc` by default, which otherwise causes Meson errors like “Unknown compiler(s): cc, gcc, clang…”. |
| **final** | `curl`, `libcairo2` | `curl` is for the container healthcheck. **libcairo2** is the runtime shared library **pycairo** links against. Python packages are installed with `pip install --no-index --find-links=/wheels`, then `/wheels` is deleted—**no compiler or `-dev` headers** remain in the running image. |

If you fork the Dockerfile, keep **libcairo2** in the final stage and keep building wheels in a stage that has **libcairo2-dev** (or equivalent) whenever **xhtml2pdf** stays in `requirements.txt`.

### 1. Configure environment for containers

Create a `.env` file at the repo root (Compose substitutes variables from it).

**Ollama on the host** (default in `docker-compose.yml`):

```env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://host.docker.internal:11434
# Optional: OLLAMA_HOST=... (legacy alias, same purpose as OLLAMA_BASE_URL)
```

**LM Studio on the host** (OpenAI-compatible server; same `host.docker.internal` pattern so the backend container reaches your machine):

```env
LLM_PROVIDER=lmstudio
LLM_MODEL=<exact-id-of-the-model-loaded-in-lm-studio>
LMSTUDIO_BASE_URL=http://host.docker.internal:1234
```

`docker-compose.yml` defaults `LMSTUDIO_BASE_URL` to `http://host.docker.internal:1234` if unset; change the port if LM Studio’s **Local Server** uses another one. In JumpShip **Settings**, set **Base URL** to the same value (or rely on env defaults after restart).

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

The backend container talks to Ollama at **`http://host.docker.internal:11434`** by default (`docker-compose.yml`). On Linux, `extra_hosts` maps `host.docker.internal` to the host gateway. Start Ollama on the machine running Docker before relying on local models.

### 4. LM Studio on the host

If **`LLM_PROVIDER=lmstudio`**, the backend must reach LM Studio’s **Local Server** on the host (default **port 1234**). Set **`LMSTUDIO_BASE_URL=http://host.docker.internal:1234`** in `.env` (or rely on the same default in `docker-compose.yml`). In LM Studio, load a model and click **Start Server** before using JumpShip. Use **Settings → Test Connection** in the app to confirm.

### 5. Useful Docker commands

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

### Guia rápido (PT-BR): modelos locais

1. **Instale o Ollama** a partir de [ollama.com/download](https://ollama.com/download) (ou use **LM Studio** se preferir baixar modelos GGUF com interface gráfica).
2. **Obtenha um modelo** com boa aderência a instruções estruturadas (recomenda-se **≥7B** instruct, por exemplo `gemma3:12b` ou `qwen2.5:7b`): `ollama pull <nome>` e, em seguida, `ollama serve`.
3. **Crie o `.env` na raiz** (`cp .env.example .env`) com `LLM_PROVIDER=ollama`, `LLM_MODEL` igual ao nome do modelo, e `OLLAMA_BASE_URL=http://localhost:11434`. Com **Docker** e Ollama no computador host: use `http://host.docker.internal:11434`.
4. **Suba API e UI** (ver [How to run](#web-mode-run-without-docker)); no app, **Settings** → **Test Connection**; envie o currículo, pesquise em **Search** e organize candidaturas no **Job tracker**.

**LM Studio:** carregue um modelo, inicie o servidor local. **Sem Docker:** base URL **`http://localhost:1234`**. **Com Docker** (API no container, LM Studio no PC): **`http://host.docker.internal:1234`** (variável `LMSTUDIO_BASE_URL` no `.env` ou o default do `docker-compose.yml`). Escolha o provedor LM Studio nas configurações e teste a conexão.

---

### Option 1 — Ollama (default, local)

Ollama runs models locally on your machine. JumpShip uses it as the default provider.

#### 1. Install Ollama

Download from [ollama.com](https://ollama.com/download) and follow the installer for your OS.

#### 2. Pull a model

```bash
ollama pull gemma3:27b        # recommended — strong instruction-following, ~17 GB
ollama pull gemma3:12b        # lighter alternative, ~8 GB
ollama pull qwen2.5:7b        # fastest option for low-VRAM machines
```

> **Pick a model that can follow structured instructions.** JumpShip sends multi-step prompts with JSON and XML output requirements. Models smaller than 7B often fail at these. `gemma3:12b` is a good minimum.

#### 3. Start the Ollama server

```bash
ollama serve
```

Ollama listens on **http://localhost:11434** by default. Leave this terminal open while using JumpShip. In JumpShip’s **Settings**, set the provider to **Ollama (local)** and the Base URL to `http://localhost:11434`.

#### 4. Verify the connection

Open JumpShip → Settings → click **Test Connection**. A green "Connected" message confirms Ollama is reachable.

---

#### Using Ollama Cloud models (e.g. `gemma4:31b-cloud`)

Ollama supports cloud-hosted models that stream inference from Ollama’s servers without a local download. These models **only appear in JumpShip’s model list while they are actively running** — they are not indexed by Ollama’s API until a session is open.

**To activate a cloud model so it appears in JumpShip:**

1. Open a terminal and start a chat session with the model:

   ```bash
   ollama run gemma4:31b-cloud
   ```

2. Wait for the prompt (`>>>`). The model is now running and will appear in JumpShip’s model dropdown.
3. Leave that terminal open while using JumpShip. The model will be listed as long as the session is active.
4. Select the model in JumpShip’s Settings and save.

> **Note:** If you close the terminal session, the cloud model disappears from the list. Re-run step 1 to bring it back. Locally downloaded models (pulled with `ollama pull`) always appear regardless of active sessions.

---

### Option 2 — LM Studio (local, OpenAI-compatible)

LM Studio provides a local server with an OpenAI-compatible API. It lets you download and switch models from a GUI without using the terminal.

#### 1. Install LM Studio

Download from [lmstudio.ai](https://lmstudio.ai) and install it.

#### 2. Download a model inside LM Studio

1. Open LM Studio and go to the **Search** tab (magnifying glass icon).
2. Search for a model (e.g. `Gemma 3`, `Qwen 2.5`, `Mistral`).
3. Click **Download** on the variant you want (GGUF Q4 or Q5 is a good balance of speed and quality).

#### 3. Load the model and start the local server

1. In LM Studio, go to the **Developer** tab (or **Local Server** tab depending on your version).
2. Select the downloaded model from the dropdown.
3. Click **Start Server**.

LM Studio will start an OpenAI-compatible server on **http://localhost:1234** by default (change the port in LM Studio if needed).

#### 4. Configure JumpShip

In JumpShip’s **Settings**:
- **LLM Provider** → **LM Studio (local)**
- **Base URL** — use the URL that matches where the **backend** runs:
  | Where the API runs | Base URL for LM Studio |
  |--------------------|-------------------------|
  | Same machine as LM Studio (e.g. `uvicorn` + `npm run dev`) | **`http://localhost:1234`** |
  | **Docker** backend, LM Studio on the host | **`http://host.docker.internal:1234`** (or your custom port) |

You can also set **`LMSTUDIO_BASE_URL`** in `.env` at the repo root; `LLMClient` uses it when `LLM_PROVIDER=lmstudio` and no per-request override is set. `docker-compose.yml` defaults this to **`http://host.docker.internal:1234`** for containerized stacks.

- The model list will populate automatically with whatever is loaded in LM Studio.

Click **Test Connection** to verify.

> **Note:** Only the model currently loaded in LM Studio appears in the dropdown. To switch models, load a different model in LM Studio and click **Test Connection** again in JumpShip to refresh the list.

---

### Option 3 — Cloud providers

Set the appropriate API key in `.env` (or in JumpShip’s Settings UI) and choose the matching provider. Supported: OpenAI, Anthropic (Claude), Groq, Google Gemini, Mistral, DeepSeek, OpenRouter, Cohere, HuggingFace.

```env
# .env (repo root)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...
```

Cloud providers run batch assessments in parallel (no semaphore); local providers (Ollama, LM Studio) serialize GPU calls automatically.

---

## Environment variables

Copy **`.env.example`** to **`.env`** at the repo root. Common entries:

| Variable | Typical default | Notes |
|----------|-----------------|--------|
| `LLM_PROVIDER` | `ollama` | Also: `lmstudio`, `openai`, `anthropic`, `groq`, `gemini`, and others implemented in `LLMClient` |
| `LLM_MODEL` | `gemma3:27b` | Must match a model available to that provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Use `http://host.docker.internal:11434` from Docker to reach host Ollama |
| `OLLAMA_HOST` | _(optional)_ | Legacy alias; some health paths read it if `OLLAMA_BASE_URL` is unset |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234` | LM Studio **Local Server**; use `http://host.docker.internal:1234` when the FastAPI backend runs in Docker and LM Studio stays on the host (see [How to run (with Docker)](#web-mode-run-with-docker)) |
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

## JumpShip Scrapper

Many companies post jobs exclusively on their own ATS portals, never syndicating to LinkedIn or Indeed. The **JumpShip Scrapper** fills that gap with four specialized scrapers wired into the same `/api/jobs/search` endpoint. Enable them from the **Job Boards** panel in the UI under the *JumpShip Scrapper* group.

| Scraper | Site string | How it works | Coverage (examples) |
|---------|-------------|--------------|---------------------|
| **Greenhouse** | `greenhouse` | Public Job Board REST API — no auth | iFood, Hotmart, Anthropic, Banco Inter |
| **Lever** | `lever` | Public Postings API v0 — no auth | Neon, Swile, Binance, Kavak, Xepelin, Pigment, Aircall, Qonto, Toptal |
| **SmartRecruiters** | `smartrecruiters` | Public Postings API, country filter server-side (desktop) | Bosch, Experian, Accor, Eurofins, … |
| **Ashby** | `ashby` | Public job-board API (desktop) | OpenAI, Notion, Linear, Supabase, … |
| **Amazon** | `amazon` | amazon.jobs search JSON (desktop) | Amazon |
| **Workday** | `workday` | Undocumented CXS REST endpoint (POST) | Santander, Equinor, AES Brasil, Natura&Co |
| **Career Pages** | `playwright` | Desktop: ATS APIs (Eightfold, Workday, Oracle HCM, Empregare, Inhire) + headless Edge/Chrome over CDP. Web: Playwright | PicPay, Itaú, Magalu, B3, SAP, Toyota, Shell, Google, Vale, Mercado Livre, Olist, … |

Source registry: `backend/data/brazil-career-sources.json` (~100 Brazilian and global companies with ATS metadata).

### Adding more companies

1. Add an entry to `brazil-career-sources.json` with the correct `ats` value (`greenhouse`, `lever`, `workday`, `custom`, `eightfold`, `empregare`, etc.).
2. For Greenhouse/Lever/Workday: set the `api` block with the board token / site / careers URL.
3. For custom portals: add the source ID to `_PRIORITY_SOURCE_IDS` in `backend/services/playwright_scraper.py`.

### Known limitations

- **Glassdoor** needs a Chrome-TLS client that the desktop app doesn't have yet (Cloudflare answers 403), so it's only offered in web mode.
- **Gupy**'s public search returns 12 jobs per keyword: city searches ask Gupy for that city, other searches get its first 12 nationwide.
- Playwright scraper targets 38 portals but ~19 currently return results; heavy SPAs (Meta, Bradesco, VW, etc.) need stealth browser tooling (`patchright`) or a managed proxy to bypass bot detection.
- Workday boards are global — results may include non-Brazil locations for multinational tenants; use the keyword filter to narrow results.
- Playwright requires Chromium binaries: run `playwright install chromium` after `pip install -r backend/requirements.txt`.

---

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
**Ollama:** confirm `ollama serve` on the host and that `OLLAMA_BASE_URL` / `OLLAMA_HOST` in Compose point at `http://host.docker.internal:11434` (or your host IP on Linux if you customise it).  
**LM Studio:** confirm **Local Server** is started in LM Studio and set `LMSTUDIO_BASE_URL` (and Settings **Base URL**) to **`http://host.docker.internal:<port>`** — `localhost` inside the container is the container itself, not your Mac/Windows/Linux host.

**Docker: `pip install` fails on `pycairo` / Meson “Unknown compiler(s)”**  
`xhtml2pdf` depends on **svglib**, which pulls **pycairo**. On minimal images, pycairo often builds from source and needs a C compiler plus Cairo **development** headers. The repo’s **`backend/Dockerfile`** fixes this with a **builder** stage (`build-essential`, `pkg-config`, `libcairo2-dev`) and `pip wheel`, then installs from those wheels in the final image with **`libcairo2`** only. If you see this error, ensure you are using the current Dockerfile (or add the same build deps before `pip install`). Rebuild with `docker compose build backend --no-cache`.

---

## Roadmap

| Item | Status |
|------|--------|
| **JumpShip 2.0** — native Windows app (Rust + Tauri), streaming search, new sources, eligibility filter | ✅ Shipped |
| **JumpShip 1.0** — stable search, LLM stack, tracker, interview flow | ✅ Shipped |
| AI job scoring with hire recommendation verdict | ✅ Shipped |
| ATS-optimized tailored résumé PDF generation | ✅ Shipped |
| Mock interview chatbot (state-machine, one question per turn) | ✅ Shipped |
| Per-step model overrides (evaluator / résumé gen / interview) | ✅ Shipped |
| Ollama + LM Studio auto model discovery | ✅ Shipped |
| JumpShip Scrapper — Greenhouse, Lever, Workday, Playwright scrapers | ✅ Shipped |
| Deeper Brazilian / regional aggregation | In progress |
| Code-signed installer; macOS / Linux builds | Planned |
| Glassdoor in the desktop app (TLS impersonation) | Planned |
| Multi-résumé profiles (switch persona without re-upload) | Planned |
| Richer inbox / email workflows tied to the tracker | Planned |

---

## License

MIT. See `LICENSE`.
