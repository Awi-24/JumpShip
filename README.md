# JumpShip

> A fork of [python-jobspy](https://github.com/Bunsly/JobSpy) — a full-featured job search platform with a modern UI, AI-powered resume analysis, and a local-first LLM integration.

---

## What is this?

**JumpShip** wraps the python-jobspy scraping engine in a complete web application. Instead of a bare Python library you get:

- A dark-themed React UI to search and browse jobs
- AI resume analysis — compatibility score, strong points, gaps, keywords, and career suggestions
- Per-request LLM configuration (switch providers without restarting the server)
- Support for **Ollama, OpenAI, Anthropic, and Groq** out of the box — including 100% local/free options

---

## Features

### Job search
- Scrapes **LinkedIn, Indeed, Glassdoor, ZipRecruiter** simultaneously
- Filters: location, job type, remote-only, results count
- Match score shown on each card when a resume is uploaded
- Expand any card to view the full description and lazy-load the AI assessment

### Resume analysis
- Upload a PDF or DOCX once — it is parsed on the server and kept in memory for the session
- Click **Assess** on any job to get:
  - **Match score** (0–100)
  - **Strong points** — what on your resume matches the role
  - **Gaps** — requirements you don't currently cover
  - **Career suggestions** — concrete next steps

### LLM configuration
- Fully configurable from the Settings modal (⚙ button in the header)
- Per-request LLM override — each search/assess call can specify a different provider, model, and API key without touching any config files
- Supported providers: Ollama (local), LM Studio, OpenAI, Anthropic, Groq

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Backend | FastAPI + Pydantic v2 + Python 3.11 |
| Scraping | python-jobspy (LinkedIn, Indeed, Glassdoor, ZipRecruiter) |
| Resume parsing | pdfminer.six (PDF), python-docx (DOCX) |
| LLM | Ollama · OpenAI · Anthropic · Groq |
| Container | Docker Compose (nginx reverse proxy + backend) |

---

## Quick start

### With Docker Compose (recommended)

```bash
# 1. Clone
git clone https://github.com/your-org/jumpship.git
cd jumpship

# 2. Configure environment (optional — defaults work with Ollama)
cp .env.example .env
# Edit .env to set your LLM provider and API keys

# 3. Start
docker compose up --build
```

Open [http://localhost](http://localhost). The frontend is served by nginx on port 80 and proxies `/api/` to the backend on port 8000.

### Local development

**Backend**

```bash
cd backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev        # starts Vite dev server on http://localhost:5173
```

Vite proxies `/api` requests to `http://localhost:8000` automatically.

---

## Environment variables

Copy `.env.example` to `.env` in the project root and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | Active LLM provider (`ollama`, `openai`, `anthropic`, `groq`) |
| `LLM_MODEL` | `llama3:8b` | Model name for the chosen provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server address |
| `OPENAI_API_KEY` | — | OpenAI key (only needed when using OpenAI) |
| `ANTHROPIC_API_KEY` | — | Anthropic key (only needed when using Anthropic) |
| `GROQ_API_KEY` | — | Groq key (only needed when using Groq) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins for the API |

API keys entered in the Settings modal are stored in `localStorage` and sent directly to the chosen provider — they are never stored on the server.

---

## Running tests

### Backend

```bash
# Install dependencies
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx

# Unit tests (no external services required)
pytest tests/unit/ -v

# Integration tests (no external services required)
pytest tests/integration/ -v -m "not llm_integration"

# LLM integration tests (requires Ollama running locally)
pytest tests/integration/test_llm_integration.py -v
```

### Frontend

```bash
cd frontend
npm run test:run          # single run
npm run test:coverage     # with V8 coverage report
```

Current test coverage: **41 backend tests** (unit + integration) and **38 frontend tests** (components + hooks), all passing with no external dependencies required.

---

## Project structure

```
jumpship/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # pydantic-settings configuration
│   ├── models/schemas.py        # Pydantic v2 request/response schemas
│   ├── routers/
│   │   ├── jobs_v2.py           # POST /api/jobs/search, /api/jobs/assess
│   │   └── resume_v2.py         # POST /api/resume/parse
│   └── services/
│       ├── llm_service.py       # LLM abstraction (Ollama/OpenAI/Anthropic/Groq)
│       ├── job_scraper_v2.py    # python-jobspy wrapper
│       └── resume_parser_v2.py  # PDF/DOCX text extraction + LLM profile parsing
├── frontend/
│   ├── src/
│   │   ├── pages/               # Landing.tsx, Search.tsx
│   │   ├── components/          # JobCard, ScoreRing, ResumeUpload, SettingsModal, …
│   │   ├── hooks/               # useSettings, useJobs, useResume
│   │   └── types/               # TypeScript interfaces
│   └── vitest.config.ts
├── tests/
│   ├── unit/                    # Schema, config, LLM, scraper, parser unit tests
│   └── integration/             # API endpoint tests + live LLM tests
├── docker-compose.yml
└── .env.example
```

---

## License

MIT — same as the upstream [python-jobspy](https://github.com/Bunsly/JobSpy) project.
