//! RemoteOK and Arbeitnow public APIs. Port of `backend/services/extra_sources.py`.

use std::time::Duration;

use jumpship_core::{Job, matches_any};
use serde_json::Value;

use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pyint, pystr, s, thousands, unix_date};

pub async fn fetch_remoteok(
    client: &reqwest::Client,
    keywords: &[String],
    results_wanted: usize,
) -> Result<Vec<Job>, Error> {
    let jobs: Value = crate::polite::send(
        client
            .get("https://remoteok.com/api")
            .header("Accept", ACCEPT_JSON)
            .timeout(Duration::from_secs(12)),
    )
    .await?
    .error_for_status()?
    .json()
    .await?;
    Ok(parse_remoteok(&jobs, keywords, results_wanted))
}

fn salary(currency: &str, lo: Option<&Value>, hi: Option<&Value>) -> String {
    match (lo.map(pyint), hi.map(pyint)) {
        (Some(lo), Some(hi)) => format!("{currency} {} – {}", thousands(lo), thousands(hi)),
        (Some(lo), None) => format!("{currency} {}+", thousands(lo)),
        _ => String::new(),
    }
}

fn joined_tags(job: &Value) -> String {
    get(job, "tags")
        .and_then(Value::as_array)
        .map_or(String::new(), |t| t.iter().map(pystr).collect::<Vec<_>>().join(" "))
}

/// Normalize RemoteOK's decoded /api JSON (list; element 0 is a legal notice).
pub fn parse_remoteok(jobs: &Value, keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let mut results = Vec::new();
    for job in jobs.as_array().into_iter().flatten() {
        if !job.is_object() || get(job, "id").is_none() {
            continue;
        }
        let (title, desc) = (s(job, "position"), s(job, "description"));
        if !matches_any(keywords, &[&title, &joined_tags(job), &desc]) {
            continue;
        }
        let url = get(job, "url").map(pystr).unwrap_or_else(|| {
            format!(
                "https://remoteok.com/l/{}",
                job.get("slug").map_or(String::new(), pystr)
            )
        });
        results.push(Job {
            id: format!("rok_{}", pystr(&job["id"])),
            title,
            company: s(job, "company"),
            company_url: s(job, "company_logo"),
            location: "Remote".into(),
            job_type: "fulltime".into(),
            salary_range: salary("USD", get(job, "salary_min"), get(job, "salary_max")),
            posted_date: prefix(&s(job, "date"), 10),
            description: desc,
            url,
            site: "remoteok".into(),
            ..Job::default()
        });
        if results.len() >= results_wanted {
            break;
        }
    }
    results
}

const ARBEITNOW_API: &str = "https://www.arbeitnow.com/api/job-board-api";

pub async fn fetch_arbeitnow(
    client: &reqwest::Client,
    keywords: &[String],
    results_wanted: usize,
) -> Result<Vec<Job>, Error> {
    let search = keywords
        .iter()
        .take(4)
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    let get_page = |search: Option<&str>| {
        let mut req = client
            .get(ARBEITNOW_API)
            .header("Accept", ACCEPT_JSON)
            .timeout(Duration::from_secs(22))
            .query(&[("page", "1")]);
        if let Some(q) = search {
            req = req.query(&[("search", q)]);
        }
        async move { Ok::<Value, Error>(crate::polite::send(req).await?.error_for_status()?.json().await?) }
    };
    let mut data = get_page((!search.is_empty()).then_some(&*search)).await?;
    // If search returns nothing, fall back to the unfiltered feed (still keyword-filtered below).
    if !search.is_empty() && data["data"].as_array().is_none_or(Vec::is_empty) {
        data = get_page(None).await?;
    }
    Ok(parse_arbeitnow(&data, keywords, results_wanted))
}

/// Arbeitnow uses unix seconds for created_at; older payloads may use ISO strings.
fn iso_date_prefix(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Number(_)) => unix_date(pyint(v.unwrap())),
        Some(other) => prefix(&pystr(other), 10),
    }
}

/// Normalize Arbeitnow's decoded job-board-api JSON (`{"data": [...]}`).
pub fn parse_arbeitnow(data: &Value, keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let mut results = Vec::new();
    for job in data["data"].as_array().into_iter().flatten() {
        let (title, desc) = (s(job, "title"), s(job, "description"));
        if !matches_any(keywords, &[&title, &joined_tags(job), &desc]) {
            continue;
        }
        let location = get(job, "location").map(pystr).unwrap_or_else(|| {
            if get(job, "remote").is_some() {
                "Remote".into()
            } else {
                String::new()
            }
        });
        results.push(Job {
            id: format!("an_{}", md5_8(&s(job, "slug"))),
            title,
            company: s(job, "company_name"),
            location,
            job_type: "fulltime".into(),
            salary_range: salary("EUR", get(job, "salary_from"), get(job, "salary_to")),
            posted_date: iso_date_prefix(job.get("created_at")),
            description: desc,
            url: s(job, "url"),
            site: "arbeitnow".into(),
            ..Job::default()
        });
        if results.len() >= results_wanted {
            break;
        }
    }
    results
}
