//! LinkedIn, Indeed and Glassdoor: ports of the vendored JobSpy scrapers (`jobspy/`) plus the row
//! conversion in `job_scraper_v2._search_jobspy` (DataFrame row → job dict).

pub mod glassdoor;
pub mod indeed;
pub mod linkedin;

use std::sync::LazyLock;

use jumpship_core::Job;
use regex::Regex;
use serde_json::Value;

use crate::md5_hex;

/// One `scrape_jobs` call (always a single board in JumpShip).
#[derive(Debug, Clone)]
pub struct SearchInput {
    pub keywords: Vec<String>,
    /// Board location label ("São Paulo, Brazil"); empty for none.
    pub location: String,
    /// JobType name ("fulltime", "parttime", ...).
    pub job_type: Option<String>,
    pub results_wanted: usize,
    /// `country_indeed` name ("brazil", "usa", ...).
    pub country: String,
    pub is_remote: bool,
    pub hours_old: Option<u32>,
}

impl SearchInput {
    /// Keywords OR-ed for the board (multi-word ones quoted), as `_search_jobspy` builds it.
    pub fn search_term(&self) -> String {
        match self.keywords.as_slice() {
            [one] => one.clone(),
            kws => kws
                .iter()
                .map(|k| if k.contains(' ') { format!("\"{k}\"") } else { k.clone() })
                .collect::<Vec<_>>()
                .join(" OR "),
        }
    }

    fn country(&self) -> Result<Country, crate::Error> {
        Country::from_name(&self.country).ok_or_else(|| format!("Invalid country string: '{}'", self.country).into())
    }

    fn job_type(&self) -> Option<JobType> {
        self.job_type.as_deref().and_then(JobType::parse)
    }
}

// ── jobspy.model: Country, JobType, Location ───────────────────────────────────────────────────

/// (comma-separated names, Indeed subdomain[:api code], Glassdoor domain).
const COUNTRIES: &[(&str, &str, Option<&str>)] = &[
    ("argentina", "ar", Some("com.ar")),
    ("australia", "au", Some("com.au")),
    ("austria", "at", Some("at")),
    ("bahrain", "bh", None),
    ("bangladesh", "bd", None),
    ("belgium", "be", Some("fr:be")),
    ("bulgaria", "bg", None),
    ("brazil", "br", Some("com.br")),
    ("canada", "ca", Some("ca")),
    ("chile", "cl", None),
    ("china", "cn", None),
    ("colombia", "co", None),
    ("costa rica", "cr", None),
    ("croatia", "hr", None),
    ("cyprus", "cy", None),
    ("czech republic,czechia", "cz", None),
    ("denmark", "dk", None),
    ("ecuador", "ec", None),
    ("egypt", "eg", None),
    ("estonia", "ee", None),
    ("finland", "fi", None),
    ("france", "fr", Some("fr")),
    ("germany", "de", Some("de")),
    ("greece", "gr", None),
    ("hong kong", "hk", Some("com.hk")),
    ("hungary", "hu", None),
    ("india", "in", Some("co.in")),
    ("indonesia", "id", None),
    ("ireland", "ie", Some("ie")),
    ("israel", "il", None),
    ("italy", "it", Some("it")),
    ("japan", "jp", None),
    ("kuwait", "kw", None),
    ("latvia", "lv", None),
    ("lithuania", "lt", None),
    ("luxembourg", "lu", None),
    ("malaysia", "malaysia:my", Some("com")),
    ("malta", "malta:mt", None),
    ("mexico", "mx", Some("com.mx")),
    ("morocco", "ma", None),
    ("netherlands", "nl", Some("nl")),
    ("new zealand", "nz", Some("co.nz")),
    ("nigeria", "ng", None),
    ("norway", "no", None),
    ("oman", "om", None),
    ("pakistan", "pk", None),
    ("panama", "pa", None),
    ("peru", "pe", None),
    ("philippines", "ph", None),
    ("poland", "pl", None),
    ("portugal", "pt", None),
    ("qatar", "qa", None),
    ("romania", "ro", None),
    ("saudi arabia", "sa", None),
    ("singapore", "sg", Some("sg")),
    ("slovakia", "sk", None),
    ("slovenia", "sl", None),
    ("south africa", "za", None),
    ("south korea", "kr", None),
    ("spain", "es", Some("es")),
    ("sweden", "se", None),
    ("switzerland", "ch", Some("de:ch")),
    ("taiwan", "tw", None),
    ("thailand", "th", None),
    ("türkiye,turkey", "tr", None),
    ("ukraine", "ua", None),
    ("united arab emirates,uae", "ae", None),
    ("uk,united kingdom", "uk:gb", Some("co.uk")),
    ("usa,us,united states", "www:us", Some("com")),
    ("uruguay", "uy", None),
    ("venezuela", "ve", None),
    ("vietnam", "vn", Some("com")),
    ("usa/ca", "www", None),
    ("worldwide", "www", None),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Country(usize);

impl Country {
    pub const USA: Country = Country(68);
    /// Indeed tags full-time jobs there as "permanent".
    pub const JAPAN: Country = Country(31);
    const US_CANADA: Country = Country(72);
    const WORLDWIDE: Country = Country(73);

    /// `Country.from_string`.
    pub fn from_name(s: &str) -> Option<Country> {
        let s = s.trim().to_lowercase();
        COUNTRIES
            .iter()
            .position(|(names, ..)| names.split(',').any(|n| n == s))
            .map(Country)
    }

    fn names(self) -> &'static str {
        COUNTRIES[self.0].0
    }

    /// (subdomain, API country code).
    pub fn indeed_domain(self) -> (&'static str, String) {
        let v = COUNTRIES[self.0].1;
        match v.split_once(':') {
            Some((sub, code)) if !sub.is_empty() && !code.is_empty() => (sub, code.to_uppercase()),
            _ => (v, v.to_uppercase()),
        }
    }

    pub fn glassdoor_url(self) -> Option<String> {
        let v = COUNTRIES[self.0].2?;
        Some(match v.split_once(':') {
            Some((sub, domain)) if !sub.is_empty() && !domain.is_empty() => format!("https://{sub}.glassdoor.{domain}"),
            _ => format!("https://www.glassdoor.{v}"),
        })
    }

    /// Indeed's API country code ("BR") → Country.
    fn from_indeed_code(code: &str) -> Option<Country> {
        (0..COUNTRIES.len())
            .rev()
            .map(Country)
            .find(|c| c.indeed_domain().1 == code)
    }
}

const JOB_TYPES: &[&[&str]] = &[
    &[
        "fulltime",
        "períodointegral",
        "estágio/trainee",
        "cunormăîntreagă",
        "tiempocompleto",
        "vollzeit",
        "voltijds",
        "tempointegral",
        "全职",
        "plnýúvazek",
        "fuldtid",
        "دوامكامل",
        "kokopäivätyö",
        "tempsplein",
        "vollzeit",
        "πλήρηςαπασχόληση",
        "teljesmunkaidő",
        "tempopieno",
        "tempsplein",
        "heltid",
        "jornadacompleta",
        "pełnyetat",
        "정규직",
        "100%",
        "全職",
        "งานประจำ",
        "tamzamanlı",
        "повназайнятість",
        "toànthờigian",
    ],
    &["parttime", "teilzeit", "částečnýúvazek", "deltid"],
    &["contract", "contractor"],
    &["temporary"],
    &[
        "internship",
        "prácticas",
        "ojt(onthejobtraining)",
        "praktikum",
        "praktik",
    ],
    &["perdiem"],
    &["nights"],
    &["other"],
    &["summer"],
    &["volunteer"],
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobType(usize);

impl JobType {
    pub const FULL_TIME: JobType = JobType(0);
    pub const PART_TIME: JobType = JobType(1);
    pub const CONTRACT: JobType = JobType(2);
    pub const TEMPORARY: JobType = JobType(3);
    pub const INTERNSHIP: JobType = JobType(4);
    pub const PER_DIEM: JobType = JobType(5);
    pub const VOLUNTEER: JobType = JobType(9);

    /// `get_enum_from_job_type`: the first type listing `s` among its values.
    pub fn parse(s: &str) -> Option<JobType> {
        JOB_TYPES.iter().position(|vals| vals.contains(&s)).map(JobType)
    }

    pub fn name(self) -> &'static str {
        JOB_TYPES[self.0][0]
    }
}

#[derive(Debug, Clone)]
pub enum LocCountry {
    Known(Country),
    Raw(String),
}

#[derive(Debug, Clone, Default)]
pub struct Location {
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<LocCountry>,
}

/// Python `str.title()`.
pub(crate) fn title_case(s: &str) -> String {
    let mut out = String::new();
    let mut prev_cased = false;
    for c in s.chars() {
        if prev_cased {
            out.extend(c.to_lowercase())
        } else {
            out.extend(c.to_uppercase())
        }
        prev_cased = c.is_alphabetic();
    }
    out
}

impl Location {
    pub fn display(&self) -> String {
        let mut parts: Vec<String> = [&self.city, &self.state]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .cloned()
            .collect();
        let not_countries = [Country::US_CANADA, Country::WORLDWIDE];
        let country = match &self.country {
            Some(LocCountry::Raw(raw)) => {
                let known = Country::from_name(raw);
                if known.is_none_or(|k| not_countries.contains(&k)) {
                    parts.push(raw.clone());
                }
                known
            }
            Some(LocCountry::Known(c)) => Some(*c),
            None => None,
        };
        if let Some(c) = country.filter(|c| !not_countries.contains(c)) {
            let name = c.names().split(',').next().unwrap();
            parts.push(if matches!(name, "usa" | "uk") {
                name.to_uppercase()
            } else {
                title_case(name)
            });
        }
        parts.join(", ")
    }
}

// ── JobPost → DataFrame row → job dict ─────────────────────────────────────────────────────────

/// The JobPost fields JumpShip reads.
#[derive(Debug, Clone, Default)]
pub struct Post {
    pub title: String,
    pub company_name: Option<String>,
    pub job_url: String,
    pub location: Option<Location>,
    pub description: Option<String>,
    pub company_url: Option<String>,
    pub company_url_direct: Option<String>,
    pub job_type: Vec<JobType>,
    pub compensation: Option<Compensation>,
    /// `YYYY-MM-DD`.
    pub date_posted: Option<String>,
    pub is_remote: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct Compensation {
    pub min_amount: Option<f64>,
    pub max_amount: Option<f64>,
    pub currency: Option<String>,
}

static SALARY_RANGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\$(\d+(?:,\d+)?(?:\.\d+)?)([kK]?)\s*[-—–]\s*(?:\$)?(\d+(?:,\d+)?(?:\.\d+)?)([kK]?)").unwrap()
});

/// `jobspy.util.extract_salary`: the first "$min - $max" of a text (US searches only).
fn extract_salary(text: &str) -> Option<Compensation> {
    let m = SALARY_RANGE.captures(text)?;
    let num = |i: usize| m[i].replace(',', "").parse::<f64>().map(|v| v as i64).ok();
    let (mut low, mut high) = (num(1)?, num(3)?);
    if !m[2].is_empty() || !m[4].is_empty() {
        (low, high) = (low * 1000, high * 1000);
    }
    let (below, factor) = if low < 350 {
        (350.0, 2080)
    } else if low < 30_000 {
        (30_000.0, 12)
    } else {
        (f64::INFINITY, 1)
    };
    let (annual_low, annual_high) = (low * factor, high * factor);
    if high as f64 >= below || !(1000 <= annual_low && annual_low < annual_high && annual_high <= 700_000) {
        return None;
    }
    Some(Compensation {
        min_amount: Some(low as f64),
        max_amount: Some(high as f64),
        currency: Some("USD".into()),
    })
}

pub(crate) static LOCATIONS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../backend/data/locations.json")).expect("locations.json")
});

pub(crate) fn words(key: &str) -> Vec<&'static str> {
    LOCATIONS[key]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect()
}

pub(crate) static REMOTE_WORDS: LazyLock<Vec<&str>> = LazyLock::new(|| words("remote_words"));
pub(crate) static HYBRID_WORDS: LazyLock<Vec<&str>> = LazyLock::new(|| words("hybrid_words"));

/// `_infer_work_mode` → (is_remote, hybrid).
pub fn infer_work_mode(location: &str, description: &str, raw_is_remote: Option<bool>) -> (Option<bool>, bool) {
    let loc = location.to_lowercase();
    let desc = description.chars().take(500).collect::<String>().to_lowercase();
    let has = |text: &str, ws: &[&str]| ws.iter().any(|w| text.contains(w));
    if raw_is_remote == Some(true) || has(&loc, &REMOTE_WORDS) {
        (Some(true), false)
    } else if has(&loc, &HYBRID_WORDS) {
        (None, true)
    } else if has(&desc, &REMOTE_WORDS) {
        (Some(true), false)
    } else if has(&desc, &HYBRID_WORDS) {
        (None, true)
    } else {
        ((!loc.is_empty() && loc != "nan").then_some(false), false)
    }
}

/// `_basic_tags`; `location`/`job_type` are Python `str()` of the row cell ("None" when missing).
pub fn basic_tags(location: &str, title: &str, job_type: &str, is_remote: Option<bool>, hybrid: bool) -> Vec<String> {
    let mut tags = Vec::new();
    let loc = location.to_lowercase();
    let any = |text: &str, ws: &[&str]| ws.iter().any(|w| text.contains(w));
    if is_remote == Some(true) {
        tags.push("remote");
    } else if hybrid || any(&loc, &["híbrido", "hibrido", "hybrid"]) {
        tags.push("hybrid");
    } else if is_remote == Some(false) && !matches!(loc.as_str(), "nan" | "" | "none") {
        tags.push("on-site");
    }
    let title = title.to_lowercase();
    if any(
        &title,
        &["senior", "sênior", "sr.", " sr ", "staff", "principal", "lead"],
    ) {
        tags.push("senior");
    } else if any(&title, &["junior", "júnior", "jr.", " jr ", "entry"]) {
        tags.push("junior");
    } else if any(&title, &["mid", "pleno", "ii", "iii"]) {
        tags.push("mid-level");
    }
    let jt = job_type.to_lowercase();
    if jt.contains("contract") || jt.contains("freelan") {
        tags.push("contract");
    } else if jt.contains("parttime") || jt.contains("part-time") || jt.contains("part time") {
        tags.push("part-time");
    }
    tags.into_iter().map(String::from).collect()
}

/// Python `f"{x:,.0f}"`.
fn money(x: f64) -> String {
    let s = format!("{x:.0}");
    let (sign, digits) = s.strip_prefix('-').map_or(("", s.as_str()), |d| ("-", d));
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    format!("{sign}{out}")
}

/// `_format_salary`.
fn format_salary(c: Option<&Compensation>) -> String {
    let Some(c) = c else { return String::new() };
    let cur = c.currency.as_deref().unwrap_or("None");
    let ok = |v: Option<f64>| v.filter(|v| *v != 0.0 && !v.is_nan());
    match (ok(c.min_amount), ok(c.max_amount)) {
        (Some(lo), Some(hi)) => format!("{cur} {} – {}", money(lo), money(hi)),
        (Some(lo), None) => format!("{cur} {}+", money(lo)),
        (None, Some(hi)) => format!("Up to {cur} {}", money(hi)),
        _ => String::new(),
    }
}

/// `_extract_domain`: `scheme://host` of a URL.
fn url_origin(url: &str) -> String {
    let Ok(u) = reqwest::Url::parse(url) else {
        return String::new();
    };
    match (u.host_str(), u.port()) {
        (Some(h), Some(port)) => format!("{}://{h}:{port}", u.scheme()),
        (Some(h), None) => format!("{}://{h}", u.scheme()),
        _ => String::new(),
    }
}

/// `_cell`: missing / "nan" / "None" / "NaT" → "".
fn cell(v: Option<&str>) -> String {
    match v {
        None | Some("nan" | "None" | "NaT") => String::new(),
        Some(s) => s.to_string(),
    }
}

/// `scrape_jobs` row building + sort (date_posted desc, missing last) + `_search_jobspy` conversion.
pub fn to_jobs(site: &str, mut posts: Vec<Post>, country: Country) -> Vec<Job> {
    posts.sort_by(|a, b| match (&a.date_posted, &b.date_posted) {
        (Some(x), Some(y)) => y.cmp(x),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    posts
        .into_iter()
        .map(|p| {
            let job_type =
                (!p.job_type.is_empty()).then(|| p.job_type.iter().map(|t| t.name()).collect::<Vec<_>>().join(", "));
            let location = p.location.as_ref().map(Location::display);
            let description = p.description.clone().unwrap_or_default();
            let compensation = p.compensation.clone().or_else(|| {
                if country == Country::USA {
                    extract_salary(&description)
                } else {
                    None
                }
            });
            let company = p.company_name.as_deref();

            let non_empty = |v: &Option<String>| v.clone().filter(|s| !s.is_empty());
            let mut company_url = non_empty(&p.company_url_direct)
                .or(non_empty(&p.company_url))
                .unwrap_or_default();
            if !company_url.is_empty() && !company_url.starts_with("http") {
                let base = url_origin(&p.job_url);
                company_url = if base.is_empty() {
                    String::new()
                } else {
                    base + &company_url
                };
            }
            let (is_remote, hybrid) = infer_work_mode(location.as_deref().unwrap_or(""), &description, p.is_remote);
            let py = |v: Option<&str>| v.unwrap_or("None").to_string();
            let tags = basic_tags(
                &py(location.as_deref()),
                &p.title,
                &py(job_type.as_deref()),
                is_remote,
                hybrid,
            );
            Job {
                id: md5_hex(&format!(
                    "{}-{}-{}",
                    cell(Some(&p.title)),
                    cell(company),
                    cell(Some(&p.job_url))
                ))[..12]
                    .to_string(),
                title: cell(Some(&p.title)),
                company: cell(company),
                company_url,
                location: cell(location.as_deref()),
                job_type: cell(job_type.as_deref()),
                salary_range: format_salary(compensation.as_ref()),
                posted_date: cell(p.date_posted.as_deref()),
                description,
                url: cell(Some(&p.job_url)),
                site: site.into(),
                match_score: None,
                is_remote: Some(is_remote),
                tags: Some(tags),
                salary_annual_usd: None,
                is_new: None,
                relevance: None,
            }
        })
        .collect()
}

/// Valid `YYYY-MM-DD` (Python `date.fromisoformat` for the plain form).
fn iso_date(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d): (i32, u32, u32) = (s[..4].parse().ok()?, s[5..7].parse().ok()?, s[8..].parse().ok()?);
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    (y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days[m as usize - 1]).then(|| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_and_display() {
        assert_eq!(Country::USA.names(), "usa,us,united states");
        assert_eq!(Country::JAPAN.names(), "japan");
        assert_eq!(Country::US_CANADA.names(), "usa/ca");
        assert_eq!(Country::WORLDWIDE.names(), "worldwide");
        assert_eq!(
            Country::from_name(" Brazil ").unwrap().indeed_domain(),
            ("br", "BR".to_string())
        );
        assert_eq!(Country::USA.indeed_domain(), ("www", "US".to_string()));
        assert_eq!(
            Country::from_name("brazil").unwrap().glassdoor_url().unwrap(),
            "https://www.glassdoor.com.br"
        );
        assert_eq!(Country::from_indeed_code("WWW"), Some(Country::WORLDWIDE));
        assert_eq!(JobType::parse("tempointegral"), Some(JobType::FULL_TIME));
        let loc = |city: &str, country: LocCountry| Location {
            city: Some(city.into()),
            state: None,
            country: Some(country),
        };
        assert_eq!(loc("Austin", LocCountry::Known(Country::USA)).display(), "Austin, USA");
        assert_eq!(
            loc("Paris", LocCountry::Raw("france".into())).display(),
            "Paris, France"
        );
        assert_eq!(loc("X", LocCountry::Raw("Atlantis".into())).display(), "X, Atlantis");
        assert_eq!(money(1234567.5), "1,234,568");
        assert_eq!(
            extract_salary("pays $80k - $120k/yr").unwrap().max_amount,
            Some(120_000.0)
        );
        assert_eq!(extract_salary("$5 - $10").unwrap().min_amount, Some(5.0)); // hourly
        assert!(extract_salary("$50 - $40").is_none());
    }
}
