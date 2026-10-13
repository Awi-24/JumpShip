//! LinkedIn guest search + job pages. Port of `jobspy/linkedin`.

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use jumpship_core::Job;
use regex::Regex;

use super::{Compensation, Country, JobType, LocCountry, Location, Post, SearchInput, iso_date, to_jobs};
use crate::Error;
use crate::soup::{self, Element, Node};

const BASE: &str = "https://www.linkedin.com";
const JOBS_PER_PAGE: usize = 10;
const MAX_RESULTS: usize = 1000;
const EMPTY_PAGE: &str = "<!DOCTYPE html>\n\n<!---->";
const HEADERS: [(&str, &str); 3] = [
    (
        "accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    ),
    ("accept-language", "en-US,en;q=0.9"),
    (
        "user-agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ),
];

/// Query of the guest search endpoint (`{BASE}/jobs-guest/jobs/api/seeMoreJobPostings/search`).
pub fn search_params(input: &SearchInput, start: usize) -> Vec<(&'static str, String)> {
    let mut params = vec![("keywords", input.search_term())];
    if !input.location.is_empty() {
        params.push(("location", input.location.clone()));
    }
    params.push(("distance", "50".into()));
    if let Some(h) = input.hours_old.filter(|h| *h > 0) {
        params.push(("f_TPR", format!("r{}", h * 3600)));
    }
    params.push(("start", start.to_string()));
    params
}

fn class_is<'a>(name: &'a str, class: &'a str) -> impl Fn(&Element) -> bool + 'a {
    move |e: &Element| e.name == name && e.has_class(class)
}

/// `jobspy.linkedin.util.parse_location`.
fn parse_location(text: &str) -> Location {
    static US_STATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{2}$").unwrap());
    let parts: Vec<&str> = text.split(", ").collect();
    let s = |v: &str| Some(v.to_string());
    match parts.as_slice() {
        [city, state, country] => Location {
            city: s(city),
            state: s(state),
            country: Some(LocCountry::Raw(country.to_string())),
        },
        [city, last] if US_STATE.is_match(last) => Location {
            city: s(city),
            state: s(last),
            country: Some(LocCountry::Known(Country::USA)),
        },
        [city, last] => Location {
            city: s(city),
            state: None,
            country: Some(LocCountry::Raw(last.to_string())),
        },
        _ if Country::from_name(text).is_some() => Location {
            country: Some(LocCountry::Raw(text.into())),
            ..Location::default()
        },
        _ => Location {
            city: s(text),
            ..Location::default()
        },
    }
}

/// A job card of a search page → (job id, post without job-page details). `None` when the card is malformed.
fn parse_card(card: &Element) -> Option<Post> {
    let title = card.find(&class_is("h3", "base-search-card__title"))?.text_strip();
    let company_tag = card.find(&class_is("h4", "base-search-card__subtitle"))?;
    let company_url = company_tag
        .find(&|e| e.name == "a" && e.attr("href").is_some())
        .map(|a| a.attr("href").unwrap().split('?').next().unwrap().to_string());
    let location_text = card.find(&class_is("span", "job-search-card__location"))?.text();
    let location = parse_location(soup::py_strip(&location_text));
    let date_posted = card
        .find(&|e| e.name == "time")
        .and_then(|t| t.attr("datetime"))
        .and_then(iso_date);
    let remote_text = format!("{title} {}", location.display()).to_lowercase();
    let is_remote = ["remote", "work from home", "wfh"]
        .iter()
        .any(|k| remote_text.contains(k));
    Some(Post {
        title,
        company_name: Some(company_tag.text_strip()),
        company_url,
        location: Some(location),
        date_posted,
        is_remote: Some(is_remote),
        ..Post::default()
    })
}

/// Cards of one search page: (job id, card element), as `find_all(class_="base-search-card")` yields them.
pub fn parse_search_page(html: &str) -> Vec<(String, Option<Post>)> {
    let doc = soup::parse(html);
    doc.find_all(&|e| e.has_class("base-search-card"))
        .into_iter()
        .map(|card| {
            let id = card
                .attr("data-entity-urn")
                .unwrap_or("")
                .rsplit(':')
                .next()
                .unwrap_or("")
                .to_string();
            (id, parse_card(card))
        })
        .collect()
}

/// `criteria(soup, heading)`: the value under a heading of the job page's criteria list.
fn criteria(doc: &Element, heading: &str) -> Option<String> {
    fn visit(parent: &Element, heading: &str) -> Option<Option<String>> {
        for (i, c) in parent.children.iter().enumerate() {
            let Node::Element(e) = c else { continue };
            if e.name == "h3"
                && e.has_class("description__job-criteria-subheader")
                && single_string(e).is_some_and(|s| s.contains(heading))
            {
                let span = parent.children[i + 1..].iter().find_map(|n| match n {
                    Node::Element(s) if s.name == "span" && s.has_class("description__job-criteria-text") => Some(s),
                    _ => None,
                });
                return Some(span.map(Element::text_strip));
            }
            if let Some(found) = visit(e, heading) {
                return Some(found);
            }
        }
        None
    }
    visit(doc, heading).flatten()
}

/// bs4 `Tag.string`: the only string under a chain of single children.
fn single_string(e: &Element) -> Option<&str> {
    match e.children.as_slice() {
        [Node::Text(t)] | [Node::Comment(t)] => Some(t),
        [Node::Element(child)] => single_string(child),
        _ => None,
    }
}

/// `LinkedIn._parse_salary`: "$117,000.00/yr - $234,000.00/yr".
fn parse_salary(text: &str) -> Option<Compensation> {
    static RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^([^\d\s]+) ?([\d,]+\.\d\d)(/\w+) - [^\d\s]+ ?([\d,]+\.\d\d)/\w+$").unwrap());
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let m = RE.captures(&joined)?;
    let amount = |i: usize| m[i].replace(',', "").parse::<f64>().ok();
    let currency = match &m[1] {
        "$" => "USD",
        "CA$" => "CAD",
        "£" => "GBP",
        "€" => "EUR",
        "₹" => "INR",
        other => other,
    };
    Some(Compensation {
        min_amount: amount(2),
        max_amount: amount(4),
        currency: Some(currency.into()),
    })
}

/// A job page's description (Markdown), pay and employment type.
pub fn parse_job_page(html: &str, post: &mut Post) {
    let doc = soup::parse(html);
    if let Some(div) = doc.find(&class_is("div", "show-more-less-html__markup")) {
        let mut div = div.clone();
        div.attrs.clear();
        post.description = Some(soup::markdown(&soup::prettify(&div)));
    }
    post.compensation = doc
        .find(&class_is("div", "compensation__salary"))
        .and_then(|s| parse_salary(&s.text()));
    let employment = criteria(&doc, "Employment type");
    post.job_type = employment
        .and_then(|t| JobType::parse(&t.to_lowercase().replace('-', "")))
        .into_iter()
        .collect();
}

async fn get(client: &reqwest::Client, url: &str, query: &[(&str, String)]) -> Result<reqwest::Response, Error> {
    let mut req = client.get(url).query(query).timeout(Duration::from_secs(15));
    for (k, v) in HEADERS {
        req = req.header(k, v);
    }
    Ok(req.send().await?)
}

/// Search pages + one job page per result (JumpShip always fetches LinkedIn descriptions).
pub async fn fetch_linkedin(client: &reqwest::Client, input: &SearchInput) -> Result<Vec<Job>, Error> {
    let country = input.country()?;
    let mut posts: Vec<Post> = Vec::new();
    let mut seen = HashSet::new();
    let mut start = 0;
    let mut error: Option<String> = None;
    while posts.len() < input.results_wanted && start < MAX_RESULTS {
        if start > 0 {
            // ponytail: clock-derived jitter instead of a rand dependency (3–7 s, like JobSpy).
            let jitter = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_millis();
            tokio::time::sleep(Duration::from_millis(3000 + u64::from(jitter) * 4)).await;
        }
        let url = format!("{BASE}/jobs-guest/jobs/api/seeMoreJobPostings/search");
        let text = match get(client, &url, &search_params(input, start)).await {
            Ok(r) if r.status() == 200 => r.text().await?,
            Ok(r) => {
                error = Some(format!("LinkedIn response status code {}", r.status().as_u16()));
                break;
            }
            Err(e) => {
                error = Some(format!("LinkedIn: {e}"));
                break;
            }
        };
        let cards = parse_search_page(&text);
        if cards.is_empty() {
            if text.trim() != EMPTY_PAGE {
                error = Some("LinkedIn: unexpected page with no jobs (blocked?)".into());
            }
            break;
        }
        let total = cards.len();
        let new_cards: Vec<_> = cards
            .into_iter()
            .filter(|(id, _)| !id.is_empty() && seen.insert(id.clone()))
            .collect();
        let any_new = !new_cards.is_empty();
        for (id, post) in new_cards {
            let Some(mut post) = post else { continue };
            post.job_url = format!("{BASE}/jobs/view/{id}");
            match get(client, &post.job_url, &[]).await {
                Ok(r) if r.status() == 200 && r.url().path().starts_with("/jobs/view/") => {
                    if let Ok(html) = r.text().await {
                        parse_job_page(&html, &mut post);
                    }
                }
                Ok(r) => tracing::warn!("LinkedIn: job {id}: HTTP {} at {}", r.status(), r.url().path()),
                Err(e) => tracing::warn!("LinkedIn: job {id}: {e}"),
            }
            posts.push(post);
            if posts.len() >= input.results_wanted {
                break;
            }
        }
        if !any_new || total < JOBS_PER_PAGE {
            break;
        }
        start += JOBS_PER_PAGE;
    }
    match error {
        Some(e) if posts.is_empty() => Err(e.into()),
        Some(e) => {
            tracing::warn!("{e}");
            Ok(to_jobs("linkedin", posts, country))
        }
        None => Ok(to_jobs("linkedin", posts, country)),
    }
}
