//! `routers/interview.py`: mock interview. `/init` builds the interviewer system prompt (no LLM call), `/chat`
//! runs one turn, `/report` grades the transcript; sessions persist per application (`interview_sessions`).

use std::sync::LazyLock;

use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use regex::Regex;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::row_json;
use crate::error::{ApiError, ApiResult, Body};
use crate::llm::{LlmClient, Override, load, render};
use crate::profile::db_err;
use crate::web_search;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/interview/init", post(init))
        .route("/api/interview/chat", post(chat))
        .route("/api/interview/report", post(report))
        .route("/api/interview/by-application/{id}", get(by_application))
        .route("/api/interview/{id}", delete(remove))
}

// ── Text helpers ────────────────────────────────────────────────────────────────────────────────

/// `<tag>…</tag>` content, trimmed; "" when absent.
fn extract_xml(text: &str, tag: &str) -> String {
    let re = Regex::new(&format!(r"(?s)<{tag}>(.*?)</{tag}>")).unwrap();
    re.captures(text).map(|c| c[1].trim().to_string()).unwrap_or_default()
}

static ANY_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"</?[a-z_]+>").unwrap());

/// `_extract_speech`: closed speech tag → text after an unclosed one → output minus reasoning tags / name label.
fn extract_speech(raw: &str, persona: &str) -> String {
    let text = raw.trim();
    let speech = extract_xml(text, "fala_do_entrevistador");
    if !speech.is_empty() {
        return speech;
    }
    static OPEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<fala_do_entrevistador>").unwrap());
    if let Some(m) = OPEN.find(text) {
        let tail = ANY_TAG.replace_all(&text[m.end()..], "").trim().to_string();
        if !tail.is_empty() {
            return tail;
        }
    }
    let mut cleaned = text.to_string();
    for t in ["estado_interno", "pensamento", "analise_ats", "mapeamento_de_verdade"] {
        cleaned = Regex::new(&format!(r"(?si)<{t}>.*?</{t}>"))
            .unwrap()
            .replace_all(&cleaned, "")
            .into_owned();
    }
    let cleaned = ANY_TAG.replace_all(&cleaned, "").trim().to_string();
    for prefix in [
        format!("{persona}:"),
        format!("{persona} :"),
        format!("{persona}\n"),
        "Interviewer:".into(),
    ] {
        if let Some(rest) = cleaned.strip_prefix(&prefix) {
            return rest.trim().to_string();
        }
    }
    cleaned
}

/// Stable persona name per company (Python used the per-process randomized `hash()`; any stable pick is fine).
fn pick_name(company: &str) -> &'static str {
    const NAMES: [&str; 10] = [
        "Alex", "Jordan", "Morgan", "Taylor", "Casey", "Riley", "Jamie", "Drew", "Sam", "Quinn",
    ];
    let h = company
        .to_lowercase()
        .bytes()
        .fold(0usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize));
    NAMES[h % NAMES.len()]
}

/// `_detect_track`: more specific tracks first.
fn detect_track(job_title: &str, job_description: &str) -> &'static str {
    const TRACKS: &[(&str, &[&str])] = &[
        (
            "system_design",
            &[
                "system design",
                "distributed systems",
                "scalability",
                "microservices",
                "architect",
                "staff engineer",
                "principal engineer",
                "tech lead",
                "high-throughput",
                "load balancing",
                "database sharding",
                "caching strategy",
            ],
        ),
        (
            "coding",
            &[
                "coding interview",
                "leetcode",
                "algorithm",
                "data structure",
                "software engineer",
                "swe",
                "backend engineer",
                "full stack",
                "python developer",
                "java developer",
                "go developer",
            ],
        ),
    ];
    let text = format!("{job_title} {job_description}").to_lowercase();
    TRACKS
        .iter()
        .find(|(_, kws)| kws.iter().any(|k| text.contains(k)))
        .map_or("behavioral", |(t, _)| t)
}

fn chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn or<'a>(s: &'a str, fallback: &'a str) -> &'a str {
    if s.is_empty() { fallback } else { s }
}

// ── /init ───────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct InitRequest {
    job_title: String,
    company_name: String,
    job_description: String,
    resume_text: String,
    user_profile: String,
    application_id: Option<String>,
}

#[derive(Serialize)]
struct InitResponse {
    session_id: Option<String>,
    session_context: String,
    persona_name: String,
    persona_bio: String,
    interview_track: String,
    messages: Vec<Value>,
    completed: bool,
}

/// (session_context, persona_bio, track) for a fresh session.
fn build_session(
    req: &InitRequest,
    name: &str,
    company_info: &str,
    interview_info: &str,
) -> (String, String, &'static str) {
    let block = |prompt: &str, field: &str, value: &str| {
        if value.is_empty() {
            String::new()
        } else {
            render(prompt, &[(field, value)]) + "\n\n"
        }
    };
    let profile = req.user_profile.trim();
    let profile_block = if profile.is_empty() {
        String::new()
    } else {
        format!("\n{}", render("interview_profile_block", &[("user_profile", profile)]))
    };
    let company = or(&req.company_name, "this company");
    let job = or(&req.job_title, "this role");
    let track = detect_track(&req.job_title, &req.job_description);
    let context = render(
        "interviewer_system",
        &[
            ("name", name),
            ("company", company),
            ("job_title", job),
            (
                "company_context_block",
                &block("interview_company_block", "company_info", company_info),
            ),
            (
                "interview_research_block",
                &block("interview_process_block", "interview_info", interview_info),
            ),
            (
                "job_description",
                &chars(or(&req.job_description, "No description provided."), 2500),
            ),
            ("resume_text", &chars(or(&req.resume_text, "No resume provided."), 3000)),
            ("profile_block", &profile_block),
            ("state_3_block", load(&format!("interview_state3_{track}"))),
        ],
    );
    let bio = format!(
        "{name} is a Senior Engineering Manager at {company} with over a decade of experience building and scaling \
         engineering teams. They specialize in hiring for {job} roles and will guide you through a structured interview \
         covering technical depth, behavioral scenarios, and culture fit."
    );
    (context, bio, track)
}

fn session_row(st: &AppState, sql: &str, key: &str) -> ApiResult<Option<Map<String, Value>>> {
    st.db
        .conn()
        .query_row(sql, [key], |r| {
            row_json(r, &["messages", "report"], &["completed"], &["updated_at"])
        })
        .optional()
        .map_err(db_err)
}

const SESSION_COLS: &str = "id, application_id, persona_name, persona_bio, session_context, interview_track, messages, state, completed, report, updated_at";

async fn init(State(st): State<AppState>, Body(req): Body<InitRequest>) -> ApiResult<Json<InitResponse>> {
    let app_id = req.application_id.clone().filter(|a| !a.is_empty());
    if let Some(app_id) = &app_id
        && let Some(row) = session_row(
            &st,
            &format!("SELECT {SESSION_COLS} FROM interview_sessions WHERE application_id = ?1"),
            app_id,
        )?
        && row["session_context"].as_str().is_some_and(|c| !c.is_empty())
    {
        let s = |k: &str, d: &str| row[k].as_str().filter(|v| !v.is_empty()).unwrap_or(d).to_string();
        return Ok(Json(InitResponse {
            session_id: row["id"].as_str().map(String::from),
            session_context: s("session_context", ""),
            persona_name: s("persona_name", "Interviewer"),
            persona_bio: s("persona_bio", ""),
            interview_track: s("interview_track", "behavioral"),
            messages: row["messages"].as_array().cloned().unwrap_or_default(),
            completed: row["completed"].as_bool().unwrap_or(false),
        }));
    }

    let (company_info, interview_info) = if req.company_name.is_empty() {
        (String::new(), String::new())
    } else {
        tokio::join!(
            web_search::company_info(&st.http, &req.company_name, &req.job_title),
            web_search::interview_process(&st.http, &req.company_name, &req.job_title),
        )
    };
    let name = pick_name(&req.company_name);
    let (context, bio, track) = build_session(&req, name, &company_info, &interview_info);

    let session_id = match &app_id {
        Some(app_id) => {
            let id = uuid::Uuid::new_v4().to_string();
            st.db
                .conn()
                .execute(
                    "INSERT INTO interview_sessions (id, application_id, persona_name, persona_bio, session_context, \
                     interview_track, messages, state, completed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', '', 0)",
                    params![id, app_id, name, bio, context, track],
                )
                .map_err(db_err)?;
            Some(id)
        }
        None => None,
    };
    Ok(Json(InitResponse {
        session_id,
        session_context: context,
        persona_name: name.into(),
        persona_bio: bio,
        interview_track: track.into(),
        messages: vec![],
        completed: false,
    }))
}

// ── /chat ───────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ChatRequest {
    session_context: String,
    persona_name: String,
    #[serde(default)]
    messages: Vec<ChatMessage>,
    #[serde(default)]
    message: String,
    session_id: Option<String>,
    #[serde(flatten)]
    llm: Override,
}

/// The last 18 messages flattened (`Candidate: …` / `<persona>: …`) plus the new message, or the start prompt.
fn chat_prompt(messages: &[ChatMessage], message: &str, name: &str) -> String {
    let mut lines: Vec<String> = messages[messages.len().saturating_sub(18)..]
        .iter()
        .map(|m| format!("{}: {}", if m.role == "user" { "Candidate" } else { name }, m.content))
        .collect();
    if !message.trim().is_empty() {
        lines.push(format!("Candidate: {}", message.trim()));
    }
    if lines.is_empty() {
        load("interview_chat_start").to_string()
    } else {
        lines.join("\n")
    }
}

/// Always 200; any failure becomes a canned apology.
async fn chat(State(st): State<AppState>, Body(req): Body<ChatRequest>) -> Json<Value> {
    let name = or(&req.persona_name, "Interviewer");
    let llm = LlmClient::from_override(&st.cfg, &req.llm);
    let res: Result<Value, String> = async {
        let raw = llm
            .complete(
                &st.http,
                &req.session_context,
                &chat_prompt(&req.messages, &req.message, name),
                None,
            )
            .await
            .map_err(|e| e.to_string())?;
        let speech = extract_speech(&raw, name);
        let state = extract_xml(&raw, "estado_interno");
        if let Some(id) = req.session_id.as_deref().filter(|i| !i.is_empty()) {
            let mut msgs = req.messages.clone();
            if !req.message.trim().is_empty() {
                msgs.push(ChatMessage {
                    role: "user".into(),
                    content: req.message.trim().into(),
                });
            }
            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: speech.clone(),
            });
            st.db
                .conn()
                .execute(
                    "UPDATE interview_sessions SET messages = ?1, state = COALESCE(NULLIF(?2, ''), state), \
                     updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
                    params![json!(msgs).to_string(), state, id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(json!({"role": "assistant", "content": speech, "state": state}))
    }
    .await;
    Json(res.unwrap_or_else(|e| {
        tracing::error!("Interview chat error: {e}");
        json!({
            "role": "assistant",
            "content": "I apologize for the technical hiccup. Let's continue — could you repeat your last point?",
            "state": "",
        })
    }))
}

// ── Persistence + report ────────────────────────────────────────────────────────────────────────

async fn by_application(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Map<String, Value>>> {
    let mut row = session_row(
        &st,
        &format!("SELECT {SESSION_COLS} FROM interview_sessions WHERE application_id = ?1"),
        &id,
    )?
    .ok_or_else(|| ApiError::new(404, "No interview session for this application."))?;
    if row["messages"].is_null() {
        row.insert("messages".into(), json!([]));
    }
    if row["updated_at"].is_null() {
        row.insert("updated_at".into(), json!(""));
    }
    Ok(Json(row))
}

async fn remove(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let n = st
        .db
        .conn()
        .execute("DELETE FROM interview_sessions WHERE id = ?1", [&id])
        .map_err(db_err)?;
    if n == 0 {
        return Err(ApiError::new(404, "Session not found."));
    }
    Ok(Json(json!({"deleted": id})))
}

#[derive(Deserialize)]
struct ReportRequest {
    session_id: String,
    #[serde(flatten)]
    llm: Override,
}

fn report_prompt(messages: &[Value], persona: &str, track: &str) -> String {
    let transcript: Vec<String> = messages
        .iter()
        .map(|m| {
            let who = if m["role"] == "user" {
                "Candidate"
            } else {
                or(persona, "Interviewer")
            };
            format!("{who}: {}", m["content"].as_str().unwrap_or_default())
        })
        .collect();
    render(
        "interview_report_user",
        &[("track", track), ("transcript", &transcript.join("\n"))],
    )
}

/// The report's JSON object: fences stripped line-wise (as the Python regex does), then first `{` .. last `}`.
fn report_json(raw: &str) -> ApiResult<Value> {
    static FENCES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^```(?:json)?\s*|\s*```$").unwrap());
    static OBJECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)\{.*\}").unwrap());
    let mut text = raw.trim().to_string();
    if text.starts_with("```") {
        text = FENCES.replace_all(&text, "").trim().to_string();
    }
    let m = OBJECT
        .find(&text)
        .ok_or_else(|| ApiError::new(500, "LLM did not return valid JSON."))?;
    serde_json::from_str(m.as_str()).map_err(|e| {
        tracing::error!("Report JSON parse failed: {e} | raw: {}", chars(raw, 500));
        ApiError::new(500, "Failed to parse report JSON.")
    })
}

async fn report(State(st): State<AppState>, Body(req): Body<ReportRequest>) -> ApiResult<Json<Value>> {
    let row = session_row(
        &st,
        &format!("SELECT {SESSION_COLS} FROM interview_sessions WHERE id = ?1"),
        &req.session_id,
    )?
    .ok_or_else(|| ApiError::new(404, "Session not found."))?;
    let cached = &row["report"];
    if !cached.is_null() && cached.as_object().is_none_or(|o| !o.is_empty()) {
        return Ok(Json(json!({"report": cached, "cached": true})));
    }
    let msgs = row["messages"].as_array().cloned().unwrap_or_default();
    if msgs.len() < 4 {
        return Err(ApiError::new(
            400,
            "Interview is too short to generate a meaningful report.",
        ));
    }
    let llm = LlmClient::from_override(&st.cfg, &req.llm);
    let user = report_prompt(
        &msgs,
        row["persona_name"].as_str().unwrap_or_default(),
        row["interview_track"].as_str().unwrap_or("None"),
    );
    let raw = llm
        .complete(&st.http, load("interview_report_system"), &user, None)
        .await
        .map_err(|e| {
            tracing::error!("Interview report LLM error: {e}");
            ApiError::new(500, format!("Report generation failed: {e}"))
        })?;
    let report = report_json(&raw)?;
    st.db
        .conn()
        .execute(
            "UPDATE interview_sessions SET report = ?1, completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![report.to_string(), req.session_id],
        )
        .map_err(db_err)?;
    Ok(Json(json!({"report": report, "cached": false})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(pairs: &[(&str, &str)]) -> String {
        use sha2::Digest;
        let items: Vec<String> = pairs
            .iter()
            .map(|(a, b)| format!("[{}, {}]", json!(a), json!(b)))
            .collect();
        let dumped = format!("[{}]", items.join(", "));
        sha2::Sha256::digest(dumped.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn prompts_match_python_hashes() {
        // Inputs and hashes from tests/unit/test_prompts.py (persona name mocked to "Alex" there).
        for (title, desc, company, profile, info, want) in [
            (
                "Product Manager",
                "Run {roadmaps}",
                "Acme",
                "  Built X  ",
                true,
                "e0abfc90d67255a7982001b633d2d6b9872dc7598f57ef683eeaafe479a7a121",
            ),
            (
                "Staff Engineer",
                "distributed systems",
                "Acme",
                "",
                true,
                "039e80d987c12319958dfd481ac5e0705041ac8bc58f450bc97f791c204a6c70",
            ),
            (
                "Backend Engineer",
                "python",
                "",
                "",
                false,
                "05e3a997af38a0b70f5ea436d12913c2f4b82c6571fae22f048ff0fdd80b9d6f",
            ),
        ] {
            let req = InitRequest {
                job_title: title.into(),
                job_description: desc.into(),
                company_name: company.into(),
                resume_text: "My {resume}".into(),
                user_profile: profile.into(),
                ..Default::default()
            };
            let (ci, ii) = if info {
                ("Company {intel}", "Process {intel}")
            } else {
                ("", "")
            };
            let (ctx, bio, _) = build_session(&req, "Alex", ci, ii);
            assert_eq!(h(&[(&ctx, &bio)]), want, "{title}");
        }

        assert_eq!(
            h(&[("CTX {x}", &chat_prompt(&[], "", "Alex"))]),
            "ce37a3c4261a9a7250b303290760d8fa512d2f09ed5f0a6c037efa5d882e7f7d"
        );
        let history = [
            ChatMessage {
                role: "assistant".into(),
                content: "Q1".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "A1".into(),
            },
        ];
        assert_eq!(
            h(&[("CTX", &chat_prompt(&history, " hello ", "Alex"))]),
            "cab0c8eecd19bfbd57302ab73e57becca84e9dbeb3884070678ada81abfcd56e"
        );
        let msgs = [
            json!({"role": "assistant", "content": "Q {1}"}),
            json!({"role": "user", "content": "A1"}),
            json!({"role": "assistant", "content": "Q2"}),
            json!({"role": "user", "content": "A2"}),
        ];
        assert_eq!(
            h(&[(load("interview_report_system"), &report_prompt(&msgs, "Alex", "coding"))]),
            "9fa7664659dd46370499f88ac29b3ccce83e2d038d7279d49cf5b3ac9f8b4e95"
        );
    }

    #[test]
    fn speech_and_report_parsing() {
        assert_eq!(
            extract_speech(
                "<pensamento>x</pensamento><fala_do_entrevistador> Hi </fala_do_entrevistador>",
                "Alex"
            ),
            "Hi"
        );
        assert_eq!(
            extract_speech(
                "<estado_interno>s</estado_interno><fala_do_entrevistador>Hello there",
                "Alex"
            ),
            "Hello there"
        );
        assert_eq!(
            extract_speech("<pensamento>x</pensamento>Alex: Welcome!", "Alex"),
            "Welcome!"
        );
        assert_eq!(
            extract_xml("a <estado_interno> 2 </estado_interno>", "estado_interno"),
            "2"
        );
        assert_eq!(report_json("```json\n{\"score\": 7}\n```").unwrap()["score"], 7);
        assert_eq!(report_json("Here: {\"score\": 8} done").unwrap()["score"], 8);
        assert!(report_json("no json").is_err());
        assert_eq!(detect_track("Staff Engineer", ""), "system_design");
        assert_eq!(detect_track("Designer", "talk"), "behavioral");
        assert_eq!(pick_name("Acme"), pick_name("ACME"));
    }
}
