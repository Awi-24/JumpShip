//! Company job boards outside the registry (PLAN §5 new sources): Amazon, Ashby, SmartRecruiters.
//! Endpoints and company lists verified live 2026-10-13.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use futures::future::FutureExt;
use futures::{StreamExt, stream};
use jumpship_core::{Job, matches_any, rank, relevance};
use serde_json::Value;

use crate::remote::{job_type, place};
use crate::search::{Resolved, location_matches};
use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pystr, s, soup, terms};

async fn get_json(client: &reqwest::Client, url: &str, query: &[(&str, String)]) -> Result<Value, Error> {
    Ok(crate::polite::send(
        client
            .get(url)
            .header("Accept", ACCEPT_JSON)
            .query(query)
            .timeout(Duration::from_secs(20)),
    )
    .await?
    .error_for_status()?
    .json()
    .await?)
}

/// `Resolved::country_key` → (ISO 3166 alpha-2, alpha-3).
fn iso(country_key: &str) -> Option<(&'static str, &'static str)> {
    Some(match country_key {
        "brazil" => ("br", "BRA"),
        "usa" => ("us", "USA"),
        "canada" => ("ca", "CAN"),
        "uk" => ("gb", "GBR"),
        "germany" => ("de", "DEU"),
        "france" => ("fr", "FRA"),
        "spain" => ("es", "ESP"),
        "portugal" => ("pt", "PRT"),
        "netherlands" => ("nl", "NLD"),
        "ireland" => ("ie", "IRL"),
        "switzerland" => ("ch", "CHE"),
        "sweden" => ("se", "SWE"),
        "poland" => ("pl", "POL"),
        "mexico" => ("mx", "MEX"),
        "argentina" => ("ar", "ARG"),
        "colombia" => ("co", "COL"),
        "chile" => ("cl", "CHL"),
        "australia" => ("au", "AUS"),
        "india" => ("in", "IND"),
        "japan" => ("jp", "JPN"),
        "singapore" => ("sg", "SGP"),
        "italy" => ("it", "ITA"),
        "austria" => ("at", "AUT"),
        "belgium" => ("be", "BEL"),
        "norway" => ("no", "NOR"),
        "denmark" => ("dk", "DNK"),
        "finland" => ("fi", "FIN"),
        "israel" => ("il", "ISR"),
        "china" => ("cn", "CHN"),
        "peru" => ("pe", "PER"),
        "uruguay" => ("uy", "URY"),
        "venezuela" => ("ve", "VEN"),
        "ecuador" => ("ec", "ECU"),
        "costa rica" => ("cr", "CRI"),
        "panama" => ("pa", "PAN"),
        "new zealand" => ("nz", "NZL"),
        "south africa" => ("za", "ZAF"),
        "turkey" => ("tr", "TUR"),
        "ukraine" => ("ua", "UKR"),
        "romania" => ("ro", "ROU"),
        "greece" => ("gr", "GRC"),
        "hungary" => ("hu", "HUN"),
        "czech republic" => ("cz", "CZE"),
        "hong kong" => ("hk", "HKG"),
        "indonesia" => ("id", "IDN"),
        "philippines" => ("ph", "PHL"),
        "vietnam" => ("vn", "VNM"),
        "thailand" => ("th", "THA"),
        "malaysia" => ("my", "MYS"),
        "south korea" => ("kr", "KOR"),
        "united arab emirates" => ("ae", "ARE"),
        _ => return None,
    })
}

/// Work mode from a board's flags: hybrid → the `hybrid` tag `enrich` understands; otherwise an explicit
/// remote / on-site flag (`None` leaves it to `enrich`'s inference from location and description).
fn work_mode(job: &mut Job, remote: Option<bool>, hybrid: bool) {
    if hybrid {
        job.tags = Some(vec!["hybrid".into()]);
    } else if remote.is_some() {
        job.is_remote = Some(remote);
    }
}

// ── Amazon ──────────────────────────────────────────────────────────────────────────────────────

/// amazon.jobs search: one request per keyword (up to 3), filtered server-side by country when the search has one.
pub async fn fetch_amazon(
    client: &reqwest::Client,
    keywords: &[String],
    n: usize,
    country_key: &str,
) -> Result<Vec<Job>, Error> {
    let mut pages = Vec::new();
    let mut last_err = None;
    for t in terms(keywords, 3, "") {
        let mut q = vec![
            ("base_query", t),
            ("result_limit", n.clamp(1, 100).to_string()),
            ("offset", "0".into()),
            ("sort", "recent".into()),
        ];
        if let Some((_, iso3)) = iso(country_key) {
            q.push(("normalized_country_code[]", iso3.into()));
        }
        match get_json(client, "https://www.amazon.jobs/en/search.json", &q).await {
            Ok(v) => pages.push(v),
            Err(e) => last_err = Some(e),
        }
    }
    match last_err {
        Some(e) if pages.is_empty() => Err(e),
        _ => Ok(parse_amazon(&pages, keywords, n)),
    }
}

pub fn parse_amazon(pages: &[Value], keywords: &[String], n: usize) -> Vec<Job> {
    let mut out: Vec<Job> = Vec::new();
    for j in pages.iter().flat_map(|p| p["jobs"].as_array().into_iter().flatten()) {
        let id = format!("amz_{}", s(j, "id_icims"));
        let html = ["description", "basic_qualifications", "preferred_qualifications"]
            .iter()
            .map(|k| s(j, k))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("<br/><br/>");
        let title = s(j, "title");
        if out.iter().any(|o| o.id == id) || !matches_any(keywords, &[&title, &html]) {
            continue;
        }
        let company = s(j, "company_name");
        out.push(Job {
            id,
            title,
            company: if company.is_empty() { "Amazon".into() } else { company },
            location: s(j, "normalized_location"),
            job_type: job_type(&s(j, "job_schedule_type")),
            // "October 13, 2026"
            posted_date: chrono::NaiveDate::parse_from_str(&s(j, "posted_date"), "%B %d, %Y")
                .map_or(String::new(), |d| d.to_string()),
            description: soup::markdown(&html),
            url: format!("https://www.amazon.jobs{}", s(j, "job_path")),
            site: "amazon".into(),
            ..Job::default()
        });
        if out.len() >= n {
            break;
        }
    }
    out
}

// ── Ashby ───────────────────────────────────────────────────────────────────────────────────────

/// Ashby has no cross-company search: boards of remote-friendly companies.
// ponytail: hand-picked list; move to the source registry when it grows.
const ASHBY_ORGS: &[(&str, &str)] = &[
    ("openai", "OpenAI"),
    ("notion", "Notion"),
    ("linear", "Linear"),
    ("supabase", "Supabase"),
    ("Ramp", "Ramp"),
    ("cohere", "Cohere"),
    ("perplexity", "Perplexity"),
    ("harvey", "Harvey"),
];
const ASHBY_TTL: Duration = Duration::from_secs(3600);
/// A board is the whole company (OpenAI's is ~14 MB of JSON): keep its parsed jobs for an hour.
type Boards = HashMap<&'static str, (Instant, Vec<Job>)>;
static ASHBY: LazyLock<Mutex<Boards>> = LazyLock::new(Default::default);

async fn ashby_board(client: &reqwest::Client, org: &'static str, company: &str) -> Vec<Job> {
    if let Some((at, jobs)) = ASHBY.lock().unwrap().get(org)
        && at.elapsed() < ASHBY_TTL
    {
        return jobs.clone();
    }
    let url = format!("https://api.ashbyhq.com/posting-api/job-board/{org}");
    match get_json(client, &url, &[("includeCompensation", "true".into())]).await {
        Ok(data) => {
            let jobs = parse_ashby(&data, company, org);
            ASHBY.lock().unwrap().insert(org, (Instant::now(), jobs.clone()));
            jobs
        }
        Err(e) => {
            tracing::warn!("Ashby fetch failed ({org}): {e}");
            vec![]
        }
    }
}

/// Boards are whole companies: keyword and location filters run here, before the cap.
pub async fn fetch_ashby(client: &reqwest::Client, keywords: &[String], n: usize, resolved: &Resolved) -> Vec<Job> {
    let futs: Vec<_> = ASHBY_ORGS
        .iter()
        .map(|(org, company)| ashby_board(client, org, company).boxed())
        .collect();
    let mut jobs: Vec<Job> = stream::iter(futs)
        .buffered(4)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .filter(|j| matches_any(keywords, &[&j.title, &j.description]))
        .filter(|j| location_matches(&j.location, resolved, j.is_remote.flatten()))
        .collect();
    rank(&mut jobs, keywords);
    jobs.truncate(n);
    jobs
}

/// Every listed job of one board's posting-api JSON (`{"jobs": [...]}`).
pub fn parse_ashby(data: &Value, company: &str, org: &str) -> Vec<Job> {
    let mut out = Vec::new();
    for j in data["jobs"].as_array().into_iter().flatten() {
        if j["isListed"] == false {
            continue;
        }
        let mut places = vec![s(j, "location")];
        places.extend(
            j["secondaryLocations"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|l| s(l, "location")),
        );
        let workplace = s(j, "workplaceType");
        let mut job = Job {
            id: format!("ash_{}_{}", prefix(org, 6), md5_8(&s(j, "id"))),
            title: s(j, "title"),
            company: company.into(),
            location: place(&places.join(", ")),
            job_type: job_type(&s(j, "employmentType")),
            salary_range: s(&j["compensation"], "scrapeableCompensationSalarySummary"),
            posted_date: prefix(&s(j, "publishedAt"), 10),
            description: s(j, "descriptionPlain"),
            url: s(j, "jobUrl"),
            site: "ashby".into(),
            ..Job::default()
        };
        // workplaceType wins: OpenAI flags 500 hybrid jobs `isRemote: true`.
        let remote = match workplace.as_str() {
            "Remote" => Some(true),
            "OnSite" => Some(false),
            _ => j["isRemote"].as_bool(),
        };
        work_mode(&mut job, remote, workplace == "Hybrid");
        out.push(job);
    }
    out
}

// ── SmartRecruiters ─────────────────────────────────────────────────────────────────────────────

/// Companies with public SmartRecruiters boards (several with many jobs in Brazil).
// ponytail: hand-picked list; move to the source registry when it grows.
const SMARTRECRUITERS: &[&str] = &[
    "BoschGroup",
    "Experian",
    "Accor",
    "Eurofins",
    "Continental",
    "Abbvie",
    "AveryDennison",
    "ServiceNow",
    "Visa",
    "Endava",
    "Devoteam",
    "WesternDigital",
    "Ubisoft2",
];

/// Postings API: `q` per keyword (up to 3) and `country` server-side; then one detail call per kept posting
/// for the description.
pub async fn fetch_smartrecruiters(
    client: &reqwest::Client,
    keywords: &[String],
    n: usize,
    country_key: &str,
) -> Result<Vec<Job>, Error> {
    let country = iso(country_key).map(|(iso2, _)| iso2);
    let mut lookups = Vec::new();
    for co in SMARTRECRUITERS {
        for t in terms(keywords, 3, "") {
            let mut q = vec![("q", t), ("limit", n.clamp(1, 100).to_string())];
            if let Some(c) = country {
                q.push(("country", c.into()));
            }
            let url = format!("https://api.smartrecruiters.com/v1/companies/{co}/postings");
            lookups.push(async move { get_json(client, &url, &q).await }.boxed());
        }
    }
    let mut seen = HashSet::new();
    let mut postings = Vec::new();
    let mut last_err = None;
    for page in stream::iter(lookups).buffered(4).collect::<Vec<_>>().await {
        match page {
            Ok(v) => postings.extend(
                v["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|p| seen.insert(s(p, "id")))
                    .cloned(),
            ),
            Err(e) => last_err = Some(e),
        }
    }
    if postings.is_empty()
        && let Some(e) = last_err
    {
        return Err(e);
    }
    // The list has no description: rank on titles before the cap (`q` matches anywhere in the ad).
    postings.sort_by_cached_key(|p| std::cmp::Reverse(relevance(keywords, &s(p, "name"), "")));
    postings.truncate(n);
    let details = postings.iter().map(|p| {
        let url = format!(
            "https://api.smartrecruiters.com/v1/companies/{}/postings/{}",
            s(&p["company"], "identifier"),
            s(p, "id")
        );
        async move { get_json(client, &url, &[]).await.unwrap_or(Value::Null) }.boxed()
    });
    let details: Vec<Value> = stream::iter(details.collect::<Vec<_>>()).buffered(4).collect().await;
    Ok(postings
        .iter()
        .zip(&details)
        .map(|(p, d)| parse_smartrecruiters(p, d))
        .collect())
}

/// One posting of the list (`content[]`) + its detail (`Null` when the detail call failed).
pub fn parse_smartrecruiters(p: &Value, detail: &Value) -> Job {
    let (co, id) = (s(&p["company"], "identifier"), s(p, "id"));
    let loc = &p["location"];
    let html = detail["jobAd"]["sections"]
        .as_object()
        .into_iter()
        .flat_map(|m| m.values())
        .map(|sec| format!("<h3>{}</h3>{}", s(sec, "title"), s(sec, "text")))
        .collect::<String>();
    let url = s(detail, "postingUrl");
    let mut job = Job {
        id: format!("sr_{}_{}", prefix(&co, 6), md5_8(&id)),
        title: s(p, "name"),
        company: get(&p["company"], "name").map_or_else(|| co.clone(), pystr),
        location: place(&s(loc, "fullLocation")),
        job_type: job_type(&s(&p["typeOfEmployment"], "label")),
        posted_date: prefix(&s(p, "releasedDate"), 10),
        description: soup::markdown(&html),
        url: if url.is_empty() {
            format!("https://jobs.smartrecruiters.com/{co}/{id}")
        } else {
            url
        },
        site: "smartrecruiters".into(),
        ..Job::default()
    };
    work_mode(&mut job, Some(loc["remote"] == true), loc["hybrid"] == true);
    job
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Acceptance (PLAN §5 new sources): Amazon search JSON → jobs; date, URL, keyword filter, dedup.
    #[test]
    fn amazon() {
        let page = json!({"jobs": [
            {"id_icims": "10577454", "title": "Software Development Engineer", "company_name": "Amazon.com Services LLC",
             "normalized_location": "Sao Paulo, Sao Paulo, BRA", "job_schedule_type": "full-time",
             "posted_date": "October 13, 2026", "job_path": "/en/jobs/10577454/sde",
             "description": "Build <b>Rust</b> services", "basic_qualifications": "- 3+ years"},
            {"id_icims": "1", "title": "Warehouse Associate", "description": "Pick and pack"}
        ]});
        let jobs = parse_amazon(&[page.clone(), page], &["rust".into()], 10);
        assert_eq!(jobs.len(), 1);
        let j = &jobs[0];
        assert_eq!(j.id, "amz_10577454");
        assert_eq!(j.posted_date, "2026-10-13");
        assert_eq!(j.url, "https://www.amazon.jobs/en/jobs/10577454/sde");
        assert_eq!(j.job_type, "fulltime");
        assert!(j.description.contains("3+ years"));
    }

    /// Acceptance: Ashby board → listed jobs with locations, pay summary and work mode.
    #[test]
    fn ashby() {
        let data = json!({"jobs": [
            {"id": "a", "title": "Engineer", "location": "San Francisco", "secondaryLocations": [{"location": "Remote - US"}],
             "employmentType": "FullTime", "workplaceType": "Remote", "isListed": true, "publishedAt": "2026-03-12T16:38:15Z",
             "jobUrl": "https://jobs.ashbyhq.com/openai/a", "descriptionPlain": "Python",
             "compensation": {"scrapeableCompensationSalarySummary": "$257K - $335K"}},
            {"id": "b", "title": "Office Manager", "location": "London", "workplaceType": "Hybrid", "isListed": true},
            {"id": "c", "title": "Hidden", "isListed": false},
            {"id": "d", "title": "Researcher", "location": "San Francisco", "workplaceType": "Hybrid", "isRemote": true},
            {"id": "e", "title": "Chef", "location": "Tokyo", "workplaceType": "OnSite"}
        ]});
        let jobs = parse_ashby(&data, "OpenAI", "openai");
        assert_eq!(jobs.len(), 4);
        assert_eq!(jobs[0].location, "San Francisco, Remote - US");
        assert_eq!(jobs[0].salary_range, "$257K - $335K");
        assert_eq!(jobs[0].posted_date, "2026-03-12");
        assert_eq!(jobs[0].is_remote, Some(Some(true)));
        assert_eq!(jobs[1].tags, Some(vec!["hybrid".to_string()]));
        assert_eq!((jobs[2].is_remote, jobs[2].tags.is_some()), (None, true));
        assert_eq!(jobs[3].is_remote, Some(Some(false)));
        assert!(jobs[0].id.starts_with("ash_openai_"));
    }

    /// Acceptance: SmartRecruiters posting + detail → job with the job-ad sections as description.
    #[test]
    fn smartrecruiters() {
        let p = json!({"id": "744000155325500", "name": "Analista de Desenvolvimento",
            "company": {"identifier": "Experian", "name": "Experian"}, "releasedDate": "2026-10-13T17:28:10.566Z",
            "location": {"fullLocation": "São Paulo, , Brazil", "remote": false, "hybrid": true},
            "typeOfEmployment": {"label": "Full-time"}});
        let d = json!({"postingUrl": "https://jobs.smartrecruiters.com/Experian/744000155325500-analista",
            "jobAd": {"sections": {"jobDescription": {"title": "Job Description", "text": "<p>Java e Spring</p>"}}}});
        let j = parse_smartrecruiters(&p, &d);
        assert_eq!(j.location, "São Paulo, Brazil");
        assert_eq!(j.posted_date, "2026-10-13");
        assert_eq!(
            j.url,
            "https://jobs.smartrecruiters.com/Experian/744000155325500-analista"
        );
        assert!(j.description.contains("Java e Spring"));
        assert_eq!(j.tags, Some(vec!["hybrid".to_string()]));
        let bare = parse_smartrecruiters(&p, &Value::Null);
        assert_eq!(bare.url, "https://jobs.smartrecruiters.com/Experian/744000155325500");
    }
}
