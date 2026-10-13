//! Remote-job boards with public JSON APIs (PLAN §5 new sources): Remotive, Himalayas, Jobicy.
//! All three ask for attribution and a link to the posting: `site` names the board and `url` is its page.

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use jumpship_core::{Job, matches_any};
use serde_json::Value;

use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pyint, pystr, s, soup, terms, thousands, unix_date};

async fn get_json(client: &reqwest::Client, url: &str, query: &[(&str, &str)]) -> Result<Value, Error> {
    Ok(client
        .get(url)
        .header("Accept", ACCEPT_JSON)
        .query(query)
        .timeout(Duration::from_secs(15))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

/// Board job type → the app's `fulltime` / `parttime` / `contract` / `internship` / `temporary`.
fn job_type(raw: &str) -> String {
    let t: String = raw.to_lowercase().chars().filter(char::is_ascii_alphanumeric).collect();
    match t.as_str() {
        "fulltime" | "parttime" | "internship" | "temporary" | "contract" => t,
        "contractor" | "freelance" => "contract".into(),
        "intern" => "internship".into(),
        _ => "fulltime".into(),
    }
}

/// `"USD 120,000 – 150,000"` (+ `" / month"` etc. when not yearly).
fn salary(currency: &str, lo: Option<&Value>, hi: Option<&Value>, period: &str) -> String {
    let base = match (lo.map(pyint), hi.map(pyint)) {
        (Some(lo), Some(hi)) if lo != hi => format!("{currency} {} – {}", thousands(lo), thousands(hi)),
        (Some(n), _) | (None, Some(n)) => format!("{currency} {}", thousands(n)),
        _ => return String::new(),
    };
    let period = period.to_lowercase();
    match period.trim_end_matches("ly") {
        "" | "year" | "annual" => base,
        p => format!("{base} / {p}"),
    }
}

fn joined(v: Option<&Value>, sep: &str) -> String {
    match v {
        Some(Value::Array(a)) => a.iter().map(pystr).collect::<Vec<_>>().join(sep),
        Some(other) => pystr(other),
        None => String::new(),
    }
}

/// Collapse `"Argentina,  Canada,  UK"` → `"Argentina, Canada, UK"`; empty → `Remote`.
fn place(raw: &str) -> String {
    let parts: Vec<&str> = raw.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        "Remote".into()
    } else {
        parts.join(", ")
    }
}

fn remote_job(id: String, title: String, company: String, location: String, site: &str) -> Job {
    Job {
        id,
        title,
        company,
        location,
        site: site.into(),
        is_remote: Some(Some(true)),
        ..Job::default()
    }
}

// ── Remotive ────────────────────────────────────────────────────────────────────────────────────

/// Remotive asks for at most ~4 requests a day and its public feed is small (24 h delayed): fetch the whole
/// feed and keep it for 6 h, filtering locally.
static REMOTIVE: LazyLock<Mutex<Option<(Instant, Value)>>> = LazyLock::new(|| Mutex::new(None));
const REMOTIVE_TTL: Duration = Duration::from_secs(6 * 3600);

pub async fn fetch_remotive(client: &reqwest::Client, keywords: &[String], n: usize) -> Result<Vec<Job>, Error> {
    let cached = REMOTIVE
        .lock()
        .unwrap()
        .as_ref()
        .filter(|(t, _)| t.elapsed() < REMOTIVE_TTL)
        .map(|(_, v)| v.clone());
    let data = match cached {
        Some(v) => v,
        None => {
            let v = get_json(client, "https://remotive.com/api/remote-jobs", &[]).await?;
            *REMOTIVE.lock().unwrap() = Some((Instant::now(), v.clone()));
            v
        }
    };
    Ok(parse_remotive(&data, keywords, n))
}

pub fn parse_remotive(data: &Value, keywords: &[String], n: usize) -> Vec<Job> {
    let mut out = Vec::new();
    for j in data["jobs"].as_array().into_iter().flatten() {
        let (title, html) = (s(j, "title"), s(j, "description"));
        if !matches_any(keywords, &[&title, &joined(get(j, "tags"), " "), &html]) {
            continue;
        }
        let mut job = remote_job(
            format!("rmt_{}", s(j, "id")),
            title,
            s(j, "company_name").trim().into(),
            place(&s(j, "candidate_required_location")),
            "remotive",
        );
        job.company_url = s(j, "company_logo");
        job.job_type = job_type(&s(j, "job_type"));
        job.salary_range = s(j, "salary").trim().into();
        job.posted_date = prefix(&s(j, "publication_date"), 10);
        job.description = soup::markdown(&html);
        job.url = s(j, "url");
        out.push(job);
        if out.len() >= n {
            break;
        }
    }
    out
}

// ── Himalayas ───────────────────────────────────────────────────────────────────────────────────

/// One search page (max 20 jobs) per keyword, up to 3 keywords (the API is rate limited).
pub async fn fetch_himalayas(client: &reqwest::Client, keywords: &[String], n: usize) -> Result<Vec<Job>, Error> {
    let mut pages = Vec::new();
    let mut last_err = None;
    for t in terms(keywords, 3, "") {
        match get_json(
            client,
            "https://himalayas.app/jobs/api/search",
            &[("q", &t), ("page", "1")],
        )
        .await
        {
            Ok(v) => pages.push(v),
            Err(e) => last_err = Some(e),
        }
    }
    match last_err {
        Some(e) if pages.is_empty() => Err(e),
        _ => Ok(parse_himalayas(&pages, keywords, n)),
    }
}

pub fn parse_himalayas(pages: &[Value], keywords: &[String], n: usize) -> Vec<Job> {
    let mut out: Vec<Job> = Vec::new();
    for j in pages.iter().flat_map(|p| p["jobs"].as_array().into_iter().flatten()) {
        let (title, html) = (s(j, "title"), s(j, "description"));
        let url = get(j, "applicationLink")
            .or(get(j, "guid"))
            .map(pystr)
            .unwrap_or_default();
        let id = format!("hml_{}", md5_8(&url));
        if out.iter().any(|o| o.id == id)
            || !matches_any(keywords, &[&title, &joined(get(j, "categories"), " "), &html])
        {
            continue;
        }
        let mut job = remote_job(
            id,
            title,
            s(j, "companyName"),
            place(&joined(get(j, "locationRestrictions"), ", ")),
            "himalayas",
        );
        job.company_url = s(j, "companyLogo");
        job.job_type = job_type(&s(j, "employmentType"));
        job.salary_range = salary(
            &s(j, "currency"),
            get(j, "minSalary"),
            get(j, "maxSalary"),
            &s(j, "salaryPeriod"),
        );
        job.posted_date = get(j, "pubDate").map_or(String::new(), |d| unix_date(pyint(d)));
        job.description = soup::markdown(&html);
        job.url = url;
        out.push(job);
        if out.len() >= n {
            break;
        }
    }
    out
}

// ── Jobicy ──────────────────────────────────────────────────────────────────────────────────────

/// `tag` searches title + description; one request per keyword, up to 3.
pub async fn fetch_jobicy(client: &reqwest::Client, keywords: &[String], n: usize) -> Result<Vec<Job>, Error> {
    let mut pages = Vec::new();
    let mut last_err = None;
    let count = n.clamp(1, 100).to_string();
    for t in terms(keywords, 3, "") {
        let q = [("count", count.as_str()), ("tag", &t)];
        match get_json(client, "https://jobicy.com/api/v2/remote-jobs", &q).await {
            Ok(v) => pages.push(v),
            Err(e) => last_err = Some(e),
        }
    }
    match last_err {
        Some(e) if pages.is_empty() => Err(e),
        _ => Ok(parse_jobicy(&pages, keywords, n)),
    }
}

pub fn parse_jobicy(pages: &[Value], keywords: &[String], n: usize) -> Vec<Job> {
    let mut out: Vec<Job> = Vec::new();
    for j in pages.iter().flat_map(|p| p["jobs"].as_array().into_iter().flatten()) {
        let (title, html) = (s(j, "jobTitle"), s(j, "jobDescription"));
        let id = format!("jcy_{}", s(j, "id"));
        if out.iter().any(|o| o.id == id)
            || !matches_any(keywords, &[&title, &joined(get(j, "jobIndustry"), " "), &html])
        {
            continue;
        }
        let mut job = remote_job(id, title, s(j, "companyName"), place(&s(j, "jobGeo")), "jobicy");
        job.company_url = s(j, "companyLogo");
        job.job_type = job_type(&joined(get(j, "jobType"), ""));
        job.salary_range = salary(
            &s(j, "salaryCurrency"),
            get(j, "salaryMin"),
            get(j, "salaryMax"),
            &s(j, "salaryPeriod"),
        );
        job.posted_date = prefix(&s(j, "pubDate"), 10);
        job.description = soup::markdown(&html);
        job.url = s(j, "url");
        out.push(job);
        if out.len() >= n {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn kw(k: &str) -> Vec<String> {
        vec![k.into()]
    }

    #[test]
    fn remotive() {
        let data = json!({"jobs": [
            {"id": 1, "url": "https://remotive.com/remote-jobs/dev/rust-1", "title": "Rust Engineer",
             "company_name": "Acme ", "tags": ["rust"], "job_type": "full_time",
             "publication_date": "2026-10-11T20:17:27", "candidate_required_location": "Worldwide",
             "salary": "$100k", "description": "<p>Build <b>things</b></p>"},
            {"id": 2, "title": "Office Assistant", "description": "<p>Excel</p>"}
        ]});
        let jobs = parse_remotive(&data, &kw("rust"), 10);
        assert_eq!(jobs.len(), 1);
        let j = &jobs[0];
        assert_eq!(
            (j.id.as_str(), j.company.as_str(), j.location.as_str()),
            ("rmt_1", "Acme", "Worldwide")
        );
        assert_eq!(
            (j.job_type.as_str(), j.posted_date.as_str()),
            ("fulltime", "2026-10-11")
        );
        assert_eq!(j.description, "Build **things**");
        assert_eq!(j.is_remote, Some(Some(true)));
    }

    #[test]
    fn himalayas() {
        let job = json!({"title": "Rust Developer", "companyName": "Neon", "employmentType": "Contractor",
            "minSalary": 90000, "maxSalary": 120000, "currency": "EUR", "salaryPeriod": "annual",
            "locationRestrictions": ["Portugal", "Spain"], "categories": ["Rust-Developer"],
            "description": "<h3>Role</h3>", "pubDate": "1791341968",
            "applicationLink": "https://himalayas.app/companies/neon/jobs/rust", "guid": "x"});
        // The same posting on two keyword pages is kept once.
        let pages = [json!({"jobs": [job.clone()]}), json!({"jobs": [job]})];
        let jobs = parse_himalayas(&pages, &kw("rust"), 10);
        assert_eq!(jobs.len(), 1);
        let j = &jobs[0];
        assert_eq!(j.location, "Portugal, Spain");
        assert_eq!(j.job_type, "contract");
        assert_eq!(j.salary_range, "EUR 90,000 – 120,000");
        assert_eq!(j.posted_date, "2026-10-07");
        assert_eq!(j.url, "https://himalayas.app/companies/neon/jobs/rust");
    }

    #[test]
    fn jobicy() {
        let pages = [json!({"jobs": [
            {"id": 7, "url": "https://jobicy.com/jobs/7-dev", "jobTitle": "Python Developer", "companyName": "Co",
             "jobType": ["Full-Time"], "jobGeo": "Argentina,  Canada,  UK", "salaryMin": 5000, "salaryMax": 6000,
             "salaryCurrency": "USD", "salaryPeriod": "monthly", "pubDate": "2026-10-13T11:55:02+00:00",
             "jobDescription": "<p>Django</p>"}
        ]})];
        let jobs = parse_jobicy(&pages, &kw("python"), 10);
        let j = &jobs[0];
        assert_eq!(j.location, "Argentina, Canada, UK");
        assert_eq!(j.salary_range, "USD 5,000 – 6,000 / month");
        assert_eq!(
            (j.posted_date.as_str(), j.job_type.as_str()),
            ("2026-10-13", "fulltime")
        );
        assert!(parse_jobicy(&pages, &kw("golang"), 10).is_empty());
    }
}
