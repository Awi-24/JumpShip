# LLM layer spec (for the Rust port)

Source of truth: `backend/services/llm_client.py` (all generation calls), `backend/services/llm_service.py` (health probe only), `backend/routers/jobs_v2.py` (model discovery, `test-llm`), `backend/routers/models.py`, `backend/prompts/` (prompt text, see its README).

Items marked **verify before porting** are defaults or behaviours that look outdated or accidental. They are documented, not changed.

## 1. Call surface

`LLMClient(provider, model, api_key, base_url, max_tokens=8192)` is a synchronous client (callers wrap it in `asyncio.to_thread`).

- `complete(system, user, json_schema=None) -> str`: resolve model/key/base URL, apply thinking suppression to `system`, dispatch to the provider adapter. Returns the raw text (trimmed by most adapters).
- `complete_json(system, user, schema=None) -> dict`: `complete(..., json_schema=schema)` then `clean_and_parse_json`; on `ValueError` one repair call (section 6).
- Unknown provider -> `ValueError("Unknown provider 'X'. Valid: ...")`. Valid = keys of `_PROVIDERS` (11, below). `openclaw` is accepted by `LOCAL_PROVIDERS`, `/api/test-llm` and the model-discovery text but is **not** in `_PROVIDERS`, so any generation call with it fails (**verify before porting**: drop it or implement it).
- There are no streaming calls and no tool-calling except Anthropic's forced `structured_output` tool (section 3). No retries other than the JSON repair call.

## 2. Providers

All adapters send one system message (omitted when empty) and one user message, `max_tokens = 8192`, no temperature/top_p. "OpenAI-compat" = the `openai` SDK `chat.completions.create` against `<base>chat/completions` with `Authorization: Bearer <key>`.

| Provider | Transport | Default base URL | Default model | API key (override -> env) | JSON mode when `json_schema` is set |
|---|---|---|---|---|---|
| `anthropic` | `anthropic` SDK, `POST <base>/v1/messages`, headers `x-api-key`, `anthropic-version` (SDK-managed) | SDK default (`https://api.anthropic.com`); `base_url` override honoured | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` | Forced tool call: `tools=[{name:"structured_output", description:"Return structured data.", input_schema:<schema>}]`, `tool_choice={"type":"tool","name":"structured_output"}`; returns `json.dumps(block.input)` from the `tool_use` block, else first text block, else `ValueError("Anthropic returned no usable content block.")`. Without schema: `msg.content[0].text.strip()`. |
| `openai` | OpenAI-compat | SDK default (`https://api.openai.com/v1`) | `gpt-4o-mini` | `OPENAI_API_KEY` | `response_format={"type":"json_object"}` (the schema itself is **not** sent) |
| `deepseek` | OpenAI-compat | `https://api.deepseek.com` | `deepseek-chat` | `DEEPSEEK_API_KEY` | `json_object` |
| `groq` | OpenAI-compat | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | `json_object` |
| `huggingface` | OpenAI-compat | `https://api-inference.huggingface.co/v1/` | `Qwen/Qwen2.5-72B-Instruct` | `HUGGINGFACE_API_KEY` | `json_object` |
| `mistral` | OpenAI-compat | `https://api.mistral.ai/v1/` | `mistral-small-latest` | `MISTRAL_API_KEY` | `json_object` |
| `openrouter` | OpenAI-compat | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.2-3b-instruct:free` | `OPENROUTER_API_KEY` | `json_object` |
| `ollama` | OpenAI-compat | `<ollama_base_url()>/v1/` (section 4) | `llama3.2` | literal `"local"` unless an override key is given | `json_object` |
| `lmstudio` | OpenAI-compat | `<LMSTUDIO_BASE_URL or http://localhost:1234>/v1/` | `local-model` | literal `"local"` | `json_object` |
| `gemini` | `google.generativeai` SDK (not HTTP-compat): `GenerativeModel(model_name, system_instruction, generation_config)`, `generate_content(user)`, returns `resp.text.strip()`. `base_url` ignored. REST equivalent: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `x-goog-api-key`, body `system_instruction`, `contents`, `generationConfig {maxOutputTokens, responseMimeType}` | n/a | `gemini-1.5-flash` | `GOOGLE_API_KEY` (not `GEMINI_API_KEY`) | `generation_config.response_mime_type="application/json"` |
| `cohere` | `httpx.post(<base or https://api.cohere.com>/v2/chat)`, `Authorization: Bearer`, 60 s timeout, `raise_for_status` | `https://api.cohere.com` | `command-r` | `COHERE_API_KEY` | `response_format={"type":"json_object"}`; reply read from `message.content[0].text`, fallback `data["text"]` |

API key resolution (`_resolve_api_key`): override key (if non-empty) -> `"local"` for ollama/lmstudio -> `os.getenv(<env var above>)` -> `""`. `Settings.openai_api_key`, `anthropic_api_key`, `groq_api_key` in `config.py` are **not** read by `LLMClient` (only the process environment is; `main.py` loads the repo-root `.env` into it). The server never reads the keys stored by `PUT /api/settings/llm-keys`; the frontend fetches them and sends the active key as `llm_api_key` per request.

Model resolution: `model or default_model_of_provider`.

Empty-content handling (OpenAI-compat adapter only): if `message.content` is empty and `message.reasoning_content` is non-empty, regex `(\{[\s\S]*\})\s*$` over the reasoning text; the first match (greedy: first `{` to a final `}` at end of string) is returned as the answer. Otherwise the empty string is returned (no error).

Where JSON mode is actually used: only `ai_evaluator.assess_job` calls `complete_json(..., schema=ASSESSMENT_SCHEMA)`, which is reached solely from legacy `analysis` routes. The live assessment path (`/api/jobs/assess*`), interview report, résumé parse, keyword suggest/translate and résumé generation all call plain `complete()` with no provider JSON mode and parse the text themselves (see `backend/prompts/README.md` for each parser). A port that wants uniform JSON mode would be a behaviour change.

### Verify before porting

- `gemini`: default `gemini-1.5-flash` is retired, and `google-generativeai` is a deprecated SDK (replaced by `google-genai`). Use the REST shape above or the current SDK semantics, and pick a current default model.
- `groq`: `_GROQ_FALLBACK_MODELS` in `jobs_v2.py` (`llama-3.1-70b-versatile`, `llama-3.2-90b-vision-preview`, `llama-3.2-11b-vision-preview`, `llama3-70b-8192`, `llama3-8b-8192`, `mixtral-8x7b-32768`, `gemma2-9b-it`, ...) include models Groq has decommissioned. Only `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` are likely still served; the live `/openai/v1/models` list is authoritative when a key is present.
- `huggingface`: `api-inference.huggingface.co/v1/` is the legacy serverless endpoint; HF now routes through `https://router.huggingface.co/v1`.
- `openrouter`: `meta-llama/llama-3.2-3b-instruct:free` free-tier ids come and go.
- `openai`: adapter sends `max_tokens`; newer OpenAI reasoning models require `max_completion_tokens` and reject `max_tokens`. `json_object` mode also requires the word "JSON" in the prompt (all current JSON prompts satisfy this).
- `cohere`: `command-r` is an old alias; check current model ids.
- `anthropic`: `claude-sonnet-4-6` default is the project's choice; confirm it still exists. The forced-tool call needs `input_schema` to be a JSON-schema object (`ASSESSMENT_SCHEMA` is).
- `from_settings()` fills `model` with `settings.llm_model` (default `gemma3:27b`) even when a request overrides only `llm_provider` (e.g. `openai` without `llm_model` sends `gemma3:27b` to OpenAI). The frontend always sends `llm_model`, which hides this.
- `openclaw` as above.

## 3. Per-request overrides (`LLMOverride`)

`backend/models/schemas.py::LLMOverride` = `llm_provider`, `llm_model`, `llm_api_key`, `llm_base_url` (all `str | None`). Request models that inherit it or declare the same four fields: `JobSearchRequest` (accepted, unused), `AssessmentRequest`, `BatchAssessmentRequest`, `SynonymRequest`, `TranslateRequest`, `InterviewInitRequest`, `InterviewChatRequest`, `InterviewReportRequest`, `GenerateResumeRequest`, `GenerateForApplicationRequest`. `POST /api/resume/parse` takes the same four as multipart form fields.

`LLMClient.from_override(req)`: base = `from_settings()` (`provider=settings.llm_provider` default `ollama`, `model=settings.llm_model` default `gemma3:27b`, no key, no base URL); each field is `override_value or base_value` (so empty strings fall back); `max_tokens` stays 8192.

Exception: `resume_v2.parse_resume_endpoint` builds `LLMClient(...)` directly: `provider = form or settings`, `model = form or settings`, `api_key = form or ""`, `base_url = form or (settings.ollama_base_url if provider == "ollama" else None)`.

Frontend source of these fields (`getLlmFields` in `Search.tsx` / `JobTracker.tsx`): `llm_provider` = settings provider; `llm_model` = per-feature model (evaluator / interview / résumé generation) or the global model; `llm_api_key` = the key for that provider (from `/api/settings/llm-keys`, held in memory only); `llm_base_url` = the "Ollama URL" setting, sent **for every provider**. Because `_resolve_base_url` honours `base_url` for all providers, a cloud provider with a non-empty Ollama URL setting would be called at that URL (**verify before porting**: restrict `base_url` to providers that use it, or keep the quirk knowingly).

## 4. Base URL resolution

`LLMClient._resolve_base_url()`:

1. If `self.base_url` is set: strip trailing `/`; for `ollama` and `lmstudio` append `/v1` unless it already ends with `/v1`; return with a trailing `/`. (Applies to every provider; Anthropic/Cohere/Gemini adapters receive it without any `/v1` handling.)
2. Else `ollama` -> `f"{ollama_base_url()}/v1/"`.
3. Else `lmstudio` -> `(LMSTUDIO_BASE_URL or "http://localhost:1234").strip()` without trailing `/`, plus `/v1/`.
4. Else the provider's default base URL from the table (may be `None` -> SDK default).

`ollama_base_url()`: `host = os.getenv("OLLAMA_HOST", "").strip()`; if `"ollama_base_url" not in settings.model_fields_set` (i.e. `OLLAMA_BASE_URL` was set neither in the environment nor in `.env`) **and** `host` matches `^https?://`, return `host.rstrip("/")`; otherwise `settings.ollama_base_url.rstrip("/")` (default `http://localhost:11434`). `OLLAMA_HOST` without a scheme (e.g. `0.0.0.0:11434`, the server-side bind form) is ignored. Used by `LLMClient`, `LLMService` (health), and `settings.py::_check_ollama_health`. The discovery/test endpoints use `settings.ollama_base_url` directly (section 7), not this helper.

## 5. Local concurrency semaphore

- `LOCAL_PROVIDERS = {ollama, lmstudio, openclaw}`; `is_local_provider(p)`.
- `get_local_sem()` lazily creates one process-wide `asyncio.Semaphore(slots)`; `slots = max(1, int(os.getenv("LLM_MAX_CONCURRENT", "1")))`, non-integer -> 1. Read once at first use. `Settings.llm_max_concurrent` exists but is **not** consulted (env var only).
- `needs_semaphore(provider, model)`: false if not local; false if the resolved model name ends with `-cloud` (Ollama cloud-relay models: inference is remote); else true.
- Where it is applied (semaphore held for the whole thread-offloaded blocking call):
  - `_run_assessment` (`/api/jobs/assess`, `/assess-batch`): `needs_semaphore(provider, resolved_model)`, so `-cloud` models bypass it.
  - `interview_chat`, `interview_report`, `generate_resume`, `generate_resume_for_application`: `is_local_provider(provider)` only, so **`-cloud` models do not bypass it there** (inconsistent; probably unintended).
  - Not guarded at all: `suggest-keywords`, `translate-keywords`, `resume/parse`, `health/llm`.
- Effect for batch assessment: every job's coroutine is created at once (`gather`); local providers queue on the semaphore, cloud providers run fully parallel with no cap or rate limiting.

## 6. Thinking models and JSON repair

Thinking suppression (`_suppress_thinking`): if the **resolved model** name matches `(?i)qwen3|qwq|deepseek-r\d|deepseek-reasoner|qwen-3` and the system prompt does not already start with `/no_think`, the system prompt becomes `"/no_think\n" + system`. It is applied for every provider (including cloud DeepSeek where the directive is just text). `<think>...</think>` blocks in returned content are **not** stripped anywhere; only the `reasoning_content` rescue above exists.

`clean_and_parse_json(raw) -> dict`:
1. `_strip_fences`: `strip()`; remove a leading ```` ```[a-zA-Z]*\n? ````; remove a trailing ```` \n?``` ````; `strip()`.
2. `json.loads`.
3. On failure, slice from the first `{` to the last `}` (if `end > start`) and `json.loads` again.
4. Else `ValueError("LLM returned non-parseable JSON.\nPreview: " + raw[:500] with newlines escaped as \n)`.
JSON arrays parse only at step 2 (the slice is object-only). The return value is whatever `json.loads` gives (not checked to be a dict). Callers `suggest/translate-keywords` use `json.loads(_strip_fences(raw))` directly and `interview_report` uses its own fence strip plus regex `\{.*\}` (DOTALL).

`complete_json` repair: on `ValueError` from step 4, one more `complete()` with system `json_repair_system`, user `json_repair_user` (`raw[:2000]` of the original reply), `json_schema=None`, then `clean_and_parse_json` again (second failure propagates). The live assessment path uses `clean_and_parse_json` **without** the repair retry. A failed parse is an error (HTTP 500 for `/assess`, per-item `error` for `/assess-batch`); there is no fabricated fallback score.

## 7. Model discovery and connectivity endpoints

Used by the frontend (`SettingsModal.tsx`):

- `GET /api/ollama/models?provider=ollama|lmstudio&base_url=` (4 s timeout, never errors, `[]` on any failure). URL = `base_url or settings.ollama_base_url`, trailing `/` stripped (note: not `ollama_base_url()`, and LM Studio uses the same default rather than `LMSTUDIO_BASE_URL`).
  - lmstudio: strip a trailing `/v1`, `GET <url>/v1/models`, return `data[].id`.
  - ollama: `GET <url>/api/tags` keeping models with `size > 0` (newer Ollama lists un-downloaded catalog entries with size 0), then `GET <url>/api/ps` appending running models not already seen (catches cloud models such as `gemma4:31b-cloud`). Each sub-request failure is logged and skipped. Order: installed first, then running-only.
- `GET /api/groq/models?api_key=`: empty key -> `_GROQ_FALLBACK_MODELS`; else `GET https://api.groq.com/openai/v1/models` (Bearer, 6 s) returning sorted `data[].id`; any error -> fallback list.
- `POST /api/test-llm {provider, base_url, model, api_key}` -> `{ok, message, resolved_url}`, always HTTP 200.
  - `ollama | lmstudio | openclaw`: candidates, in order and de-duplicated: `base_url or settings.ollama_base_url` (trailing `/` stripped); if it contains `localhost`, the same with `127.0.0.1`; if it contains `127.0.0.1`, the same with `localhost`; `http://host.docker.internal:<port>` (port = text after the last `:`, default 11434) unless already present or the URL already uses that host; finally `settings.ollama_base_url`. For each (4 s timeout): lmstudio -> `GET <url minus /v1>/v1/models`; others -> `GET <url>/api/tags`. First HTTP 200 wins: message `Connected to LM Studio (N model(s) loaded)` / `Connected to <provider> (N model(s) installed)` (or `no model(s) ...`), `resolved_url` = the candidate. All failed: `Could not reach <provider> at [<candidates, joined>]: <last error>` plus a hint when the last error is `Connection refused` (Linux `OLLAMA_HOST=0.0.0.0 ollama serve`, Docker `OLLAMA_BASE_URL=http://host.docker.internal:11434`). Last-error strings: `HTTP <code>`, `Connection refused`, `Timed out`, or `str(exc)[:80]`.
  - `openai`: key required (`"OpenAI API key is required."`); `GET https://api.openai.com/v1/models` Bearer, 8 s; 200 -> `OpenAI key is valid.`; else `OpenAI rejected the key: HTTP <code>`; exception -> `OpenAI unreachable: <exc>`.
  - `anthropic`: `GET https://api.anthropic.com/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01`; 200 valid, 401 `Anthropic rejected the key — check it and retry.`, other `Anthropic returned HTTP <code>`.
  - `groq`: `GET https://api.groq.com/openai/v1/models`; 200 `Groq key is valid.` else `Groq rejected the key: HTTP <code>`.
  - anything else: `ok=false, "Unknown provider: <p>"` (including gemini, mistral, deepseek, cohere, huggingface, openrouter, which the UI offers).

Not used by the frontend but present: `GET /api/models/discover` (probes Ollama `/api/tags` at `settings.ollama_base_url` and LM Studio `/v1/models` at `LMSTUDIO_BASE_URL`, 3 s each, in parallel; returns `{providers:[{id,name,reachable,base_url,models:[{id,name,size_gb,family}]}], active_provider, active_model}`), `GET /api/settings/ollama-status` (2 s `/api/tags` via `ollama_base_url()`), `GET /api/health/llm`.

Health (`GET /api/health`): `LLMService.is_available()` = `GET <ollama_base_url()>/api/tags` with 5 s timeout, 200 -> true. It is Ollama-only (provider hard-coded), so with a cloud provider configured the UI shows "yellow" unless Ollama also happens to be running (**verify before porting**: probe the configured provider). `GET /api/health/llm` additionally runs one completion through `LLMService.complete` (`POST <ollama>/v1/chat/completions`, `Authorization: Bearer local`, `stream:false`, 120 s) with prompts `health_check_system/user`.

## 8. Prompts

Prompt text lives in `backend/prompts/*.txt`; `backend/prompts/README.md` lists each prompt, placeholders, caller and the expected output format/keys. `tests/unit/test_prompts.py` pins the exact strings sent by every call site.
