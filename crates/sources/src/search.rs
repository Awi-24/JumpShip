//! `job_scraper_v2.search_jobs`: one call per requested site (concurrently), merge, dedup, enrich
//! extra-source jobs, post-filter by location / work mode / age, per-site status, 15 min cache.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use futures::future::{BoxFuture, FutureExt, join_all};
use jumpship_core::{Job, fold};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::jobspy::{LOCATIONS, REMOTE_WORDS, SearchInput, basic_tags, infer_work_mode, title_case};
use crate::{ats, br, extra, jobspy, remote, salary};

const JOBSPY_SITES: &[&str] = &["linkedin", "indeed", "glassdoor"];
const EXTRA_SITES: &[&str] = &[
    "remoteok",
    "arbeitnow",
    "remotive",
    "himalayas",
    "jobicy",
    "gupy",
    "programathor",
    "trampos",
    "greenhouse",
    "lever",
    "workday",
    "playwright",
];
/// Sources that index Portuguese titles: the keywords get PT-BR equivalents appended.
const PT_SITES: &[&str] = &[
    "gupy",
    "programathor",
    "trampos",
    "greenhouse",
    "lever",
    "workday",
    "playwright",
];
const CACHE_TTL: Duration = Duration::from_secs(900);

#[derive(Debug, Clone, Serialize)]
pub struct Query {
    pub keywords: Vec<String>,
    pub location: String,
    pub job_type: String,
    pub sites: Vec<String>,
    pub results_wanted: usize,
    pub hours_old: Option<u32>,
    pub work_mode: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SiteStatus {
    pub count: usize,
    pub error: Option<String>,
}

/// Per-site status in request order (serialized as an object for the `X-Source-Status` header).
pub type Status = Vec<(String, SiteStatus)>;

// ── Location resolution ─────────────────────────────────────────────────────────────────────────

fn table(key: &str) -> Vec<(&'static str, Vec<&'static str>)> {
    LOCATIONS[key]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str(),
                v.as_array().unwrap().iter().filter_map(Value::as_str).collect(),
            )
        })
        .collect()
}

fn set(key: &str) -> HashSet<&'static str> {
    crate::jobspy::words(key).into_iter().collect()
}

struct Tables {
    countries: HashSet<&'static str>,
    country_of: HashMap<&'static str, &'static str>,
    city_of: HashMap<&'static str, &'static str>,
    country_re: Regex,
    city_re: Regex,
    us_states: HashSet<&'static str>,
    us_ambiguous: HashSet<&'static str>,
    remote_labels: HashSet<&'static str>,
    hybrid_labels: HashSet<&'static str>,
    en_to_pt: HashMap<String, String>,
}

/// `\b(?:a|b|...)\b`, longest alias first (all aliases start and end with a word char).
fn alt(words: &HashMap<&str, &str>) -> Regex {
    let mut w: Vec<&str> = words.keys().copied().collect();
    w.sort_by_key(|s| std::cmp::Reverse(s.chars().count()));
    let alts: Vec<String> = w.iter().map(|s| regex::escape(s)).collect();
    Regex::new(&format!(r"\b(?:{})\b", alts.join("|"))).unwrap()
}

static T: LazyLock<Tables> = LazyLock::new(|| {
    let countries = table("countries");
    let mut country_of = HashMap::new();
    for (k, aliases) in countries.iter().chain(table("other_countries").iter()) {
        for a in aliases {
            country_of.insert(*a, *k);
        }
    }
    let city_of: HashMap<_, _> = table("cities")
        .into_iter()
        .flat_map(|(k, cs)| cs.into_iter().map(move |c| (c, k)))
        .collect();
    let kw: Value = serde_json::from_str(include_str!("../../../backend/data/keywords_pt.json")).unwrap();
    Tables {
        countries: countries.iter().map(|(k, _)| *k).collect(),
        country_re: alt(&country_of),
        city_re: alt(&city_of),
        country_of,
        city_of,
        us_states: set("us_states"),
        us_ambiguous: set("us_states_ambiguous"),
        remote_labels: set("remote_labels"),
        hybrid_labels: set("hybrid_labels"),
        en_to_pt: serde_json::from_value(kw["en_to_pt"].clone()).unwrap(),
    }
});

#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    /// Sent to the boards ("" = none).
    pub board_location: String,
    /// JobSpy country name for Indeed / Glassdoor.
    pub country_indeed: String,
    pub is_remote: bool,
    pub hybrid: bool,
    /// Country used by the post-filter ("" = any).
    pub country_key: String,
    /// board_location without the appended country (Glassdoor rejects "City, Country").
    pub plain_location: String,
}

/// `_job_countries`: country names beat cities; "City, ST" means US.
fn job_countries(loc: &str) -> HashSet<&'static str> {
    static US_STATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",\s*([A-Z]{2})\b").unwrap());
    let folded = fold(loc);
    let mut found: HashSet<_> = T
        .country_re
        .find_iter(&folded)
        .map(|m| T.country_of[m.as_str()])
        .collect();
    if found.is_empty() {
        found = T.city_re.find_iter(&folded).map(|m| T.city_of[m.as_str()]).collect();
    }
    if found.is_empty()
        && US_STATE.captures_iter(loc).any(|c| {
            let st = c.get(1).unwrap().as_str();
            T.us_states.contains(st) && !T.us_ambiguous.contains(st)
        })
    {
        found.insert("usa");
    }
    found
}

/// `resolve_location`: UI label ("Brasil (Remoto)", "São Paulo", "Hybrid", free text) → board inputs.
pub fn resolve_location(label: &str) -> Resolved {
    static QUAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.*?)\s*\(([^)]*)\)\s*$").unwrap());
    let raw = label.trim();
    let caps = QUAL.captures(raw);
    let (base_raw, qual) = match &caps {
        Some(c) => (c[1].trim(), fold(&c[2])),
        None => (raw, String::new()),
    };
    let base = fold(base_raw);
    let r = |board: &str, ci: &str, rem: bool, hyb: bool, ck: &str, plain: &str| Resolved {
        board_location: board.into(),
        country_indeed: ci.into(),
        is_remote: rem,
        hybrid: hyb,
        country_key: ck.into(),
        plain_location: plain.into(),
    };
    if T.remote_labels.contains(base.as_str()) {
        if !qual.is_empty() && !qual.contains("remot") && !qual.contains("todo o pais") && !qual.contains("country") {
            // "Remote (Brazil)"
            let inner = caps.as_ref().unwrap()[2].to_string();
            return Resolved {
                is_remote: true,
                ..resolve_location(&inner)
            };
        }
        return r("Remote", "usa", true, false, "", "Remote");
    }
    if T.hybrid_labels.contains(base.as_str()) {
        return r("", "usa", false, true, "", "");
    }
    let found = job_countries(base_raw);
    let ck = if found.len() == 1 {
        *found.iter().next().unwrap()
    } else {
        ""
    };
    let name = LOCATIONS["country_display"][ck]
        .as_str()
        .map_or_else(|| title_case(ck), String::from);
    let is_country = T.country_of.contains_key(base.as_str());
    let board = if is_country {
        name.clone()
    } else if T.city_of.contains_key(base.as_str()) {
        format!("{base_raw}, {name}")
    } else {
        base_raw.to_string()
    };
    let plain = if is_country { name } else { base_raw.to_string() };
    let ci = if T.countries.contains(ck) { ck } else { "usa" };
    r(&board, ci, qual.contains("remot"), false, ck, &plain)
}

/// `_location_matches`: keep the job unless its location contradicts the search. Unknown → keep.
pub fn location_matches(job_loc: &str, search: &Resolved, job_is_remote: Option<bool>) -> bool {
    let jl = job_loc.trim();
    if jl.is_empty() || matches!(jl.to_lowercase().as_str(), "nan" | "none") {
        return true;
    }
    let remote_job = job_is_remote.unwrap_or_else(|| {
        let l = jl.to_lowercase();
        REMOTE_WORDS.iter().any(|w| l.contains(w))
    });
    if search.is_remote && !remote_job {
        return false;
    }
    if search.country_key.is_empty() {
        return true;
    }
    let found = job_countries(jl);
    found.is_empty() || found.contains(search.country_key.as_str())
}

// ── Post-processing ─────────────────────────────────────────────────────────────────────────────

/// `_pt_keywords`: keywords plus their PT-BR equivalents.
fn pt_keywords(keywords: &[String]) -> Vec<String> {
    let mut out = keywords.to_vec();
    for kw in keywords {
        if let Some(pt) = T.en_to_pt.get(&kw.to_lowercase())
            && !out.contains(pt)
        {
            out.push(pt.clone());
        }
    }
    out
}

/// `_normalize_text`: folded, punctuation dropped (unicode word chars kept), whitespace collapsed.
fn normalize(s: &str) -> String {
    let kept: String = fold(s)
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == ' ')
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn dedup_key(j: &Job) -> String {
    format!("{}|{}", normalize(&j.title), normalize(&j.company))
}

/// `_dedup_jobs`: first job per normalized title + company.
pub fn dedup(jobs: Vec<Job>) -> Vec<Job> {
    let mut seen = HashSet::new();
    jobs.into_iter().filter(|j| seen.insert(dedup_key(j))).collect()
}

/// `_enrich_extra`: is_remote + tags for extra-source jobs.
fn enrich(job: &mut Job) {
    let explicit = job.is_remote.flatten();
    let tags = job.tags.take().unwrap_or_default();
    let (is_remote, hybrid) = if explicit.is_none() && tags.iter().any(|t| t == "hybrid") {
        (None, true)
    } else if explicit.is_some() {
        (explicit, false)
    } else {
        infer_work_mode(&job.location, &job.description, None)
    };
    let mut all = tags;
    for t in basic_tags(&job.location, &job.title, &job.job_type, is_remote, hybrid) {
        if !all.contains(&t) {
            all.push(t);
        }
    }
    job.is_remote = Some(is_remote);
    job.tags = Some(all);
}

fn has_tag(job: &Job, tag: &str) -> bool {
    job.tags.as_ref().is_some_and(|t| t.iter().any(|x| x == tag))
}

/// `_work_mode_ok`.
pub fn work_mode_ok(job: &Job, mode: &str) -> bool {
    let remote = job.is_remote.flatten();
    match mode {
        "remote" => remote == Some(true),
        "hybrid" => has_tag(job, "hybrid"),
        "onsite" => remote == Some(false) && !has_tag(job, "hybrid"),
        _ => true,
    }
}

/// `_within_hours`: false only when `posted` parses and is older than `hours_old`. Undated → keep.
pub fn within_hours(posted: &str, hours_old: Option<u32>, now: chrono::DateTime<chrono::Utc>) -> bool {
    use chrono::{NaiveDate, NaiveDateTime, TimeDelta};
    let posted = posted.trim();
    let Some(h) = hours_old.filter(|h| *h > 0) else {
        return true;
    };
    if posted.is_empty() {
        return true;
    }
    // ponytail: covers the shapes the sources emit (date, RFC 3339, naive date-time), not every fromisoformat form.
    let dt = if let Ok(d) = NaiveDate::parse_from_str(posted, "%Y-%m-%d") {
        d.and_hms_opt(0, 0, 0).unwrap().and_utc() + TimeDelta::days(1) // date only: count the whole day
    } else if let Ok(d) = chrono::DateTime::parse_from_rfc3339(&posted.replace(' ', "T")) {
        d.to_utc()
    } else if let Ok(d) = NaiveDateTime::parse_from_str(&posted.replace(' ', "T"), "%Y-%m-%dT%H:%M:%S%.f") {
        d.and_utc()
    } else {
        return true;
    };
    (now - dt).num_seconds() <= i64::from(h) * 3600
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

type CacheEntry = (Instant, Vec<Job>, Status);
static CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> = LazyLock::new(Default::default);

fn cache_key(q: &Query, job_type: Option<&str>, work_mode: &str) -> String {
    let mut kw = q.keywords.clone();
    kw.sort();
    let mut sites = q.sites.clone();
    sites.sort();
    serde_json::json!([
        kw,
        q.location,
        job_type,
        sites,
        q.results_wanted,
        q.hours_old,
        work_mode
    ])
    .to_string()
}

type SiteResult = Result<Vec<Job>, String>;

fn run_site(
    client: &reqwest::Client,
    site: &str,
    q: &Query,
    input: SearchInput,
    remote: bool,
) -> BoxFuture<'static, SiteResult> {
    let c = client.clone();
    let n = q.results_wanted;
    let kws = if PT_SITES.contains(&site) {
        pt_keywords(&q.keywords)
    } else {
        q.keywords.clone()
    };
    let err = |e: crate::Error| e.to_string();
    match site {
        "linkedin" => async move { jobspy::linkedin::fetch_linkedin(&c, &input).await.map_err(err) }.boxed(),
        "indeed" => async move { jobspy::indeed::fetch_indeed(&c, &input).await.map_err(err) }.boxed(),
        "glassdoor" => async move { jobspy::glassdoor::fetch_glassdoor(&c, &input).await.map_err(err) }.boxed(),
        "remoteok" => async move { extra::fetch_remoteok(&c, &kws, n).await.map_err(err) }.boxed(),
        "arbeitnow" => async move { extra::fetch_arbeitnow(&c, &kws, n).await.map_err(err) }.boxed(),
        "remotive" => async move { remote::fetch_remotive(&c, &kws, n).await.map_err(err) }.boxed(),
        "himalayas" => async move { remote::fetch_himalayas(&c, &kws, n).await.map_err(err) }.boxed(),
        "jobicy" => async move { remote::fetch_jobicy(&c, &kws, n).await.map_err(err) }.boxed(),
        "gupy" => async move { br::fetch_gupy(&c, &kws, n, remote).await.map_err(err) }.boxed(),
        "programathor" => async move { br::fetch_programathor(&c, &kws, n).await.map_err(err) }.boxed(),
        "trampos" => async move { br::fetch_trampos(&c, &kws, n).await.map_err(err) }.boxed(),
        "greenhouse" => async move { Ok(ats::fetch_greenhouse(&c, &kws, n).await) }.boxed(),
        "lever" => async move { Ok(ats::fetch_lever(&c, &kws, n).await) }.boxed(),
        "workday" => async move { Ok(ats::fetch_workday(&c, &kws, n).await) }.boxed(),
        // ponytail: the headless career-page scraper is rewritten on CDP in phase 4 (PLAN §5).
        _ => async { Err("career-page scraper not available in the Rust build yet".to_string()) }.boxed(),
    }
}

/// What a search runs: one future per known site, status pre-filled (unknown sites already failed).
struct Plan {
    key: String,
    status: Status,
    futs: Vec<(String, BoxFuture<'static, SiteResult>)>,
    merger: Merger,
}

fn plan(client: &reqwest::Client, q: &Query) -> Plan {
    let job_type = Some(q.job_type.to_lowercase()).filter(|t| !t.is_empty() && t != "all");
    let work_mode = q.work_mode.to_lowercase().replace(['-', '_'], "");
    let work_mode = if work_mode.is_empty() {
        "any".to_string()
    } else {
        work_mode
    };
    let key = cache_key(q, job_type.as_deref(), &work_mode);

    let mut resolved = resolve_location(&q.location);
    if work_mode == "remote" {
        resolved.is_remote = true;
    }
    let remote = resolved.is_remote;
    let mode = match work_mode.as_str() {
        "any" if resolved.is_remote => "remote",
        "any" if resolved.hybrid => "hybrid",
        m => m,
    }
    .to_string();

    let mut status: Status = q.sites.iter().map(|s| (s.clone(), SiteStatus::default())).collect();
    let mut futs = Vec::new();
    for site in &q.sites {
        let known = JOBSPY_SITES.contains(&site.as_str()) || EXTRA_SITES.contains(&site.as_str());
        if !known {
            status.iter_mut().find(|(s, _)| s == site).unwrap().1.error = Some("unknown site".into());
            continue;
        }
        let input = SearchInput {
            keywords: q.keywords.clone(),
            location: if site == "glassdoor" {
                &resolved.plain_location
            } else {
                &resolved.board_location
            }
            .clone(),
            job_type: job_type.clone(),
            results_wanted: q.results_wanted,
            country: resolved.country_indeed.clone(),
            is_remote: remote,
            hours_old: q.hours_old,
        };
        futs.push((site.clone(), run_site(client, site, q, input, remote)));
    }
    Plan {
        key,
        status,
        futs,
        merger: Merger {
            resolved,
            mode,
            hours_old: q.hours_old,
            now: chrono::Utc::now(),
            ids: HashSet::new(),
            keys: HashSet::new(),
        },
    }
}

/// Cross-site merge: the first job per id and per title + company wins (in the order batches are added), then
/// extra-source enrichment, salary normalization and the location / work-mode / age post-filters.
struct Merger {
    resolved: Resolved,
    mode: String,
    hours_old: Option<u32>,
    now: chrono::DateTime<chrono::Utc>,
    ids: HashSet<String>,
    keys: HashSet<String>,
}

impl Merger {
    fn add(&mut self, jobs: Vec<Job>) -> Vec<Job> {
        let fresh: Vec<Job> = jobs
            .into_iter()
            .filter(|j| self.ids.insert(j.id.clone()))
            .filter(|j| self.keys.insert(dedup_key(j)))
            .collect();
        fresh
            .into_iter()
            .map(|mut j| {
                if EXTRA_SITES.contains(&j.site.as_str()) {
                    enrich(&mut j);
                }
                j.salary_annual_usd = salary::annual_usd(&j.salary_range);
                j
            })
            .filter(|j| j.site == "playwright" || location_matches(&j.location, &self.resolved, j.is_remote.flatten()))
            .filter(|j| work_mode_ok(j, &self.mode))
            // JobSpy boards filter hours_old themselves.
            .filter(|j| {
                !EXTRA_SITES.contains(&j.site.as_str()) || within_hours(&j.posted_date, self.hours_old, self.now)
            })
            .collect()
    }
}

fn count(status: &mut Status, jobs: &[Job]) {
    for j in jobs {
        if let Some((_, st)) = status.iter_mut().find(|(s, _)| *s == j.site) {
            st.count += 1;
        }
    }
}

fn fail(status: &mut Status, site: &str, e: &str) {
    tracing::error!("Job search batch '{site}' failed: {e}");
    status.iter_mut().find(|(s, _)| s == site).unwrap().1.error = Some(crate::prefix(e, 200));
}

fn cached(key: &str) -> Option<(Vec<Job>, Status)> {
    let cache = CACHE.lock().unwrap();
    let (_, jobs, status) = cache.get(key).filter(|(ts, ..)| ts.elapsed() < CACHE_TTL)?;
    tracing::info!("Cache hit for search: {}", &key[..key.len().min(80)]);
    Some((jobs.clone(), status.clone()))
}

fn remember(key: String, jobs: &[Job], status: &Status) {
    let mut cache = CACHE.lock().unwrap();
    // Don't cache empty or partially failed searches: retry them next time.
    if !jobs.is_empty() && status.iter().all(|(_, s)| s.error.is_none()) {
        cache.insert(key, (Instant::now(), jobs.to_vec(), status.clone()));
    }
    cache.retain(|_, (ts, _, _)| ts.elapsed() < CACHE_TTL);
}

/// `search_jobs`: jobs + per-site status (`{"count", "error"}` for every requested site). Sites merge in
/// request order, so the result doesn't depend on which board answers first.
pub async fn search(client: &reqwest::Client, q: &Query) -> (Vec<Job>, Status) {
    let Plan {
        key,
        mut status,
        futs,
        mut merger,
    } = plan(client, q);
    if let Some(hit) = cached(&key) {
        return hit;
    }
    let (sites, futs): (Vec<_>, Vec<_>) = futs.into_iter().unzip();
    let mut all = Vec::new();
    for (site, batch) in sites.iter().zip(join_all(futs).await) {
        match batch {
            Ok(jobs) => all.extend(merger.add(jobs)),
            Err(e) => fail(&mut status, site, &e),
        }
    }
    count(&mut status, &all);
    remember(key, &all, &status);
    (all, status)
}

/// One site's share of a streamed search.
#[derive(Debug, Clone, Serialize)]
pub struct Batch {
    pub site: String,
    pub jobs: Vec<Job>,
    pub status: SiteStatus,
}

/// `search`, but each site is yielded as soon as it finishes (merged in completion order; PLAN §5 streaming).
/// The full result is cached like `search`'s, and a cache hit replays one batch per site.
pub fn search_stream(client: &reqwest::Client, q: &Query) -> futures::stream::BoxStream<'static, Batch> {
    use futures::stream::{self, FuturesUnordered, StreamExt};

    let Plan {
        key,
        status,
        futs,
        mut merger,
    } = plan(client, q);
    if let Some((jobs, status)) = cached(&key) {
        let batches: Vec<Batch> = status
            .into_iter()
            .map(|(site, st)| Batch {
                jobs: jobs.iter().filter(|j| j.site == site).cloned().collect(),
                site,
                status: st,
            })
            .collect();
        return stream::iter(batches).boxed();
    }
    let early: Vec<Batch> = status
        .iter()
        .filter(|(_, st)| st.error.is_some())
        .map(|(site, st)| Batch {
            site: site.clone(),
            jobs: vec![],
            status: st.clone(),
        })
        .collect();
    let acc = std::sync::Arc::new(Mutex::new((Vec::<Job>::new(), status)));
    let done = acc.clone();
    let running: FuturesUnordered<_> = futs
        .into_iter()
        .map(|(site, fut)| fut.map(move |r| (site, r)))
        .collect();
    let live = running.map(move |(site, r)| {
        let mut acc = acc.lock().unwrap();
        let (all, status) = &mut *acc;
        let jobs = match r {
            Ok(jobs) => merger.add(jobs),
            Err(e) => {
                fail(status, &site, &e);
                vec![]
            }
        };
        count(status, &jobs);
        all.extend(jobs.iter().cloned());
        let st = status.iter().find(|(s, _)| *s == site).unwrap().1.clone();
        Batch { site, jobs, status: st }
    });
    let finish = stream::once(async move {
        let (all, status) = &*done.lock().unwrap();
        remember(key, all, status);
    })
    .filter_map(|_| async { None });
    stream::iter(early).chain(live).chain(finish).boxed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        // Same table as tests/unit/test_search_filters.py::TestResolveLocation.
        let cases = [
            ("Brasil (todo o país)", "Brazil", "brazil", false, false, "brazil"),
            ("Brasil (Remoto)", "Brazil", "brazil", true, false, "brazil"),
            ("São Paulo", "São Paulo, Brazil", "brazil", false, false, "brazil"),
            ("United States (Remote)", "United States", "usa", true, false, "usa"),
            ("Canada (country-wide)", "Canada", "canada", false, false, "canada"),
            ("UK (Remote)", "United Kingdom", "uk", true, false, "uk"),
            ("London", "London, United Kingdom", "uk", false, false, "uk"),
            ("Kraków", "Kraków, Poland", "poland", false, false, "poland"),
            ("New York, NY", "New York, NY", "usa", false, false, "usa"),
            ("Remote", "Remote", "usa", true, false, ""),
            ("Hybrid", "", "usa", false, true, ""),
            ("Cambridge", "Cambridge", "usa", false, false, ""),
        ];
        for (label, board, indeed, remote, hybrid, key) in cases {
            let r = resolve_location(label);
            assert_eq!(
                (
                    r.board_location.as_str(),
                    r.country_indeed.as_str(),
                    r.is_remote,
                    r.hybrid,
                    r.country_key.as_str()
                ),
                (board, indeed, remote, hybrid, key),
                "{label}"
            );
        }
        assert_eq!(resolve_location("São Paulo").plain_location, "São Paulo");
    }

    #[test]
    fn location_filter() {
        let m = |job: &str, search: &str| location_matches(job, &resolve_location(search), None);
        assert!(m("London, UK", "Cambridge"));
        let br = "Brasil (todo o país)";
        for ok in ["Rio de Janeiro, RJ", "Salvador, Bahia, Brazil", "Remote", ""] {
            assert!(m(ok, br), "{ok}");
        }
        for no in [
            "New York, NY",
            "San Francisco, CA",
            "El Salvador",
            "Las Palmas, Spain",
            "Indianapolis, IN",
        ] {
            assert!(!m(no, br), "{no}");
        }
        let remote = resolve_location("Remote");
        assert!(location_matches("São Paulo", &remote, Some(true)));
        assert!(!location_matches("São Paulo", &remote, Some(false)));
        assert!(location_matches("Remote - Worldwide", &remote, None));
        assert!(m("Campinas, SP", "São Paulo"));
        assert!(!m("Dublin, Ireland", "London"));
    }

    #[test]
    fn dedup_modes_hours() {
        let job = |t: &str, c: &str| Job {
            title: t.into(),
            company: c.into(),
            ..Default::default()
        };
        assert_eq!(
            dedup(vec![
                job("Desenvolvedor Sênior", "Acme"),
                job("Desenvolvedor Senior", "ACME")
            ])
            .len(),
            1
        );
        assert_eq!(dedup(vec![job("软件工程师", "A"), job("数据工程师", "A")]).len(), 2);

        let mode = |r: Option<bool>, tag: &str| Job {
            is_remote: Some(r),
            tags: Some(vec![tag.into()]),
            ..Default::default()
        };
        let jobs = [
            mode(Some(true), "remote"),
            mode(None, "hybrid"),
            mode(Some(false), "on-site"),
        ];
        for (m, want) in [
            ("remote", [true, false, false]),
            ("hybrid", [false, true, false]),
            ("onsite", [false, false, true]),
        ] {
            assert_eq!(jobs.iter().map(|j| work_mode_ok(j, m)).collect::<Vec<_>>(), want, "{m}");
        }

        let now = chrono::Utc::now();
        assert!(within_hours("", Some(24), now));
        assert!(within_hours("not a date", Some(24), now));
        assert!(!within_hours("2020-01-01", Some(24), now));
        assert!(within_hours(&now.format("%Y-%m-%d").to_string(), Some(1), now));
        assert!(!within_hours("2020-01-01T10:00:00Z", Some(24), now));
    }

    #[test]
    fn pt_and_enrich() {
        assert_eq!(
            pt_keywords(&["Software Engineer".into(), "backend".into()]),
            ["Software Engineer", "backend", "engenheiro de software"]
        );
        let mut j = Job {
            title: "Senior Dev".into(),
            location: "São Paulo (Híbrido)".into(),
            ..Default::default()
        };
        enrich(&mut j);
        assert_eq!(j.is_remote, Some(None));
        assert_eq!(j.tags.unwrap(), ["hybrid", "senior"]);
    }
}
