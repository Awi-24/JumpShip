# LLM prompts

Every system/user prompt sent to an LLM lives here as `<name>.txt`, loaded through `backend/prompts/__init__.py`:

- `load(name)` returns the file text. **Exactly one trailing newline is stripped**, so a prompt that must end with a newline keeps an extra blank last line in its file (`interviewer_system`, `interview_report_system`, `compact_resume_user`, `tailored_resume_user_html`).
- `render(name, **fields)` is `load(name).format(**fields)`. Prompts marked **template** use `{field}` placeholders and double their literal braces (`{{` `}}`). Prompts marked **static** are used through `load()` only and keep single braces (their JSON examples are not escaped).
- `str.format` only parses the template, never the substituted values, so user text containing `{` or `}` is safe.
- Files are UTF-8, LF. Prompts are loaded once (`lru_cache`); several are bound to module constants at import time.
- `tests/unit/test_prompts.py` drives every call site with a stub LLM and compares the exact `(system, user)` strings to hashes captured before the prompts were moved out of the Python source. Change a prompt on purpose and the test tells you how to refresh the hashes.

Port note: the prompt text is the contract. A Rust port should embed these files (`include_str!`) and apply the same two rules (strip one trailing `\n`; replace `{field}`, treat `{{`/`}}` as literal braces).

JSON output is parsed with `clean_and_parse_json` (strip ``` fences, then `json.loads`, then first `{`..last `}` slice) unless noted.

## jobs_v2 router (`backend/routers/jobs_v2.py`)

| File | Kind | Placeholders | Caller | Output expected |
|---|---|---|---|---|
| `assess_system` | static | - | `_run_assessment` (`POST /api/jobs/assess`, `/assess-batch`) | JSON object (see `assess_user`) |
| `assess_user` | template | `name title experience_years skills domains resume_extract job_title company location salary site description company_context` | `_build_assess_user` | JSON object, keys: `is_relevant` (bool), `match_score` (int 0-100), `hire_recommendation` (`strong_yes\|yes\|borderline\|no\|strong_no`), `summary`, `strong_points[]`, `gaps[]`, `career_suggestions[]`, `company_insights`, `income_range`, `job_tags[]`, `keywords_matched[]`, `keywords_missing[]` -> `JobAssessment` |
| `assess_company_context` | template | `company_info` | `_run_assessment`, only when `include_company_research`; code wraps it as `"\n" + text + "\n"` and passes it as `{company_context}` | - (prompt fragment) |
| `suggest_keywords_system` / `suggest_keywords_user` | static / template (`keywords`, comma-joined) | `keywords` | `suggest_keywords` (`POST /api/jobs/suggest-keywords`) | JSON array of strings (`json.loads` after fence strip; non-strings and input duplicates dropped, max 10) |
| `translate_keywords_system` / `translate_keywords_user` | static / template | `language` (English name, e.g. "Portuguese"), `keywords` | `translate_keywords` (`POST /api/jobs/translate-keywords`) | JSON array of strings (max 20) |

## interview router (`backend/routers/interview.py`)

| File | Kind | Placeholders | Caller | Output expected |
|---|---|---|---|---|
| `interviewer_system` | template | `name company job_title company_context_block interview_research_block job_description resume_text profile_block state_3_block` | `interview_init` builds it once; the result (`session_context`) is the system prompt for every `/chat` turn | XML-ish text, not JSON: `<estado_interno>`, `<pensamento>`, `<fala_do_entrevistador>`; only the last is shown (`_extract_speech`) |
| `interview_state3_behavioral` / `interview_state3_system_design` / `interview_state3_coding` | static | - | `_TRACK_INSTRUCTIONS[track]` -> `{state_3_block}` | - (fragment) |
| `interview_company_block` | template | `company_info` | `interview_init`; code appends `"\n\n"`; result goes into `{company_context_block}` | - |
| `interview_process_block` | template | `interview_info` | same; appends `"\n\n"`; -> `{interview_research_block}` | - |
| `interview_profile_block` | template | `user_profile` (stripped) | same; code prefixes `"\n"`; -> `{profile_block}` | - |
| `interview_chat_start` | static | - | `interview_chat`: user message when there is no history | - |
| `interview_report_system` | static | - | `interview_report` (`POST /api/interview/report`) | JSON object: `score` (0-100), `strengths[]`, `improvements[]`, `technical_gaps[]`, `study_tips[]`, `next_steps[]`. Parsed with a `\{.*\}` regex + `json.loads` (not `clean_and_parse_json`); stored as-is in `InterviewSession.report` |
| `interview_report_user` | template | `track`, `transcript` | `interview_report` | - |

## ai_evaluator (`backend/services/ai_evaluator.py`)

| File | Kind | Placeholders | Caller | Output expected |
|---|---|---|---|---|
| `assessment_system` | static | - | `assess_job` (legacy `analysis` routes) via `LLMClient.complete_json` with `ASSESSMENT_SCHEMA` | JSON |
| `assessment_user` | template | `resume job_description job_title company_name` | `assess_job` | JSON object, keys: `score` (int 0-100), `summary`, `strengths[]`, `gaps[]`, `suggestions[]`, `keywords_matched[]`, `keywords_missing[]` |
| `resume_html_skeleton` | static | - | embedded in `tailored_resume_user_html` as `{skeleton}` | - (HTML skeleton, no braces) |
| `tailored_resume_system_html` | static | - | `generate_tailored_resume_html` (`POST /api/resume/generate`) | Four XML tags: `<analise_ats>`, `<mapeamento_de_verdade>`, `<curriculo_otimizado>` (HTML fragment, the only part kept; falls back to the raw reply when the tag is missing), `<changes_summary>` (logged). Existing quirk: the system prompt says "FOUR tags", the user prompt's last line says "three" |
| `tailored_resume_user_html` | template | `job_title_line job_description resume candidate_context score gaps missing_kw skeleton` | `_build_tailored_resume_user_html` | - |
| `tailored_resume_extra_info` | template | `extra_context` (stripped) | appended after `"\n\n"` when the request has extra context | - |
| `tailored_resume_custom_instructions` | template | `custom_instructions` (stripped) | appended after `"\n\n"` when set | - |
| `compact_resume_system` | static | - | `compact_tailored_resume_html` (second pass when the PDF exceeds one page; up to 3 times) | HTML fragment only |
| `compact_resume_user` | static | - | same; the fragment is appended directly (file ends with a blank line on purpose) | - |

## Other

| File | Kind | Placeholders | Caller | Output expected |
|---|---|---|---|---|
| `resume_parse_system` | static | - | `resume_parser_v2.parse_profile` (`POST /api/resume/parse`) | JSON object, keys: `name email phone location_city location_country title skills[] experience_years (int) domains[] suggested_keywords[] suggested_titles[]`. Parsed with `_clean_json_response` + `json.loads`; on failure an empty profile is returned |
| `resume_parse_user` | template | `text` (first 5000 chars) | same | - |
| `json_repair_system` / `json_repair_user` | static / template (`raw`, first 2000 chars) | `raw` | `LLMClient.complete_json` retry after a parse failure | JSON |
| `health_check_system` / `health_check_user` | static | - | `GET /api/health/llm` | free text (expects "OK") |

## Deliberately not here

- `/no_think\n` prefix added to the system prompt for thinking models (`llm_client._suppress_thinking`): behaviour tied to model-name detection, documented in `docs/rust-migration/LLM.md`.
- Persona bio and the "technical hiccup" fallback reply in `interview.py`: user-facing UI text, not sent to an LLM.
- The PDF stylesheet in `resume_generator.py`: CSS, not a prompt.
