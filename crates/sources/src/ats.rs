//! Company ATS boards from the source registry: Greenhouse, Lever, Workday.
//! Port of `backend/services/{greenhouse,lever,workday}_scraper.py` and `career_sources.py`.

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use futures::future::{BoxFuture, FutureExt};
use futures::{StreamExt, stream};
use jumpship_core::{Job, matches_any, rank};
use regex::Regex;
use serde_json::{Value, json};

use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pyint, pystr, s, unix_date};

static REGISTRY: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../backend/data/brazil-career-sources.json")).expect("source registry")
});

/// Registry sources with a matching ATS type and an `api` block.
pub fn sources_by_ats(ats: &str) -> Vec<&'static Value> {
    REGISTRY["sources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["ats"] == ats && get(s, "api").is_some())
        .collect()
}

/// Fetch every board with at most `concurrency` in flight; results keep registry order.
/// The futures are boxed and built up front: a closure stored in the stream trips rustc's higher-ranked `Send` check
/// when callers box `fetch_*` themselves (rust-lang/rust#102211).
async fn fetch_boards<'a, F>(boards: Vec<&'static Value>, concurrency: usize, fetch: F) -> Vec<Job>
where
    F: Fn(&'static Value) -> BoxFuture<'a, Vec<Job>>,
{
    // Futures are built before the stream so it holds no closure (see above).
    let futs: Vec<_> = boards.into_iter().map(fetch).collect();
    stream::iter(futs)
        .buffered(concurrency)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect()
}

// ── Greenhouse ──────────────────────────────────────────────────────────────────────────────────

static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

fn strip_html(text: &str) -> String {
    let unescaped = htmlize::unescape(text);
    WS.replace_all(&TAG.replace_all(&unescaped, " "), " ")
        .trim()
        .to_string()
}

/// Boards whose career pages embed Greenhouse but are listed as "custom" in the registry.
static GREENHOUSE_SUPPLEMENTAL: LazyLock<Vec<Value>> = LazyLock::new(|| {
    vec![
        json!({"id": "anthropic_jobs", "name": "Anthropic", "api": {"board_token": "anthropic"}}),
        json!({"id": "inter_carreiras", "name": "Banco Inter", "api": {"board_token": "inter"}}),
    ]
});

pub async fn fetch_greenhouse(client: &reqwest::Client, keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let boards = sources_by_ats("greenhouse")
        .into_iter()
        .chain(GREENHOUSE_SUPPLEMENTAL.iter())
        .collect();
    let mut jobs = fetch_boards(boards, 5, |src| {
        async move {
            let token = s(&src["api"], "board_token");
            let company = get(src, "name").map_or_else(|| token.clone(), pystr);
            let url = format!("https://boards-api.greenhouse.io/v1/boards/{token}/jobs");
            let res: Result<Value, Error> = async {
                let r = crate::polite::send(
                    client
                        .get(&url)
                        .query(&[("content", "true")])
                        .header("Accept", ACCEPT_JSON)
                        .timeout(Duration::from_secs(18)),
                )
                .await?;
                if r.status() == 404 {
                    return Ok(Value::Null);
                }
                Ok(r.error_for_status()?.json().await?)
            }
            .await;
            match res {
                Ok(data) => parse_greenhouse(&data, keywords, &company, &token),
                Err(e) => {
                    tracing::warn!("Greenhouse fetch failed ({token}): {e}");
                    vec![]
                }
            }
        }
        .boxed()
    })
    .await;
    rank(&mut jobs, keywords);
    jobs.truncate(results_wanted);
    jobs
}

/// Normalize one board's decoded Job Board API JSON (`{"jobs": [...]}`).
pub fn parse_greenhouse(data: &Value, keywords: &[String], company: &str, token: &str) -> Vec<Job> {
    let mut results = Vec::new();
    for job in data["jobs"].as_array().into_iter().flatten().filter(|j| j.is_object()) {
        let (title, desc) = (s(job, "title"), strip_html(&s(job, "content")));
        if !matches_any(keywords, &[&title, &desc]) {
            continue;
        }
        let location = get(job, "location").map_or(String::new(), |l| s(l, "name"));
        results.push(Job {
            id: format!(
                "gh_{}_{}",
                prefix(token, 6),
                md5_8(&job.get("id").map_or(String::new(), pystr))
            ),
            title,
            company: company.into(),
            location: if location.is_empty() { "Brasil".into() } else { location },
            job_type: "fulltime".into(),
            posted_date: prefix(&s(job, "updated_at"), 10),
            description: desc,
            url: s(job, "absolute_url"),
            site: "greenhouse".into(),
            ..Job::default()
        });
    }
    results
}

// ── Lever ───────────────────────────────────────────────────────────────────────────────────────

pub async fn fetch_lever(client: &reqwest::Client, keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let mut jobs = fetch_boards(sources_by_ats("lever"), 5, |src| {
        async move {
            let site = s(&src["api"], "site");
            let company = get(src, "name").map_or_else(|| site.clone(), pystr);
            let url = format!("https://api.lever.co/v0/postings/{site}?mode=json");
            let res: Result<Value, Error> = async {
                let r = crate::polite::send(
                    client
                        .get(&url)
                        .header("Accept", ACCEPT_JSON)
                        .timeout(Duration::from_secs(18)),
                )
                .await?;
                if r.status() == 404 {
                    return Ok(json!([]));
                }
                Ok(r.error_for_status()?.json().await?)
            }
            .await;
            match res {
                Ok(postings) => parse_lever(&postings, keywords, &company, &site),
                Err(e) => {
                    tracing::warn!("Lever fetch failed ({site}): {e}");
                    vec![]
                }
            }
        }
        .boxed()
    })
    .await;
    rank(&mut jobs, keywords);
    jobs.truncate(results_wanted);
    jobs
}

/// Normalize one board's decoded Postings API JSON (a list).
pub fn parse_lever(postings: &Value, keywords: &[String], company: &str, site: &str) -> Vec<Job> {
    let mut results = Vec::new();
    for p in postings.as_array().into_iter().flatten().filter(|p| p.is_object()) {
        let (title, desc) = (s(p, "text"), s(p, "descriptionPlain"));
        if !matches_any(keywords, &[&title, &desc]) {
            continue;
        }
        let cats = get(p, "categories").cloned().unwrap_or(Value::Null);
        let location = s(&cats, "location");
        let uid_src = get(p, "id").or(get(p, "text")).map(pystr).unwrap_or_default();
        results.push(Job {
            id: format!("lv_{}_{}", prefix(site, 6), md5_8(&uid_src)),
            title,
            company: company.into(),
            location: if location.is_empty() { "Brasil".into() } else { location },
            job_type: "fulltime".into(),
            posted_date: get(p, "createdAt").map_or(String::new(), |ms| unix_date(pyint(ms).div_euclid(1000))),
            description: desc,
            url: s(p, "hostedUrl"),
            site: "lever".into(),
            ..Job::default()
        });
    }
    results
}

// ── Workday ─────────────────────────────────────────────────────────────────────────────────────

/// (hostname, tenant, site) of a `https://<tenant>.wdN.myworkdayjobs.com/[locale/]<Site>` careers URL.
fn parse_workday_url(careers_url: &str) -> Option<(String, String, String)> {
    let url = reqwest::Url::parse(careers_url).ok()?;
    let host = url.host_str().filter(|h| h.contains("myworkdayjobs"))?.to_string();
    let tenant = host.split('.').next()?.to_string();
    let site = url.path_segments()?.rfind(|p| !p.is_empty())?.to_string();
    Some((host, tenant, site))
}

pub async fn fetch_workday(client: &reqwest::Client, keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let mut jobs = fetch_boards(sources_by_ats("workday"), 4, |src| {
        async move {
            let company = get(src, "name").map(pystr);
            workday_board(
                client,
                &s(&src["api"], "careers_url"),
                company,
                keywords,
                results_wanted,
            )
            .await
        }
        .boxed()
    })
    .await;
    rank(&mut jobs, keywords);
    jobs.truncate(results_wanted);
    jobs
}

/// One Workday board by its careers URL; `company` defaults to the tenant.
pub(crate) async fn workday_board(
    client: &reqwest::Client,
    careers_url: &str,
    company: Option<String>,
    keywords: &[String],
    results_wanted: usize,
) -> Vec<Job> {
    // One request per keyword (Workday ANDs the words of a single searchText); merged by externalPath.
    let mut terms: Vec<&str> = keywords
        .iter()
        .take(3)
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .collect();
    if terms.is_empty() {
        terms.push("");
    }
    let Some((host, tenant, site)) = parse_workday_url(careers_url) else {
        tracing::warn!("Workday: could not parse URL {careers_url}");
        return vec![];
    };
    let api_url = format!("https://{host}/wday/cxs/{tenant}/{site}/jobs");
    let mut payloads = Vec::new();
    for term in terms {
        let body = json!({"appliedFacets": {}, "limit": results_wanted.min(20), "offset": 0, "searchText": term});
        let res: Result<Option<Value>, Error> = async {
            let r = crate::polite::send(
                client
                    .post(&api_url)
                    .json(&body)
                    .header("Accept", ACCEPT_JSON)
                    .timeout(Duration::from_secs(20)),
            )
            .await?;
            if matches!(r.status().as_u16(), 403 | 404) {
                tracing::warn!("Workday board unreachable ({site}): HTTP {}", r.status());
                return Ok(None);
            }
            Ok(Some(r.error_for_status()?.json().await?))
        }
        .await;
        match res {
            Ok(Some(v)) => payloads.push(v),
            Ok(None) => break,
            Err(e) => tracing::warn!("Workday fetch failed ({site}, '{term}'): {e}"),
        }
    }
    let company = company.unwrap_or_else(|| tenant.clone());
    parse_workday(&payloads, &host, &tenant, &company)
}

/// Normalize Workday CXS /jobs JSON (`{"jobPostings": [...]}`; one response per keyword).
/// No local keyword filter: the server already matched `searchText`.
pub fn parse_workday(payloads: &[Value], hostname: &str, tenant: &str, company: &str) -> Vec<Job> {
    let mut seen = HashSet::new();
    let postings = payloads
        .iter()
        .flat_map(|d| d["jobPostings"].as_array().into_iter().flatten())
        .filter(|p| p.is_object())
        .filter(|p| {
            seen.insert(
                get(p, "externalPath")
                    .or(get(p, "title"))
                    .map(pystr)
                    .unwrap_or_default(),
            )
        });

    postings
        .map(|p| {
            let (ext_path, title) = (s(p, "externalPath"), s(p, "title"));
            let location = s(p, "locationsText");
            Job {
                id: format!(
                    "wd_{}_{}",
                    prefix(tenant, 6),
                    md5_8(if ext_path.is_empty() { &title } else { &ext_path })
                ),
                url: if ext_path.is_empty() {
                    String::new()
                } else {
                    format!("https://{hostname}{ext_path}")
                },
                title,
                company: company.into(),
                location: if location.is_empty() { "Brasil".into() } else { location },
                job_type: "fulltime".into(),
                site: "workday".into(),
                ..Job::default()
            }
        })
        .collect()
}
