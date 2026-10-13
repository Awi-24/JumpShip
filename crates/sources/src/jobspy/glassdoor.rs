//! Glassdoor GraphQL search. Port of `jobspy/glassdoor` (without the job-details call: JumpShip never
//! asks Glassdoor for descriptions).
//!
//! ponytail: plain reqwest; Glassdoor's Cloudflare wants a Chrome TLS fingerprint (JobSpy uses curl_cffi),
//! so live calls may get 403 until this client is swapped for an impersonating one (wreq) or the CDP browser.

use std::collections::HashSet;
use std::time::Duration;

use jumpship_core::Job;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};

use super::{Compensation, JobType, LocCountry, Location, Post, SearchInput, to_jobs};
use crate::{Error, pyint, pystr, truthy, unix_date};

const JOBS_PER_PAGE: u32 = 100;
const CSRF_TOKEN: &str = "Ft6oHEWlRZrxDww95Cpazw:0pGUrkb2y3TyOpAIqF2vbPmUXoXVkD3oEGDVkvfeCerceQ5-n8mBg3BovySUIjmCPHCaW0H2nQVdqzbtsYqf4Q:wcqRqeegRUa9MVLJGyujVXB7vWFPjdaS1CtrrzJq-ok";
/// Python `urllib.parse.quote(s)` (keeps "/").
const QUOTE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'_')
    .remove(b'.')
    .remove(b'-')
    .remove(b'~')
    .remove(b'/');

const GLASSDOOR_QUERY: &str = r#"
query JobSearchResultsQuery(
    $keyword: String,
    $locationId: Int,
    $locationType: LocationTypeEnum,
    $numJobsToShow: Int!,
    $pageCursor: String,
    $pageNumber: Int,
    $filterParams: [FilterParams],
    $parameterUrlInput: String
) {
    jobListings(
        contextHolder: {
            searchParams: {
                keyword: $keyword,
                locationId: $locationId,
                locationType: $locationType,
                numPerPage: $numJobsToShow,
                pageCursor: $pageCursor,
                pageNumber: $pageNumber,
                filterParams: $filterParams,
                parameterUrlInput: $parameterUrlInput,
                searchType: SR
            }
        }
    ) {
        jobListings {
            jobview {
                header {
                    adOrderSponsorshipLevel
                    ageInDays
                    employer {
                        id
                    }
                    employerNameFromSearch
                    jobTypeKeys
                    locationName
                    locationType
                    payCurrency
                    payPeriod
                    payPeriodAdjustedPay {
                        p10
                        p90
                    }
                    rating
                    remoteWorkTypes
                }
                job {
                    jobTitleText
                    listingId
                }
                map {
                    country
                }
                overview {
                    headquarters
                    overview {
                        description
                    }
                    primaryIndustry {
                        industryName
                    }
                    revenue
                    size
                    squareLogoUrl
                    website
                }
            }
        }
        paginationCursors {
            cursor
            pageNumber
        }
    }
}
"#;

pub fn autocomplete_url(base_url: &str, location: &str) -> String {
    format!(
        "{base_url}/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY&caller=jobs&term={}",
        utf8_percent_encode(location, QUOTE)
    )
}

fn filters(input: &SearchInput) -> Vec<Value> {
    let mut f: Vec<(&str, String)> = Vec::new();
    if !input.location.is_empty() {
        f.push(("radius", "50".into()));
    }
    if let Some(h) = input.hours_old.filter(|h| *h > 0) {
        f.push(("fromAge", h.div_ceil(24).to_string()));
    }
    let code = match input.job_type() {
        Some(JobType::FULL_TIME) => Some("fulltime"),
        Some(JobType::PART_TIME) => Some("parttime"),
        Some(JobType::CONTRACT) => Some("contract"),
        Some(JobType::INTERNSHIP) => Some("internship"),
        Some(JobType::TEMPORARY) => Some("temporary"),
        _ => None,
    };
    if let Some(code) = code {
        f.push(("jobType", code.into()));
    }
    if input.is_remote {
        f.push(("remoteWorkType", "1".into()));
    }
    f.into_iter()
        .map(|(k, v)| json!({"filterKey": k, "values": v}))
        .collect()
}

/// `_search_variables` given the autocomplete answer; `None` when the location isn't found.
pub fn search_variables(input: &SearchInput, places: &Value) -> Option<Value> {
    let mut vars =
        json!({"keyword": input.search_term(), "numJobsToShow": JOBS_PER_PAGE, "filterParams": filters(input)});
    if input.location.is_empty() {
        return Some(vars);
    }
    let first = places.as_array().and_then(|p| p.first())?;
    let id = pyint(&first["locationId"]);
    let kind = match first["locationType"].as_str()? {
        "C" => "CITY",
        "S" => "STATE",
        "N" => "COUNTRY",
        _ => return None,
    };
    vars["locationId"] = json!(id);
    vars["locationType"] = json!(kind);
    vars["parameterUrlInput"] = json!(format!("IL.0,12_I{kind}{id}"));
    Some(vars)
}

/// Body of the `/graph` POST for one search page.
pub fn search_body(variables: &Value, page: u32, cursor: Option<&str>) -> Value {
    let mut vars = variables.clone();
    vars["pageNumber"] = json!(page);
    vars["pageCursor"] = json!(cursor);
    json!([{"operationName": "JobSearchResultsQuery", "variables": vars, "query": GLASSDOOR_QUERY}])
}

/// `Glassdoor._parse_location`.
fn parse_location(header: &Value, country: Option<&str>) -> Option<Location> {
    let name = header["locationName"]
        .as_str()
        .filter(|n| !n.is_empty() && *n != "Remote")?;
    let raw = |c: &str| Some(LocCountry::Raw(c.to_string()));
    Some(match header["locationType"].as_str() {
        Some("N") => Location {
            country: raw(country.unwrap_or(name)),
            ..Location::default()
        },
        Some("S") => Location {
            state: Some(name.into()),
            country: country.and_then(raw),
            ..Location::default()
        },
        _ => {
            let parts: Vec<&str> = name.split(", ").collect();
            Location {
                city: Some(parts[0].into()),
                state: (parts.len() > 1).then(|| parts[parts.len() - 1].into()),
                country: country.and_then(raw),
            }
        }
    })
}

/// `Glassdoor._process_job`. `Ok(None)`: too old for `hours_old`; `Err`: Python raises and skips the job.
fn process_job(job: &Value, base_url: &str, input: &SearchInput, today: i64) -> Result<Option<Post>, ()> {
    let header = &job["header"];
    let age = header["ageInDays"].as_i64().ok_or(())?;
    if let Some(h) = input.hours_old.filter(|h| *h > 0)
        && age >= i64::from(h.div_ceil(24))
    {
        return Ok(None);
    }
    let job_id = pyint(&job["job"]["listingId"]);
    let company_id = header["employer"]
        .as_object()
        .ok_or(())?
        .get("id")
        .cloned()
        .unwrap_or(Value::Null);
    let company = job["overview"].as_object().ok_or(())?;
    let mut website = company
        .get("website")
        .and_then(Value::as_str)
        .filter(|w| !w.is_empty())
        .map(String::from);
    if let Some(w) = website.as_mut().filter(|w| !w.starts_with("http")) {
        *w = format!("https://{w}");
    }
    let job_type = header["jobTypeKeys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|k| {
            k.as_str()
                .and_then(|k| JobType::parse(k.rsplit('.').next().unwrap_or(k)))
        })
        .collect();
    header["adOrderSponsorshipLevel"].as_str().ok_or(())?; // Python calls `.lower()` on it
    let compensation = match header.get("payPeriodAdjustedPay").filter(|p| truthy(p)) {
        Some(p) => {
            let round2 = |v: f64| (v * 100.0).round() / 100.0;
            Some(Compensation {
                min_amount: Some(round2(p["p10"].as_f64().ok_or(())?)),
                max_amount: Some(round2(p["p90"].as_f64().ok_or(())?)),
                currency: header["payCurrency"].as_str().map(String::from),
            })
        }
        None => None,
    };
    let work_from_home = header["remoteWorkTypes"]
        .as_array()
        .is_some_and(|t| t.iter().any(|x| x == "WORK_FROM_HOME"));
    Ok(Some(Post {
        title: job["job"]["jobTitleText"].as_str().ok_or(())?.to_string(),
        company_name: header["employerNameFromSearch"].as_str().map(String::from),
        company_url: truthy(&company_id).then(|| format!("{base_url}/Overview/W-EI_IE{}.htm", pystr(&company_id))),
        location: parse_location(
            header,
            job["map"].as_object().ok_or(())?.get("country").and_then(Value::as_str),
        ),
        job_url: format!("{base_url}/job-listing/j?jl={job_id}"),
        date_posted: Some(unix_date((today - age) * 86_400)),
        job_type,
        is_remote: Some(work_from_home || header["locationName"] == "Remote"),
        compensation,
        company_url_direct: website,
        ..Post::default()
    }))
}

type Listing = (String, Result<Option<Post>, ()>);

/// One `/graph` answer → (listings as (listing id, post), cursor of the next page). `today`: days since the epoch.
pub fn parse_page(
    answer: &Value,
    page: u32,
    base_url: &str,
    input: &SearchInput,
    today: i64,
) -> Result<(Vec<Listing>, Option<String>), Error> {
    let answer = &answer[0];
    let result = answer
        .get("data")
        .filter(|d| truthy(d))
        .and_then(|d| d.get("jobListings"))
        .filter(|r| truthy(r));
    let Some(result) = result else {
        return Err(format!(
            "Glassdoor: API error: {}",
            answer.get("errors").map_or("None".into(), Value::to_string)
        )
        .into());
    };
    // Python builds {pageNumber: cursor}: the last entry for a page number wins.
    let cursor = result["paginationCursors"]
        .as_array()
        .into_iter()
        .flatten()
        .rev()
        .find(|c| pyint(&c["pageNumber"]) == i64::from(page) + 1)
        .and_then(|c| c["cursor"].as_str().map(String::from));
    let listings = result["jobListings"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| {
            let job = &l["jobview"];
            let id = &job["job"]["listingId"];
            (!id.is_null()).then(|| (pystr(id), process_job(job, base_url, input, today)))
        })
        .collect();
    Ok((listings, cursor))
}

/// Days since the Unix epoch, UTC.
fn today() -> i64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    secs.div_euclid(86_400)
}

pub async fn fetch_glassdoor(client: &reqwest::Client, input: &SearchInput) -> Result<Vec<Job>, Error> {
    let country = input.country()?;
    let base_url = country
        .glassdoor_url()
        .ok_or_else(|| format!("Glassdoor is not available for {}", input.country))?;
    let with_headers =
        |req: reqwest::RequestBuilder| req.header("gd-csrf-token", CSRF_TOKEN).timeout(Duration::from_secs(15));

    let r = with_headers(client.get(autocomplete_url(&base_url, &input.location)))
        .send()
        .await?;
    if r.status() != 200 {
        return Err(format!("Glassdoor response status code {}", r.status().as_u16()).into());
    }
    let places: Value = if input.location.is_empty() {
        Value::Null
    } else {
        r.json().await?
    };
    let variables = search_variables(input, &places)
        .ok_or_else(|| format!("Glassdoor: location '{}' not found", input.location))?;

    let mut posts = Vec::new();
    let mut seen = HashSet::new();
    let mut page = 1;
    let mut cursor: Option<String> = None;
    let mut error = None;
    while posts.len() < input.results_wanted {
        let res = async {
            let body = search_body(&variables, page, cursor.as_deref());
            let r = with_headers(client.post(format!("{base_url}/graph")).json(&body))
                .send()
                .await?;
            if r.status() != 200 {
                return Err::<_, Error>(format!("Glassdoor response status code {}", r.status().as_u16()).into());
            }
            parse_page(&r.json::<Value>().await?, page, &base_url, input, today())
        }
        .await;
        let (listings, next) = match res {
            Ok(p) => p,
            Err(e) => {
                error = Some(e);
                break;
            }
        };
        let seen_before = seen.len();
        for (id, post) in listings {
            if !seen.insert(id) {
                continue;
            }
            if let Ok(Some(post)) = post {
                posts.push(post);
                if posts.len() >= input.results_wanted {
                    break;
                }
            }
        }
        cursor = next;
        if cursor.is_none() || seen.len() == seen_before {
            break;
        }
        page += 1;
    }
    match error {
        Some(e) if posts.is_empty() => Err(e),
        _ => Ok(to_jobs("glassdoor", posts, country)),
    }
}
