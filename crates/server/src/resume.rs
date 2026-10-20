//! `routers/resume_v2.py` + `services/resume_parser_v2.py`: PDF / DOCX → text → LLM → `ResumeProfile`. Nothing persisted.

use std::io::Read;
use std::sync::LazyLock;

use axum::extract::{DefaultBodyLimit, Multipart, State};
use axum::routing::post;
use axum::{Json, Router};
use regex::Regex;
use serde_json::{Value, json};

use crate::AppState;
use crate::error::{ApiError, ApiResult};
use crate::jobs::ResumeProfile;
use crate::llm::{LlmClient, load, render};

const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    // Over the 10 MB check so oversized uploads get the API's 400, not a bare 413.
    Router::new().route(
        "/api/resume/parse",
        post(parse).layer(DefaultBodyLimit::max(4 * MAX_FILE_SIZE)),
    )
}

// ── Text extraction ─────────────────────────────────────────────────────────────────────────────

/// ponytail: pdf-extract (lopdf) stands in for pdfminer.six; line breaks / spacing differ a little, the LLM doesn't care.
fn pdf_text(data: &[u8]) -> Result<String, String> {
    // pdf-extract panics on some malformed files.
    std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(data))
        .map_err(|_| "PDF parser crashed on this file".to_string())?
        .map_err(|e| e.to_string())
}

/// python-docx `"\n".join(p.text for p in doc.paragraphs if p.text.strip())`: top-level body paragraphs only
/// (not tables), runs' text with `<w:tab/>` → tab and `<w:br/>` / `<w:cr/>` → newline.
fn docx_text(data: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|e| e.to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;
    let doc = roxmltree::Document::parse(&xml).map_err(|e| e.to_string())?;
    let body = doc
        .root_element()
        .children()
        .find(|n| n.has_tag_name((W, "body")))
        .ok_or("DOCX has no body")?;
    let mut paras = Vec::new();
    for p in body.children().filter(|n| n.has_tag_name((W, "p"))) {
        let mut text = String::new();
        for n in p.descendants() {
            match n.tag_name() {
                t if t.namespace() != Some(W) => {}
                t if t.name() == "t" => text.push_str(n.text().unwrap_or_default()),
                t if t.name() == "tab" && n.parent().is_some_and(|r| r.has_tag_name((W, "r"))) => text.push('\t'),
                t if matches!(t.name(), "br" | "cr") => text.push('\n'),
                _ => {}
            }
        }
        if !text.trim().is_empty() {
            paras.push(text);
        }
    }
    Ok(paras.join("\n"))
}

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// `_clean_text`: unify breaks and odd spaces, strip lines, drop 1-char non-letter noise lines.
pub fn clean_text(text: &str) -> String {
    static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new("[\u{a0}\u{2000}-\u{200b}\u{202f}\u{3000}]").unwrap());
    static MULTI: LazyLock<Regex> = LazyLock::new(|| Regex::new(" {2,}").unwrap());
    let t = text.replace(['\x0c', '\r'], "\n");
    let t = SPACES.replace_all(&t, " ");
    let t = MULTI.replace_all(&t, " ");
    // Python str.splitlines boundaries; blank lines fall out with the 1-char filter.
    let lines: Vec<&str> = t
        .split(['\n', '\x0b', '\x1c', '\x1d', '\x1e', '\u{85}', '\u{2028}', '\u{2029}'])
        .map(str::trim)
        .filter(|l| l.chars().count() > 1 || l.chars().next().is_some_and(char::is_alphabetic))
        .collect();
    lines.join("\n").trim().to_string()
}

// ── LLM profile ─────────────────────────────────────────────────────────────────────────────────

fn parse_user(text: &str) -> String {
    render(
        "resume_parse_user",
        &[("text", &text.chars().take(5000).collect::<String>())],
    )
}

/// `_clean_json_response`: fences, then a bare leading "json".
fn clean_json_response(response: &str) -> &str {
    static OPEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^```[a-zA-Z]*\n?").unwrap());
    static CLOSE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n?```\s*$").unwrap());
    let mut c = response.trim();
    if c.starts_with("```") {
        c = OPEN.find(c).map_or(c, |m| &c[m.end()..]);
        c = CLOSE.find(c).map_or(c, |m| &c[..m.start()]);
        c = c.trim();
    }
    if c.get(..4).is_some_and(|p| p.eq_ignore_ascii_case("json")) {
        c = c[4..].trim();
    }
    c
}

/// `_dedup_keywords`: whitespace collapsed, ≥ 2 chars, first spelling of each case-insensitive key.
fn dedup_keywords(v: &Value) -> Vec<Value> {
    let mut seen = Vec::new();
    let mut out = Vec::new();
    for kw in v.as_array().into_iter().flatten().filter_map(Value::as_str) {
        let cleaned = kw.split_whitespace().collect::<Vec<_>>().join(" ");
        if cleaned.chars().count() < 2 {
            continue;
        }
        let key = cleaned.to_lowercase();
        if !seen.contains(&key) {
            seen.push(key);
            out.push(json!(cleaned));
        }
    }
    out
}

/// `parse_profile` + `ResumeProfile(**data)`; any failure → a profile holding only `raw_text`.
fn profile_from(response: &str, text: &str) -> ResumeProfile {
    let raw_text: String = text.chars().take(8000).collect();
    let fallback = || ResumeProfile {
        raw_text: raw_text.clone(),
        ..Default::default()
    };
    let Ok(Value::Object(mut data)) = serde_json::from_str::<Value>(clean_json_response(response)) else {
        tracing::error!(
            "Resume JSON parse failed; LLM said: {}",
            response.chars().take(800).collect::<String>()
        );
        return fallback();
    };
    data.insert("raw_text".into(), json!(raw_text));
    for field in ["skills", "domains", "suggested_keywords", "suggested_titles"] {
        if !data.get(field).is_some_and(Value::is_array) {
            data.insert(field.into(), json!([]));
        }
    }
    let mut kw = dedup_keywords(&data["suggested_keywords"]);
    if kw.is_empty() {
        kw = dedup_keywords(&data["suggested_titles"]);
    }
    data.insert("suggested_keywords".into(), Value::Array(kw));
    // pydantic lax int: 5.0 / "5" → 5.
    if let Some(y) = data.get_mut("experience_years") {
        let n = match &*y {
            Value::String(s) => s.trim().parse::<i64>().ok(),
            Value::Number(n) => n.as_i64().or(n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)),
            _ => None,
        };
        if let Some(n) = n {
            *y = json!(n);
        }
    }
    serde_json::from_value(Value::Object(data)).unwrap_or_else(|e| {
        tracing::error!("LLM profile parsing failed: {e}");
        fallback()
    })
}

async fn parse(State(st): State<AppState>, mut form: Multipart) -> ApiResult<Json<ResumeProfile>> {
    let bad = |e: axum::extract::multipart::MultipartError| ApiError::new(400, format!("Invalid upload: {e}"));
    let mut file: Option<(String, Vec<u8>)> = None;
    let mut fields = std::collections::HashMap::new();
    while let Some(field) = form.next_field().await.map_err(bad)? {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            let filename = field.file_name().unwrap_or_default().to_string();
            file = Some((filename, field.bytes().await.map_err(bad)?.to_vec()));
        } else {
            fields.insert(name, field.text().await.map_err(bad)?);
        }
    }
    let Some((filename, content)) = file else {
        let detail = json!([{"loc": ["body", "file"], "msg": "Field required", "type": "missing"}]);
        return Err(ApiError(axum::http::StatusCode::UNPROCESSABLE_ENTITY, detail));
    };
    if filename.is_empty() {
        return Err(ApiError::new(400, "No file provided."));
    }
    let lower = filename.to_lowercase();
    if !lower.ends_with(".pdf") && !lower.ends_with(".docx") {
        return Err(ApiError::new(400, "Unsupported file type. Upload a PDF or DOCX."));
    }
    if content.len() > MAX_FILE_SIZE {
        return Err(ApiError::new(400, "File too large. Max 10 MB."));
    }
    let is_pdf = lower.ends_with(".pdf");
    let raw = tokio::task::spawn_blocking(move || {
        if is_pdf {
            pdf_text(&content)
        } else {
            docx_text(&content)
        }
    })
    .await
    .map_err(|e| ApiError::new(500, e.to_string()))?
    .map_err(|e| {
        tracing::error!("Text extraction failed: {e}");
        ApiError::new(422, format!("Could not extract text: {e}"))
    })?;
    let text = clean_text(&raw);
    if text.trim().is_empty() {
        return Err(ApiError::new(422, "No text found in the file."));
    }

    let form = |k: &str| fields.get(k).map(String::as_str).filter(|v| !v.is_empty());
    let provider = form("llm_provider").unwrap_or(&st.cfg.llm_provider).to_string();
    // Built directly (not from_override): the Ollama default URL only for provider ollama.
    let base_url = form("llm_base_url").or((provider == "ollama").then_some(st.cfg.ollama_base_url.as_str()));
    let llm = LlmClient::new(
        &st.cfg,
        &provider,
        form("llm_model").unwrap_or(&st.cfg.llm_model),
        form("llm_api_key").unwrap_or_default(),
        base_url,
    );
    tracing::info!(
        "Resume parse request: provider={} model={} text_len={}",
        llm.provider,
        llm.model,
        text.chars().count()
    );
    let profile = match llm
        .complete(&st.http, load("resume_parse_system"), &parse_user(&text), None)
        .await
    {
        Ok(response) => profile_from(&response, &text),
        Err(e) => {
            tracing::error!("LLM profile parsing failed: {e}");
            ResumeProfile {
                raw_text: text.chars().take(8000).collect(),
                ..Default::default()
            }
        }
    };
    Ok(Json(profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_matches_python_hash() {
        use sha2::Digest;
        let user = parse_user(&"Résumé {braces} ".repeat(500));
        let dumped = format!("[[{}, {}]]", json!(load("resume_parse_system")), json!(user));
        let h: String = sha2::Sha256::digest(dumped.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(h, "2a5bf86fec9683b1cf0d9b2acb70f0d7e1a899dbf85bdb09f3c0efbba00b802a");
    }

    #[test]
    fn cleaning_and_profile() {
        assert_eq!(
            clean_text("  Ada  Lovelace \r\n\n\n•\nx\n\u{a0}Python\x0cSQL "),
            "Ada Lovelace\nx\nPython\nSQL"
        );
        assert_eq!(clean_json_response("```json\n{\"a\": 1}\n```"), "{\"a\": 1}");
        assert_eq!(clean_json_response("json {\"a\": 1}"), "{\"a\": 1}");

        let p = profile_from(
            r#"{"name": "Ada", "experience_years": "7", "skills": "python", "suggested_keywords": [" ML  Engineer ", "ml engineer", "x", 3]}"#,
            "text",
        );
        assert_eq!(
            (p.name.as_str(), p.experience_years, p.raw_text.as_str()),
            ("Ada", 7, "text")
        );
        assert!(p.skills.is_empty());
        assert_eq!(p.suggested_keywords, ["ML Engineer"]);
        let titles = profile_from(r#"{"suggested_titles": ["Data Engineer"]}"#, "t");
        assert_eq!(titles.suggested_keywords, ["Data Engineer"]);
        // Type errors fall back to raw_text only, like the pydantic ValidationError path.
        let bad = profile_from(r#"{"name": null}"#, "t");
        assert_eq!((bad.name.as_str(), bad.raw_text.as_str()), ("", "t"));
        assert_eq!(profile_from("not json", "t").raw_text, "t");
    }

    #[test]
    fn docx_paragraphs() {
        use std::io::Write;
        let xml = format!(
            r#"<?xml version="1.0"?><w:document xmlns:w="{W}"><w:body>
            <w:p><w:r><w:t>Ada</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> Lovelace</w:t></w:r></w:p>
            <w:p><w:r><w:t>  </w:t></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>in table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            <w:p><w:r><w:t>line</w:t><w:br/><w:t>two</w:t></w:r></w:p></w:body></w:document>"#
        );
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut z = zip::ZipWriter::new(&mut buf);
        z.start_file("word/document.xml", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(xml.as_bytes()).unwrap();
        z.finish().unwrap();
        assert_eq!(docx_text(buf.get_ref()).unwrap(), "Ada\t Lovelace\nline\ntwo");
    }
}
