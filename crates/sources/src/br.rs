//! Brazilian boards: Gupy, Programathor, Trampos. Port of `backend/services/br_sources.py`.

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use jumpship_core::{Job, matches_any};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde_json::Value;

use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pystr, s, terms};

const ACCEPT_HTML: &str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_LANGUAGE: &str = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7";
const MAX_TERMS: usize = 4; // one request per keyword; keep it polite

/// Python `str.strip(", ")`.
fn strip_comma_space(s: &str) -> &str {
    s.trim_matches([',', ' '])
}

/// Dedupe rows by `str(row["id"])`, keeping the first occurrence and the original order.
fn rows_by_id<'a>(rows: impl Iterator<Item = &'a Value>) -> Vec<(String, &'a Value)> {
    let mut seen = HashSet::new();
    rows.filter(|r| r.is_object() && !r["id"].is_null())
        .map(|r| (pystr(&r["id"]), r))
        .filter(|(id, _)| seen.insert(id.clone()))
        .collect()
}

// ── Gupy ────────────────────────────────────────────────────────────────────────────────────────

static GUPY_NEXT_DATA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?s)<script id="__NEXT_DATA__"[^>]*>(.*?)</script>"#).unwrap());
/// Python `urllib.parse.quote(s, safe="")`.
const QUOTE: &AsciiSet = &NON_ALPHANUMERIC.remove(b'_').remove(b'.').remove(b'-').remove(b'~');

/// `props.pageProps` of the `__NEXT_DATA__` JSON embedded in a portal.gupy.io search page.
pub fn extract_gupy_next_data(html: &str) -> Result<Value, Error> {
    let m = GUPY_NEXT_DATA.captures(html).ok_or("gupy: no __NEXT_DATA__")?;
    let mut data: Value = serde_json::from_str(&m[1])?;
    let pp = data["props"]["pageProps"].take();
    // Shape check: the caller retries when the page came back without a job list.
    pp.get("initialJobList")
        .and_then(|l| l.get("data"))
        .ok_or("gupy: page has no initialJobList")?;
    Ok(pp)
}

/// One portal.gupy.io search page (12 items; pagination is ignored by the site) → pageProps.
async fn gupy_query(client: &reqwest::Client, term: &str, remote: bool) -> Result<Value, Error> {
    let mut url = format!(
        "https://portal.gupy.io/job-search/term={}",
        utf8_percent_encode(&prefix(term, 200), QUOTE)
    );
    if remote {
        url.push_str("&workplaceTypes[]=remote");
    }
    let mut attempt = 1;
    loop {
        let res = async {
            let r = client
                .get(&url)
                .header("Accept", ACCEPT_HTML)
                .header("Accept-Language", ACCEPT_LANGUAGE)
                .timeout(Duration::from_secs(18))
                .send()
                .await?
                .error_for_status()?;
            extract_gupy_next_data(&r.text().await?)
        }
        .await;
        match res {
            Err(_) if attempt == 1 => {
                attempt = 2;
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            other => return other,
        }
    }
}

/// One sequential query per keyword (Gupy resets connections after a quick burst), deduped by id.
pub async fn fetch_gupy(
    client: &reqwest::Client,
    keywords: &[String],
    results_wanted: usize,
    remote: bool,
) -> Result<Vec<Job>, Error> {
    let mut pages = Vec::new();
    let mut last_err = None;
    for (i, term) in terms(keywords, MAX_TERMS, "desenvolvedor").iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        match gupy_query(client, term, remote).await {
            Ok(pp) => pages.push(pp),
            Err(e) => {
                tracing::warn!("Gupy query '{term}' failed: {e}");
                last_err = Some(e);
            }
        }
    }
    if let Some(e) = last_err
        && !pages.iter().any(|pp| get(&pp["initialJobList"], "data").is_some())
    {
        return Err(e);
    }
    Ok(parse_gupy(&pages, keywords, results_wanted))
}

/// Normalize Gupy pageProps (the pages of one or several keyword queries).
pub fn parse_gupy(pages: &[Value], keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let rows = rows_by_id(
        pages
            .iter()
            .flat_map(|pp| pp["initialJobList"]["data"].as_array().into_iter().flatten()),
    );
    let mut results = Vec::new();
    for (jid, job) in rows {
        let (title, desc) = (s(job, "name"), s(job, "description"));
        if !matches_any(keywords, &[&title, &desc]) {
            continue;
        }
        let wp = s(job, "workplaceType").to_lowercase();
        let location = if wp == "remote" {
            "Remoto, Brasil".into()
        } else {
            let (city, state) = (s(job, "city"), s(job, "state"));
            if city.is_empty() && state.is_empty() {
                "Brasil".into()
            } else {
                strip_comma_space(&format!("{city}, {state}")).to_string()
            }
        };
        let job_type = match s(job, "type").to_lowercase().as_str() {
            "part_time" | "apprenticeship" => "parttime",
            "internship" => "internship",
            "temporary" | "freelancer" => "contract",
            _ => "fulltime",
        };
        let (is_remote, tags) = match wp.as_str() {
            "remote" => (Some(Some(true)), vec![]),
            "hybrid" => (Some(None), vec!["hybrid".to_string()]),
            "" => (None, vec![]),
            _ => (Some(Some(false)), vec![]),
        };
        results.push(Job {
            id: format!("gupy_{}", md5_8(&jid)),
            title,
            company: s(job, "careerPageName"),
            company_url: get(job, "careerPageUrl")
                .or(get(job, "careerPageLogo"))
                .map(pystr)
                .unwrap_or_default(),
            location,
            job_type: job_type.into(),
            posted_date: prefix(&s(job, "publishedDate"), 10),
            description: desc,
            url: s(job, "jobUrl"),
            site: "gupy".into(),
            is_remote,
            tags,
            ..Job::default()
        });
        if results.len() >= results_wanted {
            break;
        }
    }
    results
}

// ── Programathor ────────────────────────────────────────────────────────────────────────────────

/// One raw card of a Programathor /jobs listing page.
#[derive(Debug, Clone)]
pub struct Listing {
    pub title: String,
    pub company: String,
    pub location: String,
    pub description: String,
    pub url: String,
    pub href: String,
}

fn sel(css: &str) -> Selector {
    Selector::parse(css).unwrap()
}

/// BeautifulSoup `el.get_text(" ", strip=True)`.
fn text(el: ElementRef) -> String {
    el.text()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

static PT_HREF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^/jobs/\d+-").unwrap());
static PT_NOVA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*NOVA\s*$").unwrap());

/// Raw cards of one /jobs listing page (unfiltered).
pub fn parse_programathor_listing(html: &str) -> Vec<Listing> {
    static CARD: LazyLock<Selector> = LazyLock::new(|| sel(r#"a[href^="/jobs/"]"#));
    static H3: LazyLock<Selector> = LazyLock::new(|| sel("h3"));
    static SPAN: LazyLock<Selector> = LazyLock::new(|| sel(".cell-list-content-icon span, .cell-list-content span"));
    static ICON: LazyLock<Selector> = LazyLock::new(|| sel("i"));
    static TAG: LazyLock<Selector> = LazyLock::new(|| sel(".tag-list"));

    let doc = Html::parse_document(html);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for a in doc.select(&CARD) {
        let href = a.value().attr("href").unwrap_or("").trim().to_string();
        if !PT_HREF.is_match(&href) || !seen.insert(href.clone()) {
            continue;
        }
        let title = a.select(&H3).next().map(text).unwrap_or_default();
        let title = PT_NOVA.replace(&title, "").trim().to_string();

        let (mut company, mut location) = (String::new(), String::new());
        for span in a.select(&SPAN) {
            let raw = text(span);
            let icon = span.select(&ICON).next().map(|i| i.html()).unwrap_or_default();
            if icon.contains("briefcase") && company.is_empty() {
                company = raw;
            } else if icon.contains("map-marker") && location.is_empty() {
                location = raw;
            }
        }
        let skills: Vec<String> = a
            .select(&TAG)
            .map(|t| t.text().map(str::trim).collect::<String>())
            .filter(|t| !t.is_empty())
            .collect();

        out.push(Listing {
            title,
            company,
            location: if location.is_empty() { "Brasil".into() } else { location },
            description: skills.join(" "),
            url: format!("https://programathor.com.br{href}"),
            href,
        });
    }
    out
}

/// Scrape Programathor /jobs listings (paginated, newest first).
pub async fn fetch_programathor(
    client: &reqwest::Client,
    keywords: &[String],
    results_wanted: usize,
) -> Result<Vec<Job>, Error> {
    let max_pages = (results_wanted / 8 + 3).clamp(3, 15);
    let mut pages = Vec::new();
    for page in 1..=max_pages {
        let mut req = client
            .get("https://programathor.com.br/jobs")
            .header("Accept", ACCEPT_HTML)
            .header("Accept-Language", ACCEPT_LANGUAGE)
            .timeout(Duration::from_secs(20));
        if page > 1 {
            req = req.query(&[("page", page)]);
        }
        let html = req.send().await?.error_for_status()?.text().await?;
        let n = parse_programathor_listing(&html).len();
        if n == 0 {
            break;
        }
        pages.push(html);
        if n < 5 {
            break;
        }
    }
    Ok(parse_programathor(&pages, keywords, results_wanted))
}

/// Normalize Programathor listing pages (in order).
pub fn parse_programathor<S: AsRef<str>>(pages: &[S], keywords: &[String], results_wanted: usize) -> Vec<Job> {
    let mut results = Vec::new();
    for job in pages.iter().flat_map(|p| parse_programathor_listing(p.as_ref())) {
        if !matches_any(keywords, &[&job.title, &job.description, &job.company]) {
            continue;
        }
        let key = [&job.href, &job.url, &job.title]
            .into_iter()
            .find(|s| !s.is_empty())
            .cloned()
            .unwrap_or_default();
        results.push(Job {
            id: format!("pt_{}", md5_8(&key)),
            title: job.title,
            company: job.company,
            location: job.location,
            job_type: "fulltime".into(),
            description: job.description,
            url: job.url,
            site: "programathor".into(),
            ..Job::default()
        });
        if results.len() >= results_wanted {
            break;
        }
    }
    results
}

// ── Trampos ─────────────────────────────────────────────────────────────────────────────────────

/// One query per keyword against the v2 search endpoint, deduped by id.
pub async fn fetch_trampos(
    client: &reqwest::Client,
    keywords: &[String],
    results_wanted: usize,
) -> Result<Vec<Job>, Error> {
    let mut payloads = Vec::new();
    let mut last_err: Option<Error> = None;
    for term in terms(keywords, MAX_TERMS, "desenvolvedor") {
        let res: Result<Value, Error> = async {
            Ok(client
                .get("https://trampos.co/api/v2/opportunities")
                .query(&[("tr", &term)])
                .header("Accept", ACCEPT_JSON)
                .timeout(Duration::from_secs(18))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?)
        }
        .await;
        match res {
            Ok(v) => payloads.push(v),
            Err(e) => {
                tracing::warn!("Trampos query '{term}' failed: {e}");
                last_err = Some(e);
            }
        }
    }
    if let Some(e) = last_err
        && !payloads.iter().any(|d| get(d, "opportunities").is_some())
    {
        return Err(e);
    }
    Ok(parse_trampos(&payloads, results_wanted))
}

/// Normalize Trampos v2 search JSON (`{"opportunities": [...]}`; one response per keyword).
/// No local keyword filter: the server matches the term against descriptions too.
pub fn parse_trampos(payloads: &[Value], results_wanted: usize) -> Vec<Job> {
    let rows = rows_by_id(
        payloads
            .iter()
            .flat_map(|d| d["opportunities"].as_array().into_iter().flatten()),
    );
    let mut results = Vec::new();
    for (jid, job) in rows {
        let company_obj = get(job, "company").cloned().unwrap_or(Value::Null);
        let company = get(job, "custom_company_name")
            .or(get(&company_obj, "name"))
            .map(pystr)
            .unwrap_or_default();
        let (city, state) = (s(job, "city"), s(job, "state"));
        let home_office = get(job, "home_office").is_some();
        let location = if !city.is_empty() || !state.is_empty() {
            strip_comma_space(&format!("{city}, {state}")).to_string()
        } else if home_office {
            "Remoto, Brasil".into()
        } else {
            "Brasil".into()
        };
        let job_type = match s(job, "type_slug").as_str() {
            "estagio" | "trainee" => "internship",
            "freelance" => "contract",
            _ => "fulltime",
        };
        let (is_remote, tags) = if home_office {
            (Some(Some(true)), vec![])
        } else if get(job, "hybrid").is_some() {
            (Some(None), vec!["hybrid".to_string()])
        } else {
            (None, vec![])
        };
        results.push(Job {
            id: format!("trampos_{}", md5_8(&jid)),
            title: s(job, "name"),
            company,
            company_url: s(&company_obj, "url"),
            location,
            job_type: job_type.into(),
            salary_range: s(job, "salary"),
            posted_date: prefix(&s(job, "published_at"), 10),
            description: s(job, "category_name"),
            url: format!("https://trampos.co/oportunidades/{jid}"),
            site: "trampos".into(),
            is_remote,
            tags,
            ..Job::default()
        });
        if results.len() >= results_wanted {
            break;
        }
    }
    results
}
