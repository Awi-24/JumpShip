//! `backend/config.py` Settings: environment (plus `.env`, loaded by `main`) with the same names and defaults.

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub llm_provider: String,
    pub llm_model: String,
    /// `settings.ollama_base_url` without a trailing `/` (model discovery / test-llm use this one).
    pub ollama_base_url: String,
    /// `ollama_base_url()`: `OLLAMA_HOST` wins only when `OLLAMA_BASE_URL` is unset and it has a scheme.
    pub ollama_url: String,
    /// `LMSTUDIO_BASE_URL` or `http://localhost:1234`, without a trailing `/`.
    pub lmstudio_url: String,
    pub cors_origins: Vec<String>,
    pub secret_key: String,
    pub api_key: String,
    pub resume_gen_threshold: i64,
    pub resume_output_dir: String,
    pub database_url: String,
    pub debug: bool,
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok()
}

fn or(name: &str, default: &str) -> String {
    var(name).unwrap_or_else(|| default.to_string())
}

impl Config {
    pub fn from_env() -> Config {
        let ollama_base_url = or("OLLAMA_BASE_URL", "http://localhost:11434")
            .trim_end_matches('/')
            .to_string();
        let host = or("OLLAMA_HOST", "").trim().to_string();
        let ollama_url =
            if var("OLLAMA_BASE_URL").is_none() && (host.starts_with("http://") || host.starts_with("https://")) {
                host.trim_end_matches('/').to_string()
            } else {
                ollama_base_url.clone()
            };
        let lmstudio = or("LMSTUDIO_BASE_URL", "").trim().to_string();
        let lmstudio_url = if lmstudio.is_empty() {
            "http://localhost:1234".into()
        } else {
            lmstudio
        };
        Config {
            llm_provider: or("LLM_PROVIDER", "ollama"),
            llm_model: or("LLM_MODEL", "gemma3:27b"),
            ollama_base_url,
            ollama_url,
            lmstudio_url: lmstudio_url.trim_end_matches('/').to_string(),
            cors_origins: or(
                "CORS_ORIGINS",
                "http://localhost:5173,http://localhost:3000,http://localhost",
            )
            .split(',')
            .map(str::trim)
            .filter(|o| !o.is_empty())
            .map(String::from)
            .collect(),
            secret_key: or("SECRET_KEY", "dev-secret-change-me-in-production"),
            api_key: or("API_KEY", ""),
            resume_gen_threshold: var("RESUME_GEN_THRESHOLD")
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(70),
            resume_output_dir: or("RESUME_OUTPUT_DIR", "./generated_resumes"),
            database_url: or("DATABASE_URL", "sqlite:///./jobspy_ui.db"),
            debug: matches!(
                or("DEBUG", "").trim().to_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            ),
        }
    }
}
