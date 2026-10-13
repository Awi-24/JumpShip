//! `backend/services/llm_client.py` (spec: docs/rust-migration/LLM.md) plus the prompt loader of
//! `backend/prompts/__init__.py`. Async reqwest adapters instead of the provider SDKs.

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Semaphore;

use crate::config::Config;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

// ── Prompts ─────────────────────────────────────────────────────────────────────────────────────

macro_rules! prompts {
    ($($name:ident),* $(,)?) => {
        fn raw_prompt(name: &str) -> &'static str {
            match name {
                $(stringify!($name) => include_str!(concat!("../../../backend/prompts/", stringify!($name), ".txt")),)*
                _ => panic!("unknown prompt {name}"),
            }
        }
    };
}

prompts!(
    assess_system,
    assess_user,
    assess_company_context,
    compact_resume_system,
    compact_resume_user,
    health_check_system,
    health_check_user,
    interview_chat_start,
    interview_company_block,
    interview_process_block,
    interview_profile_block,
    interview_report_system,
    interview_report_user,
    interview_state3_behavioral,
    interview_state3_coding,
    interview_state3_system_design,
    interviewer_system,
    resume_html_skeleton,
    resume_parse_system,
    resume_parse_user,
    suggest_keywords_system,
    suggest_keywords_user,
    tailored_resume_custom_instructions,
    tailored_resume_extra_info,
    tailored_resume_system_html,
    tailored_resume_user_html,
    translate_keywords_system,
    translate_keywords_user,
);

/// `prompts.load`: the file text minus exactly one trailing newline.
pub fn load(name: &str) -> &'static str {
    let text = raw_prompt(name);
    text.strip_suffix('\n').unwrap_or(text)
}

/// `prompts.render`: Python `str.format` with named fields; `{{` / `}}` are literal braces.
pub fn render(name: &str, fields: &[(&str, &str)]) -> String {
    format_named(load(name), fields)
}

pub fn format_named(template: &str, fields: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(i) = rest.find(['{', '}']) {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if tail.starts_with("{{") || tail.starts_with("}}") {
            out.push_str(&tail[..1]);
            rest = &tail[2..];
        } else if let Some(end) = tail.strip_prefix('{').and_then(|t| t.find('}')) {
            let key = &tail[1..=end];
            let value = fields
                .iter()
                .find(|(k, _)| *k == key)
                .unwrap_or_else(|| panic!("missing prompt field {key}"));
            out.push_str(value.1);
            rest = &tail[end + 2..];
        } else {
            panic!("bad prompt template near {:?}", &tail[..tail.len().min(20)]);
        }
    }
    out.push_str(rest);
    out
}

// ── Client ──────────────────────────────────────────────────────────────────────────────────────

/// `LLMOverride`: per-request provider settings (empty strings fall back to the config).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Override {
    pub llm_provider: Option<String>,
    pub llm_model: Option<String>,
    pub llm_api_key: Option<String>,
    pub llm_base_url: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Adapter {
    Anthropic,
    OpenAi,
    Ollama,
    Gemini,
    Cohere,
}

/// (adapter, default base URL, default model, API key env var).
fn provider_info(name: &str) -> Option<(Adapter, Option<&'static str>, &'static str, &'static str)> {
    use Adapter::*;
    Some(match name {
        "anthropic" => (
            Anthropic,
            Some("https://api.anthropic.com"),
            "claude-sonnet-4-6",
            "ANTHROPIC_API_KEY",
        ),
        "openai" => (
            OpenAi,
            Some("https://api.openai.com/v1"),
            "gpt-4o-mini",
            "OPENAI_API_KEY",
        ),
        "deepseek" => (
            OpenAi,
            Some("https://api.deepseek.com"),
            "deepseek-chat",
            "DEEPSEEK_API_KEY",
        ),
        "groq" => (
            OpenAi,
            Some("https://api.groq.com/openai/v1"),
            "llama-3.3-70b-versatile",
            "GROQ_API_KEY",
        ),
        "huggingface" => (
            OpenAi,
            Some("https://router.huggingface.co/v1"),
            "Qwen/Qwen2.5-72B-Instruct",
            "HUGGINGFACE_API_KEY",
        ),
        "mistral" => (
            OpenAi,
            Some("https://api.mistral.ai/v1"),
            "mistral-small-latest",
            "MISTRAL_API_KEY",
        ),
        "openrouter" => (
            OpenAi,
            Some("https://openrouter.ai/api/v1"),
            "meta-llama/llama-3.2-3b-instruct:free",
            "OPENROUTER_API_KEY",
        ),
        // google-generativeai's gemini-1.5-flash is retired; REST generateContent with a current model.
        "gemini" => (
            Gemini,
            Some("https://generativelanguage.googleapis.com"),
            "gemini-2.5-flash",
            "GOOGLE_API_KEY",
        ),
        "cohere" => (Cohere, Some("https://api.cohere.com"), "command-r", "COHERE_API_KEY"),
        "ollama" => (Ollama, None, "llama3.2", ""),
        "lmstudio" => (OpenAi, None, "local-model", ""),
        _ => return None,
    })
}

const VALID: &str =
    "anthropic, openai, deepseek, groq, huggingface, mistral, openrouter, gemini, cohere, ollama, lmstudio";

pub fn is_local(provider: &str) -> bool {
    matches!(provider, "ollama" | "lmstudio" | "openclaw")
}

/// Local GPU inference runs one call at a time (`LLM_MAX_CONCURRENT` slots); `*-cloud` Ollama models are remote.
pub fn needs_semaphore(provider: &str, model: &str) -> bool {
    is_local(provider) && !model.ends_with("-cloud")
}

static LOCAL_SEM: LazyLock<Semaphore> = LazyLock::new(|| {
    let slots = std::env::var("LLM_MAX_CONCURRENT")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok());
    Semaphore::new(slots.unwrap_or(1).max(1))
});

#[derive(Debug, Clone)]
pub struct LlmClient {
    pub provider: String,
    /// Resolved model (override → config → provider default).
    pub model: String,
    api_key: String,
    base_url: Option<String>,
    max_tokens: u32,
}

static TRAILING_OBJECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\{[\s\S]*\})\s*$").unwrap());

/// Ollama context for one call: prompt (≈ 3 chars per token, on the safe side) + 2k for the answer, rounded up to
/// 8k / 16k / 32k. Few fixed sizes, because Ollama reloads the model whenever `num_ctx` changes.
/// `OLLAMA_NUM_CTX` pins it (e.g. for a GPU that can't hold 32k).
fn num_ctx(system: &str, user: &str) -> u32 {
    if let Some(n) = std::env::var("OLLAMA_NUM_CTX").ok().and_then(|v| v.trim().parse().ok()) {
        return n;
    }
    let need = ((system.chars().count() + user.chars().count()) / 3 + 2048) as u32;
    [8192, 16384, 32768].into_iter().find(|n| *n >= need).unwrap_or(32768)
}

static THINKING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)qwen3|qwq|deepseek-r\d|deepseek-reasoner|qwen-3").unwrap());

impl LlmClient {
    /// `LLMClient(provider, model, api_key, base_url)`: unset fields resolve like `_resolve_*`.
    pub fn new(cfg: &Config, provider: &str, model: &str, api_key: &str, base_url: Option<&str>) -> LlmClient {
        let p = provider_info(provider);
        let model = if model.is_empty() {
            p.map_or("", |p| p.2).to_string()
        } else {
            model.to_string()
        };
        let api_key = if !api_key.is_empty() {
            api_key.to_string()
        } else if matches!(provider, "ollama" | "lmstudio") {
            "local".into()
        } else {
            p.and_then(|p| std::env::var(p.3).ok()).unwrap_or_default()
        };
        // Python honours llm_base_url for every provider, but the UI sends its Ollama URL with every request,
        // which would point cloud providers at Ollama: only local providers take it.
        let base_url = match (provider, base_url.filter(|u| !u.is_empty())) {
            ("ollama" | "lmstudio", Some(u)) => {
                let u = u.trim_end_matches('/');
                Some(if u.ends_with("/v1") {
                    u.to_string()
                } else {
                    format!("{u}/v1")
                })
            }
            ("ollama", None) => Some(format!("{}/v1", cfg.ollama_url)),
            ("lmstudio", None) => Some(format!("{}/v1", cfg.lmstudio_url)),
            _ => p.and_then(|p| p.1).map(String::from),
        };
        LlmClient {
            provider: provider.into(),
            model,
            api_key,
            base_url,
            max_tokens: 8192,
        }
    }

    /// `LLMClient.from_override`: each override field, else the config's provider / model.
    pub fn from_override(cfg: &Config, o: &Override) -> LlmClient {
        let pick = |v: &Option<String>| v.clone().filter(|s| !s.is_empty());
        let provider = pick(&o.llm_provider).unwrap_or_else(|| cfg.llm_provider.clone());
        let model = pick(&o.llm_model).unwrap_or_else(|| cfg.llm_model.clone());
        LlmClient::new(
            cfg,
            &provider,
            &model,
            &pick(&o.llm_api_key).unwrap_or_default(),
            pick(&o.llm_base_url).as_deref(),
        )
    }

    /// One system + user turn → text. `json_schema` switches on the provider's JSON mode.
    pub async fn complete(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        json_schema: Option<&Value>,
    ) -> Result<String, Error> {
        let Some((adapter, ..)) = provider_info(&self.provider) else {
            return Err(format!("Unknown provider '{}'. Valid: {VALID}", self.provider).into());
        };
        let system = if THINKING.is_match(&self.model) && !system.starts_with("/no_think") {
            format!("/no_think\n{system}")
        } else {
            system.to_string()
        };
        // ponytail: guarded per call everywhere (Python guards only some routes, and multi-call résumé generation as a whole).
        let _slot = if needs_semaphore(&self.provider, &self.model) {
            Some(LOCAL_SEM.acquire().await?)
        } else {
            None
        };
        match adapter {
            Adapter::OpenAi => self.openai(http, &system, user, json_schema).await,
            Adapter::Ollama => self.ollama(http, &system, user, json_schema).await,
            Adapter::Anthropic => self.anthropic(http, &system, user, json_schema).await,
            Adapter::Gemini => self.gemini(http, &system, user, json_schema).await,
            Adapter::Cohere => self.cohere(http, &system, user, json_schema).await,
        }
    }

    fn base(&self) -> &str {
        self.base_url.as_deref().unwrap_or_default().trim_end_matches('/')
    }

    fn messages(system: &str, user: &str) -> Vec<Value> {
        let mut m = Vec::new();
        if !system.is_empty() {
            m.push(json!({"role": "system", "content": system}));
        }
        m.push(json!({"role": "user", "content": user}));
        m
    }

    async fn post(&self, req: reqwest::RequestBuilder) -> Result<Value, Error> {
        let r = req.send().await?;
        let status = r.status();
        let body = r.text().await?;
        if !status.is_success() {
            return Err(format!(
                "{} HTTP {}: {}",
                self.provider,
                status.as_u16(),
                body.chars().take(300).collect::<String>()
            )
            .into());
        }
        Ok(serde_json::from_str(&body)?)
    }

    async fn openai(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        schema: Option<&Value>,
    ) -> Result<String, Error> {
        let mut body =
            json!({"model": self.model, "max_tokens": self.max_tokens, "messages": Self::messages(system, user)});
        if schema.is_some() {
            body["response_format"] = json!({"type": "json_object"});
        }
        let req = http
            .post(format!("{}/chat/completions", self.base()))
            .bearer_auth(&self.api_key)
            .json(&body)
            .timeout(Duration::from_secs(600));
        let data = self.post(req).await?;
        let message = &data["choices"][0]["message"];
        let content = message["content"].as_str().unwrap_or_default().trim();
        if content.is_empty() {
            // Thinking models can spend the budget on reasoning: rescue a trailing JSON object from it.
            if let Some(c) = message["reasoning_content"]
                .as_str()
                .and_then(|r| TRAILING_OBJECT.captures(r))
            {
                return Ok(c[1].to_string());
            }
        }
        Ok(content.to_string())
    }

    /// Ollama's native `/api/chat` (PLAN §5): the OpenAI-compatible route runs with the server's default context and
    /// silently cuts long prompts; here `num_ctx` is sized to the prompt.
    async fn ollama(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        schema: Option<&Value>,
    ) -> Result<String, Error> {
        let mut body = json!({
            "model": self.model,
            "messages": Self::messages(system, user),
            "stream": false,
            "options": {"num_ctx": num_ctx(system, user), "num_predict": self.max_tokens},
        });
        if let Some(schema) = schema {
            body["format"] = schema.clone();
        }
        let base = self.base().trim_end_matches("/v1");
        let req = http
            .post(format!("{base}/api/chat"))
            .json(&body)
            .timeout(Duration::from_secs(600));
        let data = self.post(req).await?;
        let message = &data["message"];
        let content = message["content"].as_str().unwrap_or_default().trim();
        if content.is_empty()
            && let Some(c) = message["thinking"].as_str().and_then(|r| TRAILING_OBJECT.captures(r))
        {
            return Ok(c[1].to_string());
        }
        Ok(content.to_string())
    }

    async fn anthropic(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        schema: Option<&Value>,
    ) -> Result<String, Error> {
        let mut body = json!({
            "model": self.model, "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": user}],
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }
        if let Some(schema) = schema {
            body["tools"] = json!([{"name": "structured_output", "description": "Return structured data.", "input_schema": schema}]);
            body["tool_choice"] = json!({"type": "tool", "name": "structured_output"});
        }
        let req = http
            .post(format!("{}/v1/messages", self.base()))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .timeout(Duration::from_secs(600));
        let data = self.post(req).await?;
        let blocks = data["content"].as_array().cloned().unwrap_or_default();
        if schema.is_some()
            && let Some(b) = blocks
                .iter()
                .find(|b| b["type"] == "tool_use" && b["name"] == "structured_output")
        {
            return Ok(b["input"].to_string());
        }
        blocks
            .iter()
            .find_map(|b| b["text"].as_str())
            .map(|t| t.trim().to_string())
            .ok_or_else(|| "Anthropic returned no usable content block.".into())
    }

    async fn gemini(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        schema: Option<&Value>,
    ) -> Result<String, Error> {
        let mut config = json!({"maxOutputTokens": self.max_tokens});
        if schema.is_some() {
            config["responseMimeType"] = json!("application/json");
        }
        let mut body = json!({"contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": config});
        if !system.is_empty() {
            body["system_instruction"] = json!({"parts": [{"text": system}]});
        }
        let req = http
            .post(format!("{}/v1beta/models/{}:generateContent", self.base(), self.model))
            .header("x-goog-api-key", &self.api_key)
            .json(&body)
            .timeout(Duration::from_secs(600));
        let data = self.post(req).await?;
        let parts = data["candidates"][0]["content"]["parts"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        Ok(parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<String>()
            .trim()
            .to_string())
    }

    async fn cohere(
        &self,
        http: &reqwest::Client,
        system: &str,
        user: &str,
        schema: Option<&Value>,
    ) -> Result<String, Error> {
        let mut body =
            json!({"model": self.model, "messages": Self::messages(system, user), "max_tokens": self.max_tokens});
        if schema.is_some() {
            body["response_format"] = json!({"type": "json_object"});
        }
        let req = http
            .post(format!("{}/v2/chat", self.base()))
            .bearer_auth(&self.api_key)
            .json(&body)
            .timeout(Duration::from_secs(60));
        let data = self.post(req).await?;
        Ok(data["message"]["content"][0]["text"]
            .as_str()
            .or(data["text"].as_str())
            .unwrap_or_default()
            .trim()
            .to_string())
    }
}

// ── JSON helpers ────────────────────────────────────────────────────────────────────────────────

/// `_strip_fences`: trim, drop a leading ```lang line and a trailing ```.
pub fn strip_fences(text: &str) -> &str {
    static OPEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^```[a-zA-Z]*\n?").unwrap());
    let t = text.trim();
    let t = OPEN.find(t).map_or(t, |m| &t[m.end()..]);
    let t = t.strip_suffix("```").map_or(t, |s| s.strip_suffix('\n').unwrap_or(s));
    t.trim()
}

/// `clean_and_parse_json`: fences stripped, then the whole text, then the first `{` .. last `}` slice.
pub fn parse_json(raw: &str) -> Result<Value, Error> {
    let cleaned = strip_fences(raw);
    if let Ok(v) = serde_json::from_str(cleaned) {
        return Ok(v);
    }
    if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}'))
        && end > start
        && let Ok(v) = serde_json::from_str(&cleaned[start..=end])
    {
        return Ok(v);
    }
    let preview: String = raw.chars().take(500).collect();
    Err(format!(
        "LLM returned non-parseable JSON.\nPreview: {}",
        preview.replace('\n', "\\n")
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_render() {
        assert_eq!(
            format_named("a {x} {{lit}} }}{y}", &[("x", "1"), ("y", "{z}")]),
            "a 1 {lit} }{z}"
        );
        let user = render("suggest_keywords_user", &[("keywords", "rust, go")]);
        assert!(user.contains("rust, go") && !user.ends_with('\n'));
        assert!(
            load("interviewer_system").ends_with('\n'),
            "keeps its intentional trailing newline"
        );
    }

    #[test]
    fn json() {
        assert_eq!(strip_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(parse_json("```json\n{\"a\": 1}\n```").unwrap()["a"], 1);
        assert_eq!(parse_json("Sure! {\"a\": 2} hope it helps").unwrap()["a"], 2);
        assert!(parse_json("[1, 2]").unwrap().is_array());
        assert!(parse_json("nope").is_err());
    }

    #[test]
    fn resolution() {
        let cfg = Config::from_env();
        let c = LlmClient::new(&cfg, "openai", "", "", Some("http://localhost:11434"));
        assert_eq!(
            (c.model.as_str(), c.base()),
            ("gpt-4o-mini", "https://api.openai.com/v1")
        );
        let c = LlmClient::new(&cfg, "ollama", "qwen3:8b", "", Some("http://h:11434/"));
        assert_eq!((c.base(), c.api_key.as_str()), ("http://h:11434/v1", "local"));
        assert!(needs_semaphore("ollama", "qwen3:8b") && !needs_semaphore("ollama", "gpt-oss:120b-cloud"));
    }

    #[test]
    fn ollama_context_buckets() {
        assert_eq!(num_ctx("sys", &"x".repeat(9000)), 8192);
        assert_eq!(num_ctx("sys", &"x".repeat(30000)), 16384);
        assert_eq!(num_ctx("sys", &"x".repeat(500_000)), 32768);
    }

    /// Acceptance (PLAN §5 Ollama native API): `/api/chat` with a sized `num_ctx`, `/v1` stripped from the base URL.
    #[tokio::test]
    async fn ollama_native_chat() {
        use axum::{Json, Router, routing::post};
        use std::sync::{Arc, Mutex};

        let seen = Arc::new(Mutex::new(Value::Null));
        let store = seen.clone();
        let stub = Router::new().route(
            "/api/chat",
            post(move |Json(body): Json<Value>| async move {
                *store.lock().unwrap() = body;
                Json(json!({"message": {"role": "assistant", "content": " {\"ok\": true} "}, "done": true}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, stub).await });

        let cfg = Config::from_env();
        let llm = LlmClient::new(&cfg, "ollama", "gemma3:27b", "", Some(&base));
        let out = llm
            .complete(&reqwest::Client::new(), "system", &"y".repeat(30000), None)
            .await
            .unwrap();
        assert_eq!(out, "{\"ok\": true}");
        let body = seen.lock().unwrap().clone();
        assert_eq!(body["options"]["num_ctx"], 16384);
        assert_eq!(body["stream"], false);
        assert_eq!(body["messages"][0]["role"], "system");
    }
}
