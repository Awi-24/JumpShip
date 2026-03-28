# JumpShip

> An AI-powered job search platform that pushes back against automated hiring. Built on [python-jobspy](https://github.com/Bunsly/JobSpy).

---

## Why JumpShip exists

Many companies now automate how they filter candidates: ATS rules, keyword scoring, and black-box scoring remove people **before anyone reads their story**. Applicants often never get **a real chance** to show what they can do. The system can discard them even when they are **well aligned with the role**, or when they are **motivated to grow** and develop the skills the job needs.

JumpShip exists to rebalance that dynamic. If employers use automation to screen people out, job seekers deserve tools that help them **find fit, understand gaps, and use their time on roles that matter**—instead of losing silently to a filter.

---

## Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI (Python 3.11+), SQLAlchemy, SQLite, pydantic-settings |
| **Frontend** | React 19, TypeScript, Vite 8, TanStack Query, Framer Motion |
| **LLM integration** | Ollama (local-first), OpenAI, Anthropic, Groq — configurable per request |
| **Resume parsing** | pdfminer.six, python-docx, LLM-powered extraction |
| **Job scraping** | python-jobspy wrapper + custom scrapers (RemoteOK, Arbeitnow, Gupy, Programathor, Trampos) |
| **Styling** | Custom CSS, dark theme with gold accent palette |

---

## Next steps (roadmap)

Planned focus areas:

1. **Auto-application** — Reduce friction when applying: use parsed profile data to help fill forms, draft tailored cover letters, and (where technically and ethically viable) streamline submission across supported sites.
2. **Agentic workflows** — Autonomous assistants that can run on a schedule or triggers: discover new listings, assess fit, surface high-match roles, and eventually coordinate follow-up steps with clear human oversight.

Broader ideas still on the list:

- **Application analytics** — Track outcomes, response times, and which profiles or keywords perform best.
- **Resume optimization** — Targeted suggestions per role (keywords, wording, gaps).
- **Interview prep** — Questions and talking points from the job description and your profile.
- **Multi-language UI** — Full i18n (e.g. Portuguese and English).

---

## Features

### Job search
- Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, RemoteOK, Arbeitnow, and Brazilian boards (Gupy, Programathor, Trampos)
- OR-based keyword search for broader results across all boards
- Smart deduplication (fuzzy title + company matching across sources)
- In-memory search caching (15min TTL) to avoid redundant scraping
- Pagination with "Load More" for large result sets

### AI-powered assessment
- Every job gets a match score (0–100), gap analysis, and career suggestions
- Company intelligence enriched with live web data (culture, salary, Glassdoor sentiment)
- Configurable assessment speed: Careful (1 at a time), Balanced (3 parallel), Turbo (6 parallel)
- Automatic retry on LLM parse failures
- Irrelevant job filtering with a "Show hidden" toggle to review flagged jobs

### Resume intelligence
- Upload PDF or DOCX — the LLM extracts skills, seniority, domains, and suggested keywords
- Auto-populates search filters from your profile
- AI keyword expansion: related terms and Portuguese translations for broader coverage

### Job tracking
- Bookmark jobs and track application status (Saved → Applied → Interview → Rejected → Offer)
- Export results as CSV or JSON with assessment data included
- Search history with one-click restore
- Description quality warnings for jobs with insufficient detail

### Privacy-first
- Resume stays on your machine
- Inference runs locally via Ollama by default
- Cloud APIs are opt-in and key-controlled
- No accounts, no tracking, no data collection

---

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 18+
- (Optional) [Ollama](https://ollama.ai) for local LLM inference

### Setup

```bash
# Clone
git clone https://github.com/Awi-24/JumpShip.git
cd JumpShip

# Backend (from repo root, after venv activate)
pip install -r backend/requirements.txt
cp .env.example .env  # edit with your settings

# Frontend
cd frontend
npm install
cd ..

# Run both
chmod +x start.sh
./start.sh
```

The backend runs on `localhost:8000`, the frontend on `localhost:5173`.

### Quick start with Ollama (free, local)

```bash
ollama pull qwen2.5:7b-instruct
./start.sh
```

Open `localhost:5173`, upload your resume, and search. No API keys needed.

---

## Architecture

```
JumpShip/
├── backend/
│   ├── main.py                 FastAPI app
│   ├── config.py               pydantic-settings (.env)
│   ├── models/schemas.py       Pydantic v2 models
│   ├── routers/
│   │   ├── resume_v2.py        POST /api/resume/parse
│   │   ├── jobs_v2.py          POST /api/jobs/search, /assess, /suggest-keywords, /translate-keywords
│   │   └── (legacy routers)
│   └── services/
│       ├── llm_service.py      Unified LLM abstraction (Ollama/OpenAI/Anthropic/Groq)
│       ├── resume_parser_v2.py PDF/DOCX text + LLM profile extraction
│       ├── job_scraper_v2.py   JobSpy wrapper + dedup + caching
│       ├── extra_sources.py    RemoteOK, Arbeitnow scrapers
│       ├── br_sources.py       Brazilian job board scrapers
│       ├── salary_normalizer.py Salary parsing and normalization
│       └── web_search.py       Company intelligence via web
├── frontend/
│   ├── src/pages/              Landing.tsx, Search.tsx
│   ├── src/components/         JobCard, ScoreRing, SettingsModal, AssessmentLoader, etc.
│   ├── src/hooks/              useResume, useJobs, useSettings
│   └── src/types/              TypeScript interfaces
├── .env.example
└── start.sh                    Starts backend:8000 + frontend:5173
```

---

## Development notes

This project was developed with help from **Claude** (Anthropic) for **code review** and for **parts of the UI**—the repetitive layout, styling, and wiring that is necessary but not where most of the creative product decisions live. Core product direction, domain logic, and architecture remain author-driven.

---

## Credits

Built by [Adrian Widmer](https://awi-24.github.io) · Fork of [python-jobspy](https://github.com/Bunsly/JobSpy) by Bunsly

---

## License

This project inherits the license from [python-jobspy](https://github.com/Bunsly/JobSpy). See the original repository for license details.
