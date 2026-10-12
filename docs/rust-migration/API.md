# HTTP API contract for the Rust port

Goal: the Rust core exposes the same HTTP API so `frontend/` runs unchanged (it only uses relative `/api/...` URLs; Vite proxies to `:8000`, nginx proxies to `backend:8000`).

Machine-readable companions (regenerate with `PYTHONPATH=. .venv/Scripts/python.exe docs/rust-migration/gen_contract.py`):

- `openapi.json` - FastAPI's own schema (48 paths). Use it for exact field names/types/defaults of every request and response model. Note: the shadowed legacy `POST /api/jobs/search` is excluded (see below), so the entry shown is the v2 handler.
- `schema.sql` - SQLite DDL + ORM-side defaults + runtime migrations.
- `../../backend/prompts/` - LLM prompt text; `LLM.md` - LLM layer spec.

Base evidence: every `fetch('/api/...')` under `frontend/src` (excluding tests). There is no other HTTP client in the frontend (no axios, no `EventSource`, no WebSocket, no `AbortController`/timeouts).

## Cross-cutting behaviour

- **Errors**: FastAPI default shape `{"detail": "<string>"}` for `HTTPException`; request-validation failures are `422 {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`. `useResume.ts` handles both (string, or array joined by `; ` using `msg`); `useJobs.ts` only reads a string `detail`. Keep `detail` as the error key.
- **CORS**: `CORSMiddleware`, origins from `CORS_ORIGINS` (default `http://localhost:5173,http://localhost:3000,http://localhost`), credentials on, all methods/headers, `expose_headers=["X-Source-Status"]`. Only `X-Source-Status` is exposed (`X-Generated-Resume-Id` is sent but not exposed and not read by the frontend). Under Tauri the page origin changes (`tauri://localhost` / `http://tauri.localhost`) and the frontend's relative `/api` URLs need either the Rust server serving the SPA from the same origin or a base-URL shim.
- **Auth**: only `profile` router routes carry `Depends(verify_api_key)` (header `X-API-Key`, enforced only when `API_KEY` is set; otherwise open). The frontend never sends `X-API-Key`, so setting `API_KEY` breaks `/api/profile` for the UI. No other route is gated.
- **Timeouts**: the frontend sets none. Calls can run for minutes (local LLM, scraping, PDF generation with up to 3 compaction passes). The only enforced limit in the shipped stack is nginx `proxy_read_timeout/proxy_send_timeout 300s` in `frontend/nginx.conf` (Docker). Server side: `/api/health` Ollama probe 5 s; `/api/ollama/models` and Ollama part of `/api/test-llm` 4 s per URL; `/api/groq/models` 6 s; `/api/test-llm` cloud key checks 8 s; Cohere adapter 60 s; OpenAI-compatible and Anthropic SDK defaults (10 min) otherwise.
- **Blocking work**: handlers push sync LLM/scrape/PDF work to threads (`asyncio.to_thread`) and serialize local-provider LLM calls with a semaphore (see `LLM.md`). The port must keep the server responsive during these calls (health polls every 15 s).
- **Per-request LLM override**: most LLM-backed request bodies extend `LLMOverride` = `llm_provider`, `llm_model`, `llm_api_key`, `llm_base_url` (all optional, fall back to `.env`). The frontend sends all four on every LLM call (`getLlmFields`); `llm_base_url` is the Ollama URL setting even when the provider is a cloud one (see `LLM.md`, "verify before porting").
- **Streaming**: none. No SSE/chunked/WebSocket responses; every endpoint returns one JSON document or one file.

## Endpoints used by the frontend

### Search page

| Endpoint | Caller | Notes |
|---|---|---|
| `GET /api/health` | `Search.tsx` (poll every 15 s) | `HealthResponse {status, llm_provider, llm_model, llm_available, version}`. `llm_available` is an Ollama `/api/tags` probe (5 s) via `LLMService`, regardless of the configured provider; UI shows green/yellow, red when the request itself fails. |
| `POST /api/jobs/search` | `hooks/useJobs.ts` | Body `JobSearchRequest` (`keywords[]`, `location="Remote"`, `job_type="fulltime"`, `sites[]` default `["linkedin","indeed","glassdoor"]`, `results_wanted=20`, `hours_old?`, `work_mode="any"`, `resume_profile?`, + LLM override). Response: JSON array of `JobResult`. **Header `X-Source-Status`**: `json.dumps({site: {"count": int, "error": str\|null}})` (ASCII-escaped, so `\uXXXX` for non-ASCII), parsed by `parseSourceStatus`; missing/invalid header is tolerated. Errors: `400 "At least one keyword is required."`, `500 "Search failed: <exc>"`. Source/site behaviour is specified in `SOURCES.md`. |
| `POST /api/resume/parse` | `hooks/useResume.ts`, `JobTracker.tsx` | **multipart/form-data**: `file` (required) + optional form fields `llm_provider`, `llm_model`, `llm_base_url`, `llm_api_key`. Only `.pdf`/`.docx` accepted (extension check, `400 "Unsupported file type..."`; the tracker's file input also offers `.doc/.txt`, which this rejects). Max 10 MB (`400`). Text extraction failure or empty text -> `422`. Response `ResumeProfile`. **If the LLM step fails the endpoint still returns 200** with only `raw_text` (first 8000 chars) set; `JobTracker` reads only `raw_text`. Uses `LLMClient(...)` built directly (not `from_override`): `base_url` falls back to `OLLAMA_BASE_URL` only for provider `ollama`. Nothing is persisted. |
| `POST /api/jobs/assess` | `Search.tsx` | Body `AssessmentRequest {job: JobResult, resume_profile, include_company_research=true, + LLM override}`; response `JobAssessment` (fields in `openapi.json`; `resume_generation_triggered = match_score >= RESUME_GEN_THRESHOLD and is_relevant`). Company research = DuckDuckGo scrape (`web_search.py`), failures swallowed. Unparseable LLM output -> `500 "Assessment failed: ..."` (frontend then falls back to a score-0 placeholder). |
| `POST /api/jobs/assess-batch` | `Search.tsx` | Body `BatchAssessmentRequest {jobs[], resume_profile, include_company_research=false, + override}`; response `list[BatchAssessmentItem {job_id, assessment\|null, error\|null}]`. Always 200; per-job failures are in `error`. Jobs run concurrently via `asyncio.gather`; local providers serialize through the semaphore. |
| `POST /api/jobs/suggest-keywords` | `Search.tsx` | Body `{keywords[], + override}`; response `{"suggestions": [str]}` (max 10, input duplicates removed). Never errors: any failure returns `{"suggestions": []}`. |
| `POST /api/jobs/translate-keywords` | `Search.tsx` | Body `{keywords[], target_language="pt", + override}` (`pt/en/de/es/fr` mapped to language names, anything else passed through); response `{"translations": [str]}` (max 20). Never errors (`[]` on failure). |
| `POST /api/applications` | `Search.tsx` (save to tracker), `JobTracker.tsx` (add job) | See Applications below. |
| `GET /api/profile`, `POST /api/profile` | `Search.tsx` (auto-fill after resume parse) | See Profile below. |

### Settings modal

| Endpoint | Notes |
|---|---|
| `GET /api/ollama/models?provider=ollama\|lmstudio&base_url=` | Response `list[str]`. **Never fails**: any error returns `[]` with 200. Ollama: union of `/api/tags` (installed, `size > 0`) and `/api/ps` (running, catches `*-cloud` models); LM Studio: `/v1/models` ids. `base_url` default = `settings.ollama_base_url` (note: not the `ollama_base_url()` helper, so `OLLAMA_HOST` is ignored here, and LM Studio also defaults to the Ollama URL rather than `LMSTUDIO_BASE_URL`). 4 s timeout. |
| `GET /api/groq/models?api_key=` | `list[str]`; no key or any error -> hard-coded `_GROQ_FALLBACK_MODELS` (200). Otherwise sorted ids from Groq `/openai/v1/models` (6 s). |
| `POST /api/test-llm` | Body `{provider, base_url="", model="", api_key=""}`; response `{ok, message, resolved_url}` - always 200, failures are `ok=false` with a message. Local providers: tries a candidate URL list (given URL, `localhost`<->`127.0.0.1` swap, `host.docker.internal:<port>`, server `OLLAMA_BASE_URL`) and returns the first that answers as `resolved_url` (UI writes it back into the URL field). Cloud checks exist only for `openai`, `anthropic`, `groq` (key validity via `/v1/models`); every other provider returns `ok=false, "Unknown provider: X"`. |
| `GET /api/settings/llm-keys` | Response `{provider: key}` (decrypted; `{}` if none/undecryptable). Cached 60 s client-side. |
| `PUT /api/settings/llm-keys` | Body `{provider: key}` (root map). **204 No Content**. Merges into the stored blob; empty string deletes that provider. Stored Fernet-encrypted in `user_profiles.llm_keys_encrypted` on the first profile row ordered by `created_at` (created if absent) - not necessarily the `'singleton'` row used by `/api/profile`. The backend never reads these keys for LLM calls; the frontend fetches them and sends the active one per request. |

### Profile (`Profile.tsx`, `Search.tsx`)

- `GET /api/profile` -> `ProfileSchema` (all optional: `full_name, email, phone, linkedin_url, github_url, portfolio_url, location_city/state/country, work_authorization, willing_to_relocate, preferred_work_mode, years_experience, highest_degree, university, graduation_year, salary_min, salary_max, salary_currency, custom_answers, extra_info`). `404 "Profile not set up yet."` when the singleton row does not exist (frontend treats non-OK as "no profile").
- `POST /api/profile` body `ProfileSchema` (same fields, all optional). Upsert of row id `'singleton'`: only non-null fields are written (`exclude_none`), so despite the docstring it cannot clear a field and `{}` is a valid no-op (200). Wrong types -> 422.
- `PUT /api/profile`: not called by the frontend; partial update with `exclude_unset` (explicit `null` overwrites; password stored **unencrypted**).
- LinkedIn credentials are not part of the profile (the `UserProfile` table never had those columns; the dead `linkedin_email`/`linkedin_password` schema fields were removed 2026-10-11). Platform credentials live in the legacy `/api/settings/platforms` store (plaintext, unused by the frontend).

### Applications / tracker (`JobTracker.tsx`, `Search.tsx`) - table `applications`

- `GET /api/applications[?status=]` -> `{"applications": [ApplicationDict], "count": n}` ordered by `created_at` desc. The frontend accepts either that object or a bare array. `ApplicationDict` keys: `id, job_id, job_title, company_name, job_url, site, status, is_easy_apply, notes, analysis_id, assessment_data, match_score, job_description, applied_at, created_at, updated_at` (datetimes as `.isoformat()`, naive/no `Z`, `null` when unset).
- `POST /api/applications` body `{job_id?, job_title (required), company_name?, job_url?, site?, notes?, analysis_id?, status="saved", is_easy_apply=false, assessment_data? (object), match_score? (int), job_description?}` -> `{"message", "id", "already_existed"}`. Unknown `status` silently becomes `saved`. Dedup only triggers when `job_id` is sent (matching `job_id`+`job_url`) and returns `{"message": "Application already exists", "id", "already_existed": true}`; the frontend never sends `job_id`, so duplicates are possible. If `job_id` matches a `saved_jobs` row, missing title/company/url/site are filled from it (legacy table).
- `PUT /api/applications/{id}/status` body `{status, notes?}` -> full `ApplicationDict`. `400` for a status outside `saved, applying, applied, interviewing, offered, rejected`; `404` unknown id. `notes` only overwrites when truthy (cannot clear notes). Setting `applied` stamps `applied_at = utcnow()`. The tracker also uses this endpoint to save notes (re-sends the current status).
- `DELETE /api/applications/{id}` -> `{"message": "Application deleted"}` (`404` if missing). Does not delete the application's `interview_sessions`.
- Unused: `GET /api/applications/stats/summary`.

### Interview (`JobTracker.tsx`, table `interview_sessions`)

- `POST /api/interview/init` body `{job_title, company_name, job_description, resume_text, user_profile, application_id?, + override}` -> `InterviewInitResponse {session_id, session_context, persona_name, persona_bio, interview_track, messages[], completed}`. With `application_id` it first looks up an existing session (resume path: returns persisted context + messages + `completed`); otherwise it runs two DuckDuckGo lookups in parallel (company info, interview process), picks a persona name from a fixed list via Python's randomized `hash()` (nondeterministic across restarts - any stable choice is fine), detects the track by keywords (`behavioral|system_design|coding`), renders `interviewer_system` and, if `application_id` is set, inserts the session row. **Does not call the LLM.** No error handling: a DB error is a 500.
- `POST /api/interview/chat` body `{session_context, persona_name, messages[{role,content}], message, session_id?, + override}` -> `{"role": "assistant", "content": <speech>, "state": <estado_interno>}`. **Always 200**: on any exception it returns a canned apology as `content`. Uses only the last 18 history messages; `session_context` is the system prompt, the user prompt is the flattened transcript (`Candidate: ...` / `<persona>: ...`) or `interview_chat_start` when empty. Speech is extracted from `<fala_do_entrevistador>` with fallbacks (`_extract_speech`). With `session_id` it autosaves messages (+ `state`) to the DB row. The frontend ignores `state`.
- `GET /api/interview/by-application/{application_id}` -> session dict `{id, application_id, persona_name, persona_bio, session_context, interview_track, messages, state, completed, report, updated_at}`; `404` if none.
- `POST /api/interview/report` body `{session_id, + override}` -> `{"report": {...}, "cached": bool}`. `404` unknown session, `400 "Interview is too short..."` when fewer than 4 messages, `500` on LLM failure or unparseable JSON. Cached in `interview_sessions.report`; success sets `completed=true`. Report keys: see `backend/prompts/README.md` (`interview_report_system`); the frontend shows `score, strengths, improvements, technical_gaps?, study_tips, next_steps?`.
- Unused: `DELETE /api/interview/{session_id}`.

### Tailored résumé PDF (`JobTracker.tsx`)

- `POST /api/resume/generate-for-application` body `{application_id, resume_text, custom_instructions?, extra_context?, + override}` -> **binary `application/pdf`** (`FileResponse`; `Content-Disposition: attachment; filename="resume_<company>_<title>_<6hex>.pdf"`, header `X-Generated-Resume-Id`). The frontend reads `res.blob()` and names the download itself (`resume_<company>_<title>.pdf`). Errors (JSON `detail`): `404` application not found, `400` empty resume text or application has no `job_description`, `500 "Resume generation failed: ..."`. Pipeline (LLM -> HTML -> sanitize -> xhtml2pdf -> page count -> up to 3 compaction LLM passes -> font scales 1.0/0.92/0.84) is in `resume_generator.py`; the PDF is written under `RESUME_OUTPUT_DIR` and a `generated_resumes` row is inserted. Contact/preference context comes from `db.query(UserProfile).first()` (unordered; whichever row SQLite returns first), `extra_info` is merged with `extra_context`. Local providers hold the LLM semaphore for the whole generation.
- Port note: xhtml2pdf has no Rust equivalent; PDF rendering is the main non-trivial dependency (see `PLAN.md`).

## Present in the backend but NOT used by the frontend

Safe to drop in the port (or keep behind a feature flag), in rough order of confidence:

| Router / endpoint | Status | Notes |
|---|---|---|
| `POST /api/jobs/search` (legacy `routers/jobs.py`, body `{search_term, ...}`) | Dead code | Shadowed: `jobs_v2._jobs_router` is included first and Starlette dispatches to the first match. Only the v2 shape is reachable. |
| `routers/jobs.py`: `POST /api/jobs/save`, `GET /api/jobs/saved`, `GET/DELETE /api/jobs/saved/{id}` | Legacy | Table `saved_jobs`. |
| `routers/resume.py`: `POST /api/resume/upload`, `GET`/`DELETE /api/resume` | Legacy | Table `resumes`. |
| `routers/analysis.py`: `POST /api/analysis`, `POST /api/analysis/tailored-resume`, `GET /api/analysis/{id}`, `GET /api/analysis/job/{job_id}` | Legacy | Table `analyses`; uses `ai_evaluator.assess_job` (prompts `assessment_*`) and legacy tailored-resume helpers. |
| `routers/settings.py` except `llm-keys`: `/api/settings/ai-keys`, `/ollama-status`, `/platforms[/{platform}]`, `/profile` | Legacy | Key/value `settings` table; per-platform credentials. **Stores ai-keys and platform credentials in plaintext** — do not port; secrets go to the OS keychain (`keyring`). |
| `routers/brazilian_jobs.py`: `POST /api/jobs/brazil/search` | Unused | Source logic overlaps `job_scraper_v2` (`SOURCES.md`). |
| `routers/concursos.py`: `POST /api/concursos/search`, `GET /estados /areas /niveis /bancas` | Unused | Public-tender scraper. |
| `GET /api/models/discover` | Unused | Frontend type `DiscoverResponse` exists in `types/index.ts` but nothing calls it (`SettingsModal` uses `/api/ollama/models`). |
| `POST /api/resume/generate`, `GET /api/resume/generated`, `GET /api/resume/generated/{id}/download` | Primary router, unused | Only `generate-for-application` is called. `generate` is the profile+job variant; list/download expose the `generated_resumes` table. |
| `GET /api/health/llm` | Diagnostic | Not called by the UI; useful for ops (5 s connectivity + 120 s completion using prompts `health_check_*`). |
| `GET /api/applications/stats/summary`, `DELETE /api/interview/{session_id}`, `PUT /api/profile` | Unused | Cheap to keep. |
| `GET /` | Unused | `{"message": "JumpShip API 1.0 - visit /docs"}`. |

Minimum surface for a UI-compatible port (23 operations): `GET /api/health`; `POST /api/jobs/search`; `POST /api/jobs/assess`; `POST /api/jobs/assess-batch`; `POST /api/jobs/suggest-keywords`; `POST /api/jobs/translate-keywords`; `POST /api/resume/parse`; `POST /api/resume/generate-for-application`; `GET|POST /api/profile`; `GET|POST /api/applications`, `PUT /api/applications/{id}/status`, `DELETE /api/applications/{id}`; `POST /api/interview/init|chat|report`, `GET /api/interview/by-application/{id}`; `GET /api/ollama/models`, `GET /api/groq/models`, `POST /api/test-llm`; `GET|PUT /api/settings/llm-keys`.

Tables needed by that surface: `applications`, `interview_sessions`, `user_profiles`, `generated_resumes` (see `schema.sql`).

## Other things to preserve or consciously change

- Startup side effects: `init_db()` creates tables, `_migrate_db()` applies idempotent ALTERs (`schema.sql` footer); `SECRET_KEY` default raises unless `DEBUG=true`. Fernet key = PBKDF2-HMAC-SHA256(SECRET_KEY, salt `jumpship-salt-2026`, 100000 iterations) base64url; existing encrypted values (`llm_keys_encrypted`, settings `cred_*`) are only readable by an implementation that reproduces this exactly.
- `.env` is read from the repo root (`load_dotenv` + pydantic-settings); env var names are in `CLAUDE.md`.
- Generated PDFs are named `resume_<company 30 chars>_<title 30 chars>_<uuid6>.pdf` (non-word chars -> `_`).
