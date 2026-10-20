//! Model discovery and connectivity checks used by the settings modal (`jobs_v2.py`, LLM.md §7), plus health.

use std::time::Duration;

use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::AppState;
use crate::error::Body;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ollama/models", get(ollama_models))
        .route("/api/groq/models", get(groq_models))
        .route("/api/test-llm", post(test_llm))
    // No `GET /` (Python's "visit /docs" banner): the desktop shell serves the SPA there.
}

async fn health(State(st): State<AppState>) -> Json<Value> {
    // ponytail: probes Ollama whatever the configured provider, like LLMService.is_available (LLM.md §7).
    let available = st
        .http
        .get(format!("{}/api/tags", st.cfg.ollama_url))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .is_ok_and(|r| r.status() == 200);
    Json(json!({
        "status": "ok", "llm_provider": st.cfg.llm_provider, "llm_model": st.cfg.llm_model,
        "llm_available": available, "version": "2.0.1",
    }))
}

async fn get_json(http: &reqwest::Client, url: &str, secs: u64) -> Result<Value, reqwest::Error> {
    http.get(url)
        .timeout(Duration::from_secs(secs))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
}

fn without_v1(url: &str) -> &str {
    let u = url.trim_end_matches('/');
    u.strip_suffix("/v1").unwrap_or(u)
}

#[derive(Deserialize)]
struct ModelsQuery {
    base_url: Option<String>,
    #[serde(default)]
    provider: Option<String>,
}

/// Never fails: `[]` on any error. Ollama = installed (`size > 0`) then running-only models.
async fn ollama_models(State(st): State<AppState>, Query(q): Query<ModelsQuery>) -> Json<Vec<String>> {
    let url = q
        .base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| st.cfg.ollama_base_url.clone());
    let url = url.trim_end_matches('/');
    let mut out: Vec<String> = Vec::new();
    if q.provider.as_deref() == Some("lmstudio") {
        match get_json(&st.http, &format!("{}/v1/models", without_v1(url)), 4).await {
            Ok(data) => out.extend(
                data["data"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m["id"].as_str())
                    .map(String::from),
            ),
            Err(e) => tracing::warn!("Could not fetch models (lmstudio) from {url}: {e}"),
        }
        return Json(out);
    }
    match get_json(&st.http, &format!("{url}/api/tags"), 4).await {
        Ok(data) => {
            for m in data["models"].as_array().into_iter().flatten() {
                let name = m["name"].as_str().unwrap_or_default();
                if !name.is_empty() && m["size"].as_f64().unwrap_or(0.0) > 0.0 && !out.iter().any(|n| n == name) {
                    out.push(name.into());
                }
            }
        }
        Err(e) => tracing::warn!("Ollama /api/tags failed ({url}): {e}"),
    }
    if let Ok(data) = get_json(&st.http, &format!("{url}/api/ps"), 4).await {
        for m in data["models"].as_array().into_iter().flatten() {
            let name = m["name"].as_str().unwrap_or_default();
            if !name.is_empty() && !out.iter().any(|n| n == name) {
                out.push(name.into());
            }
        }
    }
    Json(out)
}

// ponytail: Groq has decommissioned most of these; the live list wins whenever a key is given (LLM.md "verify").
const GROQ_FALLBACK: &[&str] = &[
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.2-90b-vision-preview",
    "llama-3.2-11b-vision-preview",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
];

#[derive(Deserialize)]
struct GroqQuery {
    #[serde(default)]
    api_key: String,
}

async fn groq_models(State(st): State<AppState>, Query(q): Query<GroqQuery>) -> Json<Vec<String>> {
    let fallback = || GROQ_FALLBACK.iter().map(|s| s.to_string()).collect();
    if q.api_key.is_empty() {
        return Json(fallback());
    }
    let res = async {
        st.http
            .get("https://api.groq.com/openai/v1/models")
            .bearer_auth(&q.api_key)
            .timeout(Duration::from_secs(6))
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await
    }
    .await;
    match res {
        Ok(data) => {
            let mut ids: Vec<String> = data["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                .map(String::from)
                .collect();
            ids.sort();
            Json(ids)
        }
        Err(e) => {
            tracing::warn!("Could not fetch Groq models: {e}");
            Json(fallback())
        }
    }
}

#[derive(Deserialize)]
struct TestRequest {
    provider: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
}

#[derive(Serialize)]
struct TestResponse {
    ok: bool,
    message: String,
    resolved_url: String,
}

fn verdict(ok: bool, message: impl Into<String>) -> Json<TestResponse> {
    Json(TestResponse {
        ok,
        message: message.into(),
        resolved_url: String::new(),
    })
}

/// Local-server URLs to probe, in order: given, localhost↔127.0.0.1 swap, host.docker.internal, server default.
fn candidates(given: &str, server: &str) -> Vec<String> {
    let raw = given.trim_end_matches('/').to_string();
    let mut c = vec![raw.clone()];
    if raw.contains("localhost") {
        c.push(raw.replace("localhost", "127.0.0.1"));
    }
    if raw.contains("127.0.0.1") {
        c.push(raw.replace("127.0.0.1", "localhost"));
    }
    let port = raw.rsplit_once(':').map_or("11434", |(_, p)| p);
    let docker = format!("http://host.docker.internal:{port}");
    if !c.contains(&docker) && !raw.contains("host.docker.internal") {
        c.push(docker);
    }
    let server = server.trim_end_matches('/').to_string();
    if !c.contains(&server) {
        c.push(server);
    }
    c
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Always 200: `{ok, message, resolved_url}`.
async fn test_llm(State(st): State<AppState>, Body(req): Body<TestRequest>) -> Json<TestResponse> {
    let http = &st.http;
    let p = req.provider.as_str();
    let key_check = |url: &'static str, name: &'static str| async move {
        if req.api_key.is_empty() {
            return verdict(false, format!("{name} API key is required."));
        }
        let mut r = http.get(url).timeout(Duration::from_secs(8));
        r = if name == "Anthropic" {
            r.header("x-api-key", &req.api_key)
                .header("anthropic-version", "2023-06-01")
        } else {
            r.bearer_auth(&req.api_key)
        };
        match r.send().await.map(|r| r.status().as_u16()) {
            Ok(200) => verdict(true, format!("{name} key is valid.")),
            Ok(401) if name == "Anthropic" => verdict(false, "Anthropic rejected the key — check it and retry."),
            Ok(code) if name == "Anthropic" => verdict(false, format!("Anthropic returned HTTP {code}")),
            Ok(code) => verdict(false, format!("{name} rejected the key: HTTP {code}")),
            Err(e) => verdict(false, format!("{name} unreachable: {e}")),
        }
    };
    match p {
        "openai" => return key_check("https://api.openai.com/v1/models", "OpenAI").await,
        "anthropic" => return key_check("https://api.anthropic.com/v1/models", "Anthropic").await,
        "groq" => return key_check("https://api.groq.com/openai/v1/models", "Groq").await,
        "ollama" | "lmstudio" | "openclaw" => {}
        _ => return verdict(false, format!("Unknown provider: {p}")),
    }

    let given = if req.base_url.is_empty() {
        &st.cfg.ollama_base_url
    } else {
        &req.base_url
    };
    let urls = candidates(given, &st.cfg.ollama_base_url);
    let mut last_error = String::new();
    for url in &urls {
        let probe = if p == "lmstudio" {
            format!("{}/v1/models", without_v1(url))
        } else {
            format!("{}/api/tags", url.trim_end_matches('/'))
        };
        match http.get(&probe).timeout(Duration::from_secs(4)).send().await {
            Ok(r) if r.status() == 200 => {
                let data: Value = r.json().await.unwrap_or_default();
                let message = if p == "lmstudio" {
                    let list = if data["data"].is_array() {
                        &data["data"]
                    } else {
                        &data["models"]
                    };
                    let n = list
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|m| m["id"].as_str().is_some_and(|s| !s.is_empty()))
                        .count();
                    let hint = if n > 0 {
                        format!(" ({n} model{} loaded)", plural(n))
                    } else {
                        " (no models loaded)".into()
                    };
                    format!("Connected to LM Studio{hint}")
                } else {
                    let n = data["models"].as_array().map_or(0, Vec::len);
                    let hint = if n > 0 {
                        format!(" ({n} model{} installed)", plural(n))
                    } else {
                        " (no models installed yet)".into()
                    };
                    format!("Connected to {p}{hint}")
                };
                return Json(TestResponse {
                    ok: true,
                    message,
                    resolved_url: url.clone(),
                });
            }
            Ok(r) => last_error = format!("HTTP {}", r.status().as_u16()),
            Err(e) if e.is_timeout() => last_error = "Timed out".into(),
            Err(e) if e.is_connect() => last_error = "Connection refused".into(),
            Err(e) => last_error = e.to_string().chars().take(80).collect(),
        }
    }
    let hint = if last_error.contains("Connection refused") {
        format!(
            " — Is {p} running? On Linux run: `OLLAMA_HOST=0.0.0.0 ollama serve` so it binds to all interfaces. \
             Docker: set OLLAMA_BASE_URL=http://host.docker.internal:11434 in your .env"
        )
    } else {
        String::new()
    };
    verdict(
        false,
        format!("Could not reach {p} at [{}]: {last_error}{hint}", urls.join(", ")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_urls() {
        assert_eq!(
            candidates("http://localhost:11434/", "http://localhost:11434"),
            [
                "http://localhost:11434",
                "http://127.0.0.1:11434",
                "http://host.docker.internal:11434"
            ]
        );
        assert_eq!(
            candidates("http://host.docker.internal:1234", "http://localhost:11434"),
            ["http://host.docker.internal:1234", "http://localhost:11434"]
        );
    }
}
