# Plan: JumpShip → native Rust desktop app

> **Status:** ACTIVE — phases 1–2 done, phase 3 built (fresh-VM install check pending) (Glassdoor live transport and the career-page scraper pending) · code: [`/crates`](../../crates) · Decision: `DEC-20261011-02`
> Supersedes [`../desktop-app-plan.md`](../desktop-app-plan.md) (Tauri + PyInstaller wrapper).

**Last updated:** 2026-10-13
**Run it:** `cargo run -p jumpship-server` (127.0.0.1:8000, the Vite proxy target; reads the same `.env` and `jobspy_ui.db`)
**Toolchain on dev box:** rustc/cargo 1.96 ✅

---

## 1. Target architecture

```
┌──────────────────── Tauri v2 shell (src-tauri) ────────────────────┐
│  WebView2 → existing React app (frontend/, unchanged in phase 1-3) │
│                     │ fetch('/api/...')                            │
│  jumpship-server (axum, 127.0.0.1:<random>) — same HTTP API        │
│     ├─ jumpship-core     models, location resolver, text_match,    │
│     │                    filters, dedup, salary normalization      │
│     ├─ jumpship-sources  SourceAdapter trait + one module/board    │
│     ├─ jumpship-llm      provider adapters, semaphore, JSON parse  │
│     ├─ jumpship-store    SQLite (existing jobspy_ui.db schema)     │
│     └─ jumpship-resume   PDF/DOCX parsing, tailored PDF output     │
└────────────────────────────────────────────────────────────────────┘
```

**Why this shape**
- The React UI is ~10k LOC (Search 1k, JobTracker 1.3k, styles 4.5k). Rewriting it in egui/Slint/iced
  buys nothing for this app and costs months. Tauri v2 reuses it as-is.
- Keeping the **same HTTP API** (axum on localhost) means the frontend needs zero changes in the first
  phases, and the Python and Rust backends can be run side-by-side against the same requests for parity.
  Moving hot paths to Tauri commands/events is an optional later step (phase 5).
- A desktop app runs from the user's residential IP, which anti-bot systems block far less than servers.

## 2. Crate choices

| Concern | Python today | Rust | Notes |
|---|---|---|---|
| HTTP API | FastAPI | `axum` + `tower-http` (CORS) | Contract: [`openapi.json`](./openapi.json), [`API.md`](./API.md) |
| HTTP client | httpx / requests | `reqwest` (rustls) | |
| TLS impersonation (Glassdoor, Eightfold) | `curl_cffi` (JobSpy 1.3) | `wreq` (ex-`rquest`) | Only for boards that fingerprint TLS; verify crate status at port time |
| HTML parsing | BeautifulSoup | `scraper` | |
| JSON | pydantic | `serde` / `serde_json` | |
| SQLite | SQLAlchemy | `sqlx` (sqlite, migrations) | Must open existing DB — [`schema.sql`](./schema.sql) |
| Headless browser | Playwright (bundled Chromium, ~300 MB) | `chromiumoxide` (CDP) driving the installed Edge/Chrome | No browser download on Windows: Edge is always present |
| LLM | `openai`, `anthropic`, `google-generativeai` SDKs | plain `reqwest` adapters | One OpenAI-compatible adapter covers most providers — [`LLM.md`](./LLM.md) |
| Ollama | OpenAI-compat endpoint | **native `/api/chat`** | Gains `format` (JSON schema), `think:false`, `options.num_ctx` (prompt truncation risk today) |
| PDF text extraction | pdfminer.six | `pdf-extract` / `lopdf` | Compare output on the same résumé PDFs |
| DOCX | python-docx | `docx-rs` or zip + `quick-xml` | |
| Tailored résumé PDF | LLM HTML → xhtml2pdf | LLM HTML → CDP `Page.printToPDF` (chromiumoxide) | Same HTML templates; better CSS support than xhtml2pdf |
| Web search (company research) | DDG instant + lite HTML | `reqwest` + `scraper` | |
| API-key storage | Fernet in SQLite (static salt) | OS keychain via `keyring` | Security upgrade; migrate existing encrypted keys once |
| Async runtime | asyncio | `tokio` | |

## 3. Shared artifacts (single source of truth for both implementations)

| Artifact | Path | Used for |
|---|---|---|
| Source registry | `backend/data/brazil-career-sources.json` | ATS boards per company |
| Location / keyword tables | `backend/data/locations.json`, `backend/data/keywords_pt.json` | Location resolver, PT-BR expansion |
| LLM prompts | `backend/prompts/*.md` (+ README with placeholders & JSON keys) | Assessment, résumé, interview |
| Golden source fixtures | `tests/fixtures/sources/cases.json` + raw/expected files | Parser parity tests (`cargo test` reads the same manifest) |
| Source specs | [`SOURCES.md`](./SOURCES.md) | Endpoints, params, quirks, anti-bot notes |
| HTTP contract | [`openapi.json`](./openapi.json), [`API.md`](./API.md) | axum handlers |
| DB schema | [`schema.sql`](./schema.sql) | sqlx migrations, in-place reuse of user DB |
| LLM layer spec | [`LLM.md`](./LLM.md) | Provider adapters |

Rule while both backends exist: change these artifacts, not code-embedded copies.

## 4. Phases & exit criteria

| # | Phase | Exit criteria |
|---|---|---|
| 0 | **Prep** (done 2026-10-11) | Sources fixed & live-verified; parsers pure; golden fixtures; prompts/data extracted; specs written |
| 1 | ✅ **Core + sources** (done 2026-10-12: 29/29 golden + 3/3 JobSpy replays; live results identical to Python for 10 sources; Glassdoor needs a Chrome-TLS client + cookie jar, see §7) — workspace, `jumpship-core`, `jumpship-sources` (Gupy, Trampos, Greenhouse, Lever, Workday, RemoteOK, Arbeitnow, Programathor first; then Indeed GraphQL, LinkedIn guest, Glassdoor) | All `cases.json` golden tests pass in `cargo test`; live smoke matches Python counts ±noise |
| 2 | ✅ **Server parity** (done 2026-10-13: all 23 UI operations; React ran unchanged against it; see §8) — axum with the endpoints marked *used* in API.md; store; LLM | React app works against axum with no frontend changes; side-by-side request diff on search/assess/resume parse |
| 3 | 🟡 **Desktop** (built 2026-10-13: `crates/desktop`, NSIS installer 6.8 MB; see §9) — Tauri v2 shell spawns server on random port, injects base URL; installer (MSI/NSIS) | Clean install on a fresh Windows VM; no Python on the machine |
| 4 | 🟡 **New capabilities** (deferred from Python, see §5; in progress, see §10) | Each behind its own acceptance test |
| 5 | Optional: Tauri commands/events for search streaming, drop localhost server | — |

Port order inside phase 1 follows value × simplicity: JSON APIs first, HTML second, JobSpy-equivalents (internal APIs, TLS impersonation) last.

## 5. Designed now, built in Rust (deferred from Python)

- **Job store**: `jobs` table keyed by canonical URL (strip tracking params), `first_seen`, `last_seen`,
  `sources[]`, `hidden`, `seen_at`. Enables "new since last search", hide seen/applied, cross-search dedup.
- **Assessment cache**: key `(job_id, resume_hash, provider, model, prompt_version)` → never re-assess the same pair.
- **Streaming search**: each source reports `{site, jobs, status}` as it finishes (SSE in axum → Tauri events).
  The slowest source (headless browser: minutes) no longer gates results.
- **Salary normalization**: parse amount + currency + period → annual; sort/filter on normalized value
  (today sort mixes BRL/month with USD/year). Show original text.
- **Ranking before truncation**: cheap local relevance (keyword hits title > description) before the LLM;
  LLM only on top N. Cap per source after ranking, not by registry order.
- **New sources** (endpoints verified live 2026-10-11): Ashby (`api.ashbyhq.com/posting-api/job-board/<org>`),
  SmartRecruiters (`api.smartrecruiters.com/v1/companies/<co>/postings`), Inhire (`X-Tenant` header),
  Amazon (`amazon.jobs/en/search.json`), Remotive, Himalayas, Jobicy, WeWorkRemotely RSS.
- **Headless-browser scraper rewrite**: capture XHR JSON responses (`Network.responseReceived`) and/or
  `application/ld+json` `JobPosting` instead of DOM link heuristics (today 12/30 sources return 0);
  auto-detect the underlying ATS and route to its JSON adapter.
- **Per-host politeness**: token-bucket per host + exponential backoff + one retry (Gupy resets bursts).
- **Ollama native API** with `num_ctx` sized to the prompt and JSON-schema `format`.

## 6. Open decisions (owner: user)

1. **UI**: Tauri v2 + existing React (recommended) vs fully native UI (egui/Slint/iced — full UI rewrite).
2. **Keep web/Docker mode?** If yes, `jumpship-server` also ships as a standalone binary (cheap: it already is one).
3. **Platforms**: Windows first; macOS/Linux need code signing / notarization decisions.
4. **Tailored PDF engine**: CDP printToPDF (recommended, keeps HTML templates) vs Typst templates (no browser dependency, template rewrite).

## 7. Risks

- LinkedIn guest API, Indeed GraphQL and Glassdoor GraphQL are undocumented and change; JobSpy absorbs
  that today. Mitigation: fixtures + `request.json` per board, canary health check, keep adapters thin.
- TLS-impersonation crates are niche; if `wreq` stalls, Glassdoor can fall back to the CDP browser. Status 2026-10-12:
  `wreq` is 6.0.0-rc and builds BoringSSL (needs cmake + NASM/clang); plain reqwest gets Cloudflare 403. Request
  building and parsing are ported and replay-tested (`crates/sources/src/jobspy/glassdoor.rs`); only the transport is open.
- Job descriptions must stay byte-identical to JobSpy's (BeautifulSoup `html.parser` + `prettify` + markdownify):
  `crates/sources/src/soup.rs` ports all three. Tables / `<dl>` aren't ported yet (absent from descriptions so far).
- Scraping must respect each site's ToS/robots (see `ingestion_notes` in the source registry).

## 8. Phase 2 notes (as built)

- **Layout**: `crates/server` holds config, LLM client, SQLite store, résumé parse/PDF as modules (one consumer today;
  split into `jumpship-llm` / `-store` / `-resume` crates when the Tauri shell needs them directly). Search
  orchestration (`search_jobs`) lives in `crates/sources/src/search.rs`.
- **Parity evidence**: live search 46/46 jobs identical to Python (ids, order, every field); the `test_prompts.py`
  hashes reproduced for assess, keywords, interview, report, tailored résumé, compaction and résumé parse; on copies of
  the real DB, 4 reads + 15 write steps give the same status and body as FastAPI; Fernet tokens readable both ways;
  pdf-extract vs pdfminer: same word and line counts (unmapped glyphs: `(cid:N)` vs U+FFFD).
- **PDF engine** (§6.4, recommended option): the installed Edge / Chrome / Chromium in `--headless --print-to-pdf`
  mode with a throwaway profile (`JUMPSHIP_BROWSER` overrides discovery). No CDP crate; same HTML/CSS template,
  `lopdf` page count, same compaction / font-scale loop. Docker mode would need a Chromium in the image.
- **Deliberate behaviour changes**: `llm_base_url` only for ollama/lmstudio (also fixed in Python: the UI sends its
  Ollama URL with every request); the local-LLM semaphore guards every call (Python: only some routes); Gemini via
  REST with default `gemini-2.5-flash`; Hugging Face via `router.huggingface.co`; lax-typed LLM JSON (null fields →
  defaults) instead of a 500.
- **Not ported yet**: `playwright` career-page scraper (reports an error in `X-Source-Status`; phase 4 CDP/XHR
  rewrite); board errors after partial results are only logged; legacy / unused routers (API.md list).

## 9. Phase 3 notes (as built)

- **Shape**: `crates/desktop` runs the axum app **in-process** on `127.0.0.1:<random>` and opens the Tauri window on
  that URL. The server's fallback serves the React build from Tauri's embedded assets (`frontendDist`), so page and
  `/api` share one origin: no base-URL shim, no CORS, frontend unchanged. `GET /` (Python's API banner) was dropped.
- **Build**: `cd crates/desktop && cargo tauri build` (runs `npm run build` first) →
  `target/release/bundle/nsis/JumpShip_0.1.0_x64-setup.exe` (6.8 MB; app 23 MB). WebView2 bootstrapper is
  downloaded by the installer when missing. The crate is outside `default-members`, so plain `cargo test/clippy` and
  CI don't need WebView system libraries.
- **Data**: `%APPDATA%\com.jumpship.desktop\` holds `jobspy_ui.db`, `generated_resumes\`, `jumpship.log`.
  `DATABASE_URL`, `RESUME_OUTPUT_DIR`, `SECRET_KEY` and the LLM env vars still override (e.g. to open the old
  Python database with its `SECRET_KEY`).
- **Secrets**: a random Fernet secret per install in the OS keychain (Windows Credential Manager entry
  `secret-key.JumpShip`; macOS Keychain; Secret Service on Linux, file fallback beside the DB when none).
- **Links**: navigation away from the app and `target=_blank` open in the system browser.
- **Not verified yet**: install on a clean Windows VM; résumé PDF download from inside WebView2; code signing.

## 10. Phase 4 progress

| §5 item | Status | Acceptance test |
|---|---|---|
| Assessment cache | ✅ `assessment_cache` table (Rust-only, ignored by Python); key = sha256 of provider, model, research flag, prompt templates, job, résumé. Company research text not in the key | `jobs::tests::assessment_cache_skips_llm` (stub LLM hit once; other model re-asks) |
| New sources: Remotive, Himalayas, Jobicy | ✅ `crates/sources/src/remote.rs`; site pills in Search. Remotive full feed cached 6 h (its terms: ≤ 4 calls/day); Himalayas / Jobicy one call per keyword (≤ 3) | `remote::tests::*`; live 2026-10-13: 37 jobs, no errors |
| Salary normalization | ✅ `crates/sources/src/salary.rs` → `salary_annual_usd` on search results (fixed FX table); Search sorts on it, original text shown | `salary::tests::normalizes` |
| Job store | ✅ `crates/server/src/store.rs`: `job_store` (canonical URL → first / last seen, dismissed). Results carry `is_new`; dismissed jobs left out (`X-Dismissed-Count`); `POST /api/jobs/dismiss`, `DELETE /api/jobs/dismissed`. UI: "New" tag, Dismiss, "N dismissed · restore". `sources[]` and cross-search dedup not built | `store::tests::new_and_dismissed`; API run: 15 new → 0 new → dismiss 1 → 14 → restore → 15 |
| Re-assess vs cache | ✅ `refresh: true` on `/api/jobs/assess` skips the cached answer | `assessment_cache_skips_llm` |
| Streaming search | ✅ `POST /api/jobs/search/stream` (NDJSON `{site, jobs, status}` per site, then `{done, dismissed}`; HTTP stream, not Tauri events, so dev/web mode keep working). `search` and `search_stream` share plan + `Merger`; the plain endpoint still merges in request order. UI: boards stream in (no résumé), "N/M boards" pill, auto-assessment queued per batch; falls back to `/api/jobs/search` on the Python backend | vitest `searchJobsStream` ×2; live: 25/27 jobs in 2.8 s vs 19.8 s for LinkedIn, stream id set = plain id set, plain = Python (27/27, same order); headless UI run: first assessment request at 1.1 s while LinkedIn held the search to 28 s |
| Per-host politeness | ✅ `crates/sources/src/polite.rs`, every source request: per-host start spacing (1 s LinkedIn / Gupy, 150 ms others), one retry on 429 / 502–504 / dropped connection (Retry-After ≤ 20 s, else 2 s), 429 doubles the host gap (≤ 8 s), success takes 10% off. Not a token bucket with bursts: spacing only. Cost: LinkedIn with 20 descriptions ≈ 1 min | `polite::tests::*` (local 429 server; pacing); live 2 LinkedIn searches back to back: 10 throttled answers, 7 recovered by the retry, LinkedIn returned results both times (before: whole LinkedIn batch failed on 429) |
| LinkedIn: filter before fetching job pages | ❌ dropped after live probes (2026-10-13): the guest search API ignores `f_WT=2` (identical ids with / without, for "Remote" and "Brazil"), and a "Remote" search has no country to pre-filter on; country searches already return only that country. Remote-ness comes from the description, so a "Remote" LinkedIn search must fetch every job page (≈ 1 req/s with politeness). Real fix needs the logged-in API or the CDP browser | — |
| Ollama native API | ✅ `llm.rs` `Adapter::Ollama`: `POST <base>/api/chat` (`/v1` stripped), `num_ctx` = prompt chars / 3 + 2k rounded up to 8k / 16k / 32k (few sizes: Ollama reloads the model when `num_ctx` changes), `OLLAMA_NUM_CTX` pins it; optional JSON-schema `format` (no caller passes one yet). LM Studio unchanged. Not run against a real local model (only `-cloud` models installed here) | `llm::tests::ollama_context_buckets`, `ollama_native_chat` (stub) |
| New sources: Amazon, Ashby, SmartRecruiters | ✅ `crates/sources/src/companies.rs`; toggles in the company-boards group. Amazon: `search.json` per keyword (≤ 3), country filter server-side (`normalized_country_code[]`, ISO3). Ashby: no cross-company search, so 8 hand-picked remote-friendly boards (OpenAI, Notion, Linear, Supabase, Ramp, Cohere, Perplexity, Harvey), parsed board cached 1 h (OpenAI's is 14 MB), keyword + location filter before the cap; `workplaceType` decides work mode (OpenAI flags 481 hybrid jobs `isRemote: true`). SmartRecruiters: 13 hand-picked companies (Bosch, Experian, Accor, Eurofins, …; several with many BR jobs), `q` + ISO2 `country` server-side, one detail call per kept posting for the description. Company lists live in code, not the registry | `companies::tests::*`; live 2026-10-13: "software engineer" / Brasil → 25 jobs (18 SR, 5 Ashby, 2 Amazon), "python" / Remote → 15, no errors |
| Inhire | ⏸ deferred: API needs a tenant per company (`X-Tenant`) and there is no tenant list to start from | — |
| Ranking before truncation | ✅ `jumpship_core::relevance` / `rank`: per keyword (EN + PT), 10 for the phrase in the title, else 2 per word of it in the title, +2 for the phrase in the description. Greenhouse / Lever / Workday / Ashby rank before their cap (was registry order); SmartRecruiters ranks on titles before the detail calls. Results carry `relevance`; UI: unscored jobs sort by it under "match", and the LLM queue starts with the most relevant. No hard "LLM only on top N" cap: results_wanted already bounds it, and the queue order gets the top N scored first. Sources that stop at n while paging (Gupy, RemoteOK, LinkedIn…) keep the board's own order | `core::tests::ranking`; live "software engineer" / Brasil: SmartRecruiters' "Jovem Aprendiz" gone, top = "Analista de Desenvolvimento de Software" |
| CDP career pages | ⏳ | — |
