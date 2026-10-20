//! `POST /api/resume/generate-for-application` (`routers/resume_gen.py` + `services/resume_generator.py` +
//! `ai_evaluator.generate_tailored_resume_html`): LLM → HTML fragment → sanitize → one-page PDF.
//! PDF rendering: the installed Edge / Chrome in headless `--print-to-pdf` mode instead of xhtml2pdf.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use jumpship_sources::soup::{self, Element, Node};
use regex::Regex;
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::AppState;
use crate::db::row_json;
use crate::error::{ApiError, ApiResult, Body};
use crate::llm::{LlmClient, Override, format_named, load, render};
use crate::profile::db_err;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/resume/generate-for-application", post(generate))
}

const MAX_COMPACT_PASSES: usize = 3;
/// Applied after the compaction passes; shrinks the CSS only.
const FONT_SCALES: [f64; 3] = [1.0, 0.92, 0.84];

/// Python `str(v)` for the JSON values that reach the prompt.
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True" } else { "False" }.into(),
        other => other.to_string(),
    }
}

fn truthy(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    })
}

/// `_build_candidate_context`: profile row → context lines for the LLM.
fn candidate_context(p: &Map<String, Value>) -> String {
    let get = |k: &str| truthy(p.get(k)).map(py_str);
    let mut lines = Vec::new();
    for (key, label) in [
        ("full_name", "Name"),
        ("email", "Email"),
        ("phone", "Phone"),
        ("linkedin_url", "LinkedIn"),
        ("github_url", "GitHub"),
        ("portfolio_url", "Portfolio"),
    ] {
        if let Some(v) = get(key) {
            lines.push(format!("{label}: {v}"));
        }
    }
    let location: Vec<String> = ["location_city", "location_state", "location_country"]
        .iter()
        .filter_map(|k| get(k))
        .collect();
    if !location.is_empty() {
        lines.push(format!("Location: {}", location.join(", ")));
    }
    if let Some(mode) = get("preferred_work_mode").filter(|m| m != "any") {
        lines.push(format!("Preferred work mode: {mode}"));
    }
    if get("willing_to_relocate").is_some() {
        lines.push("Willing to relocate: Yes".into());
    }
    let (lo, hi) = (get("salary_min"), get("salary_max"));
    if lo.is_some() || hi.is_some() {
        let currency = p.get("salary_currency").map_or_else(|| "BRL".into(), py_str);
        let sal = match (&lo, &hi) {
            (Some(lo), Some(hi)) => format!("{currency} {lo}-{hi}"),
            _ => format!("{currency} {}", lo.or(hi).unwrap_or_default()),
        };
        lines.push(format!(
            "Salary expectation: {sal}/mo (context only; do not include in resume)"
        ));
    }
    if let Some(v) = get("work_authorization") {
        lines.push(format!("Work authorization: {v}"));
    }
    if let Some(d) = get("highest_degree") {
        let uni = get("university").map(|u| format!(", {u}")).unwrap_or_default();
        lines.push(format!("Education: {d}{uni}"));
    }
    if lines.is_empty() {
        "No additional candidate context provided.".into()
    } else {
        lines.join("\n")
    }
}

/// `generate_tailored_resume_html`'s user prompt.
#[allow(clippy::too_many_arguments)]
fn tailored_user(
    resume: &str,
    job_description: &str,
    job_title: &str,
    company: &str,
    assessment: &Value,
    profile: &Map<String, Value>,
    custom: &str,
    extra: &str,
) -> String {
    let list = |k: &str, n: usize| {
        let items: Vec<String> = assessment[k]
            .as_array()
            .into_iter()
            .flatten()
            .take(n)
            .map(py_str)
            .collect();
        if items.is_empty() {
            "N/A".to_string()
        } else {
            items.join(", ")
        }
    };
    let score = assessment
        .get("match_score")
        .or(assessment.get("score"))
        .map_or_else(|| "N/A".into(), py_str);
    let title_line = if job_title.is_empty() && company.is_empty() {
        String::new()
    } else {
        format!("Title: {job_title} at {company}")
    };
    let mut body = render(
        "tailored_resume_user_html",
        &[
            ("job_title_line", &title_line),
            (
                "job_description",
                &job_description.chars().take(5000).collect::<String>(),
            ),
            ("resume", &resume.chars().take(8000).collect::<String>()),
            ("candidate_context", &candidate_context(profile)),
            ("score", &score),
            ("gaps", &list("gaps", 5)),
            ("missing_kw", &list("keywords_missing", 10)),
            ("skeleton", load("resume_html_skeleton")),
        ],
    );
    if !extra.trim().is_empty() {
        body += &format!(
            "\n\n{}",
            render("tailored_resume_extra_info", &[("extra_context", extra.trim())])
        );
    }
    if !custom.trim().is_empty() {
        body += &format!(
            "\n\n{}",
            render(
                "tailored_resume_custom_instructions",
                &[("custom_instructions", custom.trim())]
            )
        );
    }
    body
}

fn compact_user(fragment: &str) -> String {
    format!("{}{}", load("compact_resume_user"), fragment.trim())
}

fn extract_xml(text: &str, tag: &str) -> String {
    let re = Regex::new(&format!(r"(?s)<{tag}>(.*?)</{tag}>")).unwrap();
    re.captures(text).map(|c| c[1].trim().to_string()).unwrap_or_default()
}

// ── Sanitizing ──────────────────────────────────────────────────────────────────────────────────

/// Drop script-ish elements, `on*` attributes and `javascript:` links (bs4 decompose / attrs filter).
fn scrub(e: &mut Element) {
    e.children.retain(|c| !matches!(c, Node::Element(x) if matches!(x.name.as_str(), "script" | "iframe" | "object" | "embed" | "style")));
    e.attrs.retain(|(k, _)| !k.to_lowercase().starts_with("on"));
    if e.name == "a" {
        e.attrs
            .retain(|(k, v)| k != "href" || !v.trim().to_lowercase().starts_with("javascript:"));
    }
    for c in &mut e.children {
        if let Node::Element(x) = c {
            scrub(x);
        }
    }
}

fn find_by_id<'a>(e: &'a Element, id: &str) -> Option<&'a Element> {
    e.find(&|x| x.attr("id") == Some(id))
}

/// `_sanitize_resume_html`: fences, trailing AI footers, unsafe markup; keep `#resume-root` when present.
pub fn sanitize(raw: &str) -> String {
    static FOOTER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?im)^(generated by|created (with|using)|tailored (for|to)|this (resume|cv) (was|is)|version\s*\d+|chatgpt|openai|anthropic|claude|gemini|\bai\b.{0,12}assistant|disclaimer|notes?:|footer:|compact version|rewritten to fit).*$",
        )
        .unwrap()
    });
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return r#"<div class="resume" id="resume-root"></div>"#.into();
    }
    if text.starts_with("```") {
        let mut lines: Vec<&str> = text.lines().collect();
        if lines.first().is_some_and(|l| l.trim_start().starts_with("```")) {
            lines.remove(0);
        }
        while lines.last().is_some_and(|l| l.trim() == "```") {
            lines.pop();
        }
        text = lines.join("\n").trim().to_string();
    }
    let mut lines: Vec<&str> = text.lines().collect();
    let drop_blank = |lines: &mut Vec<&str>| {
        while lines.last().is_some_and(|l| l.trim().is_empty()) {
            lines.pop();
        }
    };
    drop_blank(&mut lines);
    while lines.last().is_some_and(|l| FOOTER.is_match(l.trim())) {
        lines.pop();
        drop_blank(&mut lines);
    }
    let text = lines.join("\n").trim().to_string();

    let mut doc = soup::parse(&text);
    scrub(&mut doc);
    if let Some(root) = find_by_id(&doc, "resume-root") {
        return soup::decode(root);
    }
    let inner = match doc.find(&|x| x.name == "body") {
        Some(body) => soup::decode_contents(body),
        None => soup::decode_contents(&doc),
    };
    if !inner.trim().is_empty() {
        return format!(r#"<div class="resume" id="resume-root">{inner}</div>"#);
    }
    let esc = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;");
    format!(r#"<div class="resume" id="resume-root"><p>{esc}</p></div>"#)
}

/// `_wrap_resume_html_document`: the fragment in a full A4 page with the résumé stylesheet.
fn wrap_document(fragment: &str, scale: f64) -> String {
    let inner = fragment.trim();
    let inner = if inner.contains(r#"id="resume-root""#) || inner.contains("id='resume-root'") {
        inner.to_string()
    } else {
        format!(r#"<div class="resume" id="resume-root">{inner}</div>"#)
    };
    let f = |x: f64| format!("{:.2}", x * scale);
    format_named(
        include_str!("resume_page.html"),
        &[
            ("base", &f(8.8)),
            ("h1", &f(17.0)),
            ("h2", &f(8.4)),
            ("h3", &f(9.0)),
            ("small", &f(7.8)),
            ("li_h", "1.22"),
            ("inner", &inner),
        ],
    )
}

// ── PDF rendering ───────────────────────────────────────────────────────────────────────────────

/// HTML → PDF bytes with a throwaway browser profile (never touches the user's running browser).
async fn html_to_pdf(html: &str) -> Result<Vec<u8>, String> {
    let exe = jumpship_sources::cdp::browser()
        .ok_or("no Edge/Chrome/Chromium found (set JUMPSHIP_BROWSER to its executable)")?;
    let dir = std::env::temp_dir().join(format!("jumpship-pdf-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let result = async {
        let page = dir.join("resume.html");
        let out = dir.join("resume.pdf");
        tokio::fs::write(&page, html).await.map_err(|e| e.to_string())?;
        let url = reqwest::Url::from_file_path(&page).map_err(|_| "bad temp path")?;
        let mut cmd = tokio::process::Command::new(&exe);
        cmd.arg("--headless")
            .arg("--disable-gpu")
            .arg("--no-first-run")
            .arg("--no-pdf-header-footer")
            .arg("--print-to-pdf-no-header")
            .arg(format!("--user-data-dir={}", dir.join("profile").display()))
            .arg(format!("--print-to-pdf={}", out.display()))
            .arg(url.as_str())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(Duration::from_secs(90), cmd.status())
            .await
            .map_err(|_| "browser timed out printing the PDF")?
            .map_err(|e| format!("could not start {}: {e}", exe.display()))?;
        match tokio::fs::read(&out).await {
            Ok(bytes) if !bytes.is_empty() => Ok(bytes),
            _ => Err(format!("browser produced no PDF (exit {status})")),
        }
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn page_count(pdf: &[u8]) -> Result<usize, String> {
    Ok(lopdf::Document::load_mem(pdf)
        .map_err(|e| e.to_string())?
        .get_pages()
        .len())
}

// ── Endpoint ────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GenerateRequest {
    application_id: String,
    resume_text: String,
    custom_instructions: Option<String>,
    extra_context: Option<String>,
    #[serde(flatten)]
    llm: Override,
}

/// `re.sub(r"[^\w\-]", "_", s)[:30]`.
fn safe(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(30)
        .collect()
}

/// Starlette FileResponse's Content-Disposition.
fn disposition(filename: &str) -> String {
    if filename.is_ascii() {
        return format!("attachment; filename=\"{filename}\"");
    }
    let enc: String = filename
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("attachment; filename*=utf-8''{enc}")
}

/// (html fragment, pdf bytes) after up to 3 compaction passes and 2 font-scale steps.
async fn build_pdf(st: &AppState, llm: &LlmClient, user: &str) -> Result<(String, Vec<u8>), String> {
    let raw = llm
        .complete(&st.http, load("tailored_resume_system_html"), user, None)
        .await
        .map_err(|e| e.to_string())?;
    let summary = extract_xml(&raw, "changes_summary");
    if !summary.is_empty() {
        tracing::info!("Tailoring changes:\n{summary}");
    }
    let fragment = extract_xml(&raw, "curriculo_otimizado");
    let mut html = sanitize(if fragment.is_empty() { &raw } else { &fragment });
    let (mut compact_round, mut scale) = (0, 0);
    loop {
        let pdf = html_to_pdf(&wrap_document(&html, FONT_SCALES[scale])).await?;
        if page_count(&pdf)? <= 1 {
            return Ok((html, pdf));
        }
        if compact_round < MAX_COMPACT_PASSES {
            let compacted = llm
                .complete(&st.http, load("compact_resume_system"), &compact_user(&html), None)
                .await
                .map_err(|e| e.to_string())?;
            html = sanitize(&compacted);
            compact_round += 1;
        } else if scale + 1 < FONT_SCALES.len() {
            scale += 1;
        } else {
            return Ok((html, pdf));
        }
    }
}

async fn generate(State(st): State<AppState>, Body(req): Body<GenerateRequest>) -> ApiResult<Response> {
    let app = st
        .db
        .conn()
        .query_row(
            "SELECT id, job_id, job_title, company_name, job_description, assessment_data FROM applications WHERE id = ?1",
            [&req.application_id],
            |r| row_json(r, &["assessment_data"], &[], &[]),
        )
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| ApiError::new(404, "Application not found."))?;
    if req.resume_text.trim().is_empty() {
        return Err(ApiError::new(400, "Resume text is required."));
    }
    let s = |k: &str| app.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let job_description = s("job_description");
    if job_description.is_empty() {
        return Err(ApiError::new(
            400,
            "Application has no job description — cannot generate tailored resume.",
        ));
    }
    let llm = LlmClient::from_override(&st.cfg, &req.llm);

    // `db.query(UserProfile).first()`: whichever row SQLite returns first; NULL columns left out.
    let mut profile = st
        .db
        .conn()
        .query_row("SELECT * FROM user_profiles LIMIT 1", [], |r| {
            row_json(r, &["custom_answers"], &["willing_to_relocate"], &[])
        })
        .optional()
        .map_err(db_err)?
        .unwrap_or_default();
    profile.retain(|_, v| !v.is_null());
    let profile_extra = profile.remove("extra_info").map(|v| py_str(&v)).unwrap_or_default();
    let extra: Vec<&str> = [profile_extra.as_str(), req.extra_context.as_deref().unwrap_or_default()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();

    let assessment = app.get("assessment_data").cloned().unwrap_or(Value::Null);
    let user = tailored_user(
        &req.resume_text,
        &job_description,
        &s("job_title"),
        &s("company_name"),
        &assessment,
        &profile,
        req.custom_instructions.as_deref().unwrap_or_default(),
        &extra.join("\n\n"),
    );
    let (html, pdf) = build_pdf(&st, &llm, &user).await.map_err(|e| {
        tracing::error!("Resume generation failed: {e}");
        ApiError::new(500, format!("Resume generation failed: {e}"))
    })?;

    let company = s("company_name");
    let title = s("job_title");
    let filename = format!(
        "resume_{}_{}_{}.pdf",
        safe(if company.is_empty() { "company" } else { &company }),
        safe(if title.is_empty() { "role" } else { &title }),
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    );
    let out_dir = Path::new(&st.cfg.resume_output_dir);
    let pdf_path = out_dir.join(&filename);
    std::fs::create_dir_all(out_dir)
        .and_then(|_| std::fs::write(&pdf_path, &pdf))
        .map_err(|e| ApiError::new(500, format!("Resume generation failed: {e}")))?;

    let score = truthy(assessment.get("match_score"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as i64;
    let record_id = uuid::Uuid::new_v4().to_string();
    let job_id = Some(s("job_id")).filter(|j| !j.is_empty()).unwrap_or_else(|| s("id"));
    st.db
        .conn()
        .execute(
            "INSERT INTO generated_resumes (id, job_id, job_title, company, match_score, markdown, pdf_path, provider, model) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![record_id, job_id, app.get("job_title").and_then(Value::as_str), company, score, html, pdf_path.to_string_lossy(), llm.provider, llm.model],
        )
        .map_err(db_err)?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (header::CONTENT_DISPOSITION, disposition(&filename)),
            (header::HeaderName::from_static("x-generated-resume-id"), record_id),
        ],
        pdf,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn h(system: &str, user: &str) -> String {
        use sha2::Digest;
        let dumped = format!("[[{}, {}]]", json!(system), json!(user));
        sha2::Sha256::digest(dumped.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn prompts_match_python_hashes() {
        let sys = load("tailored_resume_system_html");
        let profile = json!({"full_name": "Ada", "email": "a@b.c"})
            .as_object()
            .unwrap()
            .clone();
        let assessment = json!({"match_score": 61, "gaps": ["a", "b"], "keywords_missing": ["k1", "k2"]});
        let full = tailored_user(
            "resume {x}",
            "job {y}",
            "Dev",
            "Acme",
            &assessment,
            &profile,
            " be bold ",
            " side project {z} ",
        );
        assert_eq!(
            h(sys, &full),
            "f9b6ab3ac3c09d447d23f228e0b2c064dfdf796bed893492573bec07ca4455b9"
        );
        let minimal = tailored_user("resume", "", "", "", &Value::Null, &Map::new(), "", "");
        assert_eq!(
            h(sys, &minimal),
            "be6855fd96513c7c77c0803a4e71babfb8791743021127b44b793df120866dc2"
        );
        assert_eq!(
            h(
                load("compact_resume_system"),
                &compact_user(r#"<div id="resume-root">{x}</div>"#)
            ),
            "2962aeac4aef842d4fe50f84aab79a8918e9d89cefe7cef54fa245626980b710"
        );
    }

    #[test]
    fn sanitizing() {
        // Expected strings produced by backend.services.resume_generator._sanitize_resume_html.
        assert_eq!(sanitize(""), r#"<div class="resume" id="resume-root"></div>"#);
        assert_eq!(
            sanitize(
                "```html\n<div id=\"resume-root\" onclick=\"x()\"><script>bad()</script><p>Hi &amp; bye</p><a href=\"javascript:alert(1)\">l</a></div>\n```"
            ),
            r#"<div id="resume-root"><p>Hi &amp; bye</p><a>l</a></div>"#
        );
        assert_eq!(
            sanitize("<h1 class=\"legal-name\">Ada</h1><br>\nGenerated by ChatGPT"),
            r#"<div class="resume" id="resume-root"><h1 class="legal-name">Ada</h1><br/></div>"#
        );
        assert_eq!(
            sanitize("<style>x</style>"),
            r#"<div class="resume" id="resume-root"><p>&lt;style&gt;x&lt;/style&gt;</p></div>"#
        );
        assert_eq!(safe("São Paulo/Acme Inc."), "São_Paulo_Acme_Inc_");
        assert_eq!(disposition("resume_a.pdf"), r#"attachment; filename="resume_a.pdf""#);
        assert!(wrap_document("<p>x</p>", 0.92).contains("font-size: 8.10pt"));
    }
}
