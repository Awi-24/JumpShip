//! Indeed mobile-app GraphQL API. Port of `jobspy/indeed`.

use std::collections::HashSet;
use std::time::Duration;

use jumpship_core::Job;
use serde_json::{Value, json};

use super::{Compensation, Country, JobType, LocCountry, Location, Post, SearchInput, to_jobs};
use crate::{Error, soup, unix_date};

const API_URL: &str = "https://apis.indeed.com/graphql";
const JOBS_PER_PAGE: usize = 100;
/// `content-type: application/json` comes from `.json()`.
const HEADERS: [(&str, &str); 5] = [
    (
        "indeed-api-key",
        "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
    ),
    ("accept", "application/json"),
    ("accept-language", "en-US,en;q=0.9"),
    (
        "user-agent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1",
    ),
    (
        "indeed-app-info",
        "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
    ),
];
const PERMANENT_KEY: &str = "5QWDV";
const REMOTE_KEY: &str = "DSQF7";
const HYBRID_KEY: &str = "PAXZC";

fn job_type_codes(t: JobType) -> &'static [&'static str] {
    match t {
        JobType::FULL_TIME => &["CF3CP"],
        JobType::PART_TIME => &["75GKK"],
        JobType::CONTRACT => &["NJXCK", "T9BXE", "T65DZ"],
        JobType::INTERNSHIP => &["VDTG7"],
        JobType::TEMPORARY => &["4HKF7", "CJWTS"],
        JobType::PER_DIEM => &["TQKYQ"],
        JobType::VOLUNTEER => &["UXQZ8"],
        _ => &[],
    }
}

fn job_type_of_code(code: &str) -> Option<JobType> {
    [
        JobType::FULL_TIME,
        JobType::PART_TIME,
        JobType::CONTRACT,
        JobType::INTERNSHIP,
        JobType::TEMPORARY,
        JobType::PER_DIEM,
        JobType::VOLUNTEER,
    ]
    .into_iter()
    .find(|t| job_type_codes(*t).contains(&code))
}

fn language(code: &str) -> &'static str {
    match code {
        "AR" | "CL" | "CO" | "CR" | "EC" | "ES" | "MX" | "PA" | "PE" | "UY" | "VE" => "es",
        "AT" | "CH" | "DE" => "de",
        "BE" | "NL" => "nl",
        "BR" | "PT" => "pt",
        "CN" | "TW" => "zh",
        "CZ" => "cs",
        "DK" => "da",
        "FI" => "fi",
        "FR" | "LU" | "MA" => "fr",
        "GR" => "el",
        "HU" => "hu",
        "ID" => "id",
        "IL" => "he",
        "IT" => "it",
        "JP" => "ja",
        "KR" => "ko",
        "NO" => "nb",
        "PL" => "pl",
        "RO" => "ro",
        "SE" => "sv",
        "TH" => "th",
        "TR" => "tr",
        "UA" => "uk",
        "VN" => "vi",
        _ => "en",
    }
}

const INDEED_QUERY: &str = r#"
    query GetJobData {{
        jobSearch(
            {what}
            {location}
            limit: {limit}
            {cursor}
            sort: RELEVANCE
            {filters}
        ) {{
            pageInfo {{
                nextCursor
            }}
            results {{
                job {{
                    key
                    title
                    sourceEmployerName
                    dateOnIndeed
                    description {{
                        html
                    }}
                    location {{
                        countryCode
                        admin1Code
                        city
                    }}
                    compensation {{
                        estimated {{
                            currencyCode
                            baseSalary {{
                                unitOfWork
                                range {{
                                    ... on Range {{ min max }}
                                    ... on AtLeast {{ min }}
                                    ... on AtMost {{ max }}
                                    ... on Exactly {{ value }}
                                }}
                            }}
                        }}
                        baseSalary {{
                            unitOfWork
                            range {{
                                ... on Range {{ min max }}
                                ... on AtLeast {{ min }}
                                ... on AtMost {{ max }}
                                ... on Exactly {{ value }}
                            }}
                        }}
                        currencyCode
                    }}
                    attributes {{
                        key
                        label
                    }}
                    employer {{
                        relativeCompanyPageUrl
                        name
                        ugcStats {{
                            ratings {{
                                overallRating {{
                                    value
                                    count
                                }}
                            }}
                        }}
                        dossier {{
                            employerDetails {{
                                addresses
                                industry
                                employeesLocalizedLabel
                                revenueLocalizedLabel
                                briefDescription
                            }}
                            images {{
                                squareLogoUrl
                            }}
                            links {{
                                corporateWebsite
                            }}
                        }}
                    }}
                    recruit {{
                        viewJobUrl
                    }}
                }}
            }}
        }}
    }}
"#;

/// Python `str.format` for a template with `{name}` fields and `{{` / `}}` escapes.
fn py_format(template: &str, fields: &[(&str, &str)]) -> String {
    let mut out = String::new();
    let mut rest = template;
    while let Some(i) = rest.find(['{', '}']) {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        if rest.starts_with("{{") || rest.starts_with("}}") {
            out.push_str(&rest[..1]);
            rest = &rest[2..];
        } else if let Some(end) = rest.find('}').filter(|_| rest.starts_with('{')) {
            let name = &rest[1..end];
            out.push_str(fields.iter().find(|(k, _)| *k == name).map_or("", |(_, v)| v));
            rest = &rest[end + 1..];
        } else {
            out.push_str(&rest[..1]);
            rest = &rest[1..];
        }
    }
    out + rest
}

/// `Indeed._build_filters`.
pub fn build_filters(input: &SearchInput) -> String {
    let attribute =
        |key: &str, extra: &str| format!(r#"{{ keyword: {{ field: "attributes", keys: ["{key}"]{extra} }} }}"#);
    let mut filters = Vec::new();
    if let Some(h) = input.hours_old.filter(|h| *h > 0) {
        filters.push(format!(r#"{{ date: {{ field: "dateOnIndeed", start: "{h}h" }} }}"#));
    }
    let job_type = input.job_type();
    let mut keys: Vec<&str> = job_type.map_or(vec![], |t| job_type_codes(t).to_vec());
    if job_type == Some(JobType::FULL_TIME) && input.country().ok() == Some(Country::JAPAN) {
        keys.push(PERMANENT_KEY);
    }
    match keys.as_slice() {
        [] => {}
        [one] => filters.push(attribute(one, "")),
        many => {
            let any = many.iter().map(|k| attribute(k, "")).collect::<Vec<_>>().join(", ");
            filters.push(format!("{{ composite: {{ filters: [{any}], operation: OR }} }}"));
        }
    }
    if input.is_remote {
        filters.push(attribute(REMOTE_KEY, ""));
        filters.push(attribute(HYBRID_KEY, ", match: MUST_NOT"));
    }
    if filters.is_empty() {
        String::new()
    } else {
        format!("filters: [{}]", filters.join(", "))
    }
}

/// The GraphQL text of one search page (`{"query": ...}` is the request body).
pub fn build_query(input: &SearchInput, cursor: Option<&str>) -> String {
    let term = input.search_term();
    let what = if term.is_empty() {
        String::new()
    } else {
        format!("what: {}", serde_json::to_string(&term).unwrap())
    };
    let location = if input.location.is_empty() {
        String::new()
    } else {
        format!(
            "location: {{where: {}, radius: 50, radiusUnit: MILES}}",
            serde_json::to_string(&input.location).unwrap()
        )
    };
    let cursor = cursor.map_or(String::new(), |c| format!("cursor: \"{c}\""));
    let limit = JOBS_PER_PAGE.to_string();
    let filters = build_filters(input);
    py_format(
        INDEED_QUERY,
        &[
            ("what", &what),
            ("location", &location),
            ("limit", &limit),
            ("cursor", &cursor),
            ("filters", &filters),
        ],
    )
}

/// `{subdomain}.indeed.com` origin and the extra headers for a country.
pub fn site(country: Country) -> (String, Vec<(&'static str, String)>) {
    let (domain, code) = country.indeed_domain();
    let headers = vec![
        ("indeed-co", code.clone()),
        ("indeed-locale", format!("{}-{code}", language(&code))),
    ];
    (format!("https://{domain}.indeed.com"), headers)
}

/// `get_compensation`: the employer's pay, else Indeed's estimate.
fn compensation(c: &Value) -> Option<Compensation> {
    let (mut pay, mut currency) = (&c["baseSalary"], &c["currencyCode"]);
    if !crate::truthy(pay) && crate::truthy(&c["estimated"]) {
        (pay, currency) = (&c["estimated"]["baseSalary"], &c["estimated"]["currencyCode"]);
    }
    if !crate::truthy(pay) {
        return None;
    }
    matches!(
        pay["unitOfWork"].as_str(),
        Some("HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR")
    )
    .then_some(())?;
    let range = &pay["range"];
    let amount = |k: &str| match range.get(k) {
        Some(v) => v.as_f64(),
        None => range.get("value").and_then(Value::as_f64),
    };
    let round2 = |v: f64| (v * 100.0).round() / 100.0;
    Some(Compensation {
        min_amount: amount("min").map(round2),
        max_amount: amount("max").map(round2),
        currency: currency.as_str().map(String::from),
    })
}

/// `Indeed._process_job`; `None` where the Python version raises and skips the job.
fn process_job(job: &Value, base_url: &str, country: Country) -> Option<Post> {
    let html = job["description"].as_object()?.get("html")?;
    let description = html.as_str().map(soup::markdown);
    let employer = job
        .get("employer")
        .filter(|e| e.is_object())
        .cloned()
        .unwrap_or(json!({}));
    let dossier = crate::get(&employer, "dossier").cloned().unwrap_or(json!({}));
    let company_page = crate::get(&employer, "relativeCompanyPageUrl").map(crate::pystr);
    let location = job["location"].as_object()?;
    let code = location.get("countryCode").and_then(Value::as_str);
    job["recruit"].as_object()?.get("viewJobUrl")?.as_str()?; // Python parses it (and fails on a missing one)
    let attributes = job["attributes"].as_array()?;
    let keys: Vec<&str> = attributes.iter().map(|a| a["key"].as_str()).collect::<Option<_>>()?;
    let mut job_types: Vec<JobType> = Vec::new();
    for k in &keys {
        let t = if *k == PERMANENT_KEY && country == Country::JAPAN {
            Some(JobType::FULL_TIME)
        } else {
            job_type_of_code(k)
        };
        if let Some(t) = t.filter(|t| !job_types.contains(t)) {
            job_types.push(t);
        }
    }
    let compensation = compensation(job["compensation"].as_object().map(|_| &job["compensation"])?);
    let date_ms = crate::pyint(&job["dateOnIndeed"]);
    let key = crate::pystr(&job["key"]);
    let str_field = |v: &Value| v.as_str().map(String::from);
    Some(Post {
        title: job["title"].as_str()?.to_string(),
        description,
        company_name: crate::get(&employer, "name")
            .and_then(str_field)
            .or_else(|| str_field(&job["sourceEmployerName"])),
        company_url: company_page.map(|p| format!("{base_url}{p}")),
        company_url_direct: crate::get(&dossier, "links").and_then(|l| str_field(&l["corporateWebsite"])),
        location: Some(Location {
            city: location.get("city").and_then(str_field),
            state: location.get("admin1Code").and_then(str_field),
            country: code.map(|c| match Country::from_indeed_code(c) {
                Some(k) => LocCountry::Known(k),
                None => LocCountry::Raw(c.into()),
            }),
        }),
        job_type: job_types,
        compensation,
        date_posted: (date_ms != 0).then(|| unix_date(date_ms.div_euclid(1000))),
        job_url: format!("{base_url}/viewjob?jk={key}"),
        is_remote: Some(keys.contains(&REMOTE_KEY) && !keys.contains(&HYBRID_KEY)),
    })
}

type Listing = (String, Option<Post>);

/// One search response → (jobs by key in first-seen order, next cursor).
pub fn parse_page(data: &Value, base_url: &str, country: Country) -> Result<(Vec<Listing>, Option<String>), Error> {
    let search = data
        .get("data")
        .filter(|d| crate::truthy(d))
        .and_then(|d| d.get("jobSearch"))
        .filter(|s| crate::truthy(s));
    let Some(search) = search else {
        return Err(format!("Indeed: {}", data.get("errors").map_or("None".into(), Value::to_string)).into());
    };
    let mut jobs: Vec<(String, &Value)> = Vec::new();
    for r in search["results"].as_array().ok_or("Indeed: no results")? {
        let job = &r["job"];
        if !crate::truthy(job) {
            continue;
        }
        let key = crate::pystr(&job["key"]);
        match jobs.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = job,
            None => jobs.push((key, job)),
        }
    }
    let cursor = search["pageInfo"]["nextCursor"].as_str().map(String::from);
    Ok((
        jobs.into_iter()
            .map(|(k, j)| (k, process_job(j, base_url, country)))
            .collect(),
        cursor,
    ))
}

pub async fn fetch_indeed(client: &reqwest::Client, input: &SearchInput) -> Result<Vec<Job>, Error> {
    let country = input.country()?;
    let (base_url, extra_headers) = site(country);
    let mut posts: Vec<Post> = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor: Option<String> = None;
    let mut error = None;
    while posts.len() < input.results_wanted {
        let mut req = client
            .post(API_URL)
            .json(&json!({"query": build_query(input, cursor.as_deref())}))
            .timeout(Duration::from_secs(15));
        for (k, v) in HEADERS {
            req = req.header(k, v);
        }
        for (k, v) in &extra_headers {
            req = req.header(*k, v);
        }
        let page = async {
            let r = req.send().await?;
            if r.status() != 200 {
                let status = r.status().as_u16();
                tracing::debug!("Indeed {status}: {}", r.text().await.unwrap_or_default());
                return Err::<_, Error>(format!("Indeed response status code {status}").into());
            }
            parse_page(&r.json::<Value>().await?, &base_url, country)
        }
        .await;
        let (jobs, next) = match page {
            Ok(p) => p,
            Err(e) => {
                error = Some(e);
                break;
            }
        };
        let new_jobs: Vec<_> = jobs.into_iter().filter(|(k, _)| !seen.contains(k)).collect();
        seen.extend(new_jobs.iter().map(|(k, _)| k.clone()));
        let any_new = !new_jobs.is_empty();
        for post in new_jobs.into_iter().filter_map(|(_, p)| p) {
            posts.push(post);
            if posts.len() >= input.results_wanted {
                break;
            }
        }
        cursor = next;
        if !any_new || cursor.is_none() {
            break;
        }
    }
    match error {
        Some(e) if posts.is_empty() => Err(e),
        _ => Ok(to_jobs("indeed", posts, country)),
    }
}
