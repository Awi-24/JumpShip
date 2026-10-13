//! `backend/services/web_search.py`: keyless DuckDuckGo snippets (Instant Answer API, Lite HTML fallback).

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::Value;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async fn instant(http: &reqwest::Client, q: &str) -> Vec<String> {
    let res = async {
        let r = http
            .get("https://api.duckduckgo.com/")
            .query(&[("q", q), ("format", "json"), ("no_html", "1"), ("skip_disambig", "1")])
            .header("User-Agent", UA)
            .header("Accept-Language", "en-US,en;q=0.9")
            .timeout(Duration::from_secs(5))
            .send()
            .await?;
        r.json::<Value>().await
    }
    .await;
    let data = match res {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("DDG instant failed for {q:?}: {e}");
            return vec![];
        }
    };
    let mut out = Vec::new();
    if let Some(a) = data["Abstract"].as_str().filter(|a| !a.is_empty()) {
        out.push(a.trim().to_string());
    }
    for t in data["RelatedTopics"].as_array().into_iter().flatten().take(3) {
        if let Some(text) = t["Text"].as_str().filter(|t| !t.is_empty()) {
            out.push(text.trim().to_string());
        }
    }
    out
}

/// Snippets of `<td class="result-snippet">` (else every `<td>`), tags dropped, longer than 40 chars.
pub fn lite_snippets(html: &str) -> Vec<String> {
    static SNIPPET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?si)class=["']result-snippet["'][^>]*>(.*?)</td>"#).unwrap());
    static TD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<td[^>]*>(.*?)</td>").unwrap());
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
    static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
    let mut raw: Vec<&str> = SNIPPET
        .captures_iter(html)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    if raw.is_empty() {
        raw = TD.captures_iter(html).map(|c| c.get(1).unwrap().as_str()).collect();
    }
    raw.into_iter()
        .take(6)
        .map(|chunk| WS.replace_all(TAG.replace_all(chunk, "").trim(), " ").into_owned())
        .filter(|t| t.chars().count() > 40)
        .collect()
}

async fn lite(http: &reqwest::Client, q: &str) -> Vec<String> {
    let res = async {
        http.get("https://lite.duckduckgo.com/lite/")
            .query(&[("q", q)])
            .header("User-Agent", UA)
            .header("Accept-Language", "en-US,en;q=0.9")
            .timeout(Duration::from_secs(6))
            .send()
            .await?
            .text()
            .await
    }
    .await;
    match res {
        Ok(html) => lite_snippets(&html),
        Err(e) => {
            tracing::warn!("DDG lite failed for {q:?}: {e}");
            vec![]
        }
    }
}

/// Up to 5 distinct snippets for the queries (stops once 4 are collected).
async fn snippets(http: &reqwest::Client, queries: [String; 2]) -> String {
    let mut all: Vec<String> = Vec::new();
    for q in &queries {
        let mut s = instant(http, q).await;
        if s.is_empty() {
            s = lite(http, q).await;
        }
        all.extend(s);
        if all.len() >= 4 {
            break;
        }
    }
    let mut unique: Vec<String> = Vec::new();
    for s in all {
        if !unique.contains(&s) {
            unique.push(s);
        }
    }
    unique.truncate(5);
    unique.join("\n")
}

pub async fn company_info(http: &reqwest::Client, company: &str, job_title: &str) -> String {
    snippets(
        http,
        [
            format!("{company} company employee reviews work culture glassdoor"),
            format!("{company} {job_title} average salary compensation")
                .trim()
                .to_string(),
        ],
    )
    .await
}

pub async fn interview_process(http: &reqwest::Client, company: &str, job_title: &str) -> String {
    snippets(
        http,
        [
            format!("{company} {job_title} interview process questions glassdoor")
                .trim()
                .to_string(),
            format!("{company} technical interview coding assessment hiring"),
        ],
    )
    .await
}
