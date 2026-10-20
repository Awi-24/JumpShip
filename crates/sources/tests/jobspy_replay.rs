//! LinkedIn / Indeed / Glassdoor against the recorded exchanges of tests/fixtures/sources/<board>/request.json
//! (the same recordings tests/unit/test_source_parsers.py replays through the vendored JobSpy): the requests we
//! build must match the recorded ones and the parsed jobs must equal <board>/expected.json.

use std::fs;
use std::path::{Path, PathBuf};

use jumpship_sources::jobspy::{Country, SearchInput, glassdoor, indeed, linkedin, to_jobs};
use serde_json::{Value, json};

fn dir(board: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/sources")
        .join(board)
}

fn read(board: &str, file: &str) -> String {
    fs::read_to_string(dir(board).join(file)).unwrap()
}

fn json_file(board: &str, file: &str) -> Value {
    serde_json::from_str(&read(board, file)).unwrap()
}

fn spec(board: &str) -> (Value, SearchInput) {
    let spec = json_file(board, "request.json");
    let call = &spec["call"];
    let input = SearchInput {
        keywords: serde_json::from_value(call["keywords"].clone()).unwrap(),
        location: call["location"].as_str().unwrap_or("").into(),
        job_type: call["job_type"].as_str().map(String::from),
        results_wanted: call["results_wanted"].as_u64().unwrap() as usize,
        country: call["country_indeed"].as_str().unwrap().into(),
        is_remote: call["is_remote"].as_bool().unwrap(),
        hours_old: call["hours_old"].as_u64().map(|h| h as u32),
    };
    (spec, input)
}

fn request<'a>(spec: &'a Value, name: &str) -> &'a Value {
    spec["requests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == name)
        .unwrap()
}

fn assert_jobs(board: &str, got: Vec<jumpship_sources::Job>) {
    let expected = json_file(board, "expected.json");
    let got = json!(got);
    for (i, (g, e)) in got
        .as_array()
        .unwrap()
        .iter()
        .zip(expected.as_array().unwrap())
        .enumerate()
    {
        for k in e.as_object().unwrap().keys() {
            assert_eq!(g.get(k), e.get(k), "{board} job {i} field {k}");
        }
    }
    assert_eq!(got, expected, "{board}: job lists differ");
}

#[test]
fn linkedin_replay() {
    let (spec, input) = spec("linkedin");
    let search = request(&spec, "search");
    let url =
        reqwest::Url::parse_with_params(search["url"].as_str().unwrap(), linkedin::search_params(&input, 0)).unwrap();
    assert_eq!(url.as_str(), search["full_url_sent"]);

    let mut posts = Vec::new();
    for (id, post) in linkedin::parse_search_page(&read("linkedin", "search_page.html")) {
        let Some(mut post) = post else { continue };
        post.job_url = format!("https://www.linkedin.com/jobs/view/{id}");
        let detail = spec["requests"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["url"] == post.job_url.as_str())
            .unwrap();
        linkedin::parse_job_page(&read("linkedin", detail["response_file"].as_str().unwrap()), &mut post);
        posts.push(post);
        if posts.len() >= input.results_wanted {
            break;
        }
    }
    assert_jobs(
        "linkedin",
        to_jobs("linkedin", posts, Country::from_name(&input.country).unwrap()),
    );
}

#[test]
fn indeed_replay() {
    let (_, input) = spec("indeed");
    let body = json_file("indeed", "request_body.json");
    assert_eq!(indeed::build_query(&input, None), body["query"].as_str().unwrap());

    let country = Country::from_name(&input.country).unwrap();
    let (base_url, headers) = indeed::site(country);
    assert_eq!(base_url, "https://br.indeed.com");
    assert_eq!(
        headers,
        vec![("indeed-co", "BR".to_string()), ("indeed-locale", "pt-BR".to_string())]
    );

    let (jobs, _) = indeed::parse_page(&json_file("indeed", "search_response.json"), &base_url, country).unwrap();
    let posts: Vec<_> = jobs
        .into_iter()
        .filter_map(|(_, p)| p)
        .take(input.results_wanted)
        .collect();
    assert_jobs("indeed", to_jobs("indeed", posts, country));
}

#[test]
fn glassdoor_replay() {
    let (spec, input) = spec("glassdoor");
    let country = Country::from_name(&input.country).unwrap();
    let base_url = country.glassdoor_url().unwrap();
    assert_eq!(
        glassdoor::autocomplete_url(&base_url, &input.location),
        request(&spec, "location_autocomplete")["url"]
    );

    let vars = glassdoor::search_variables(&input, &json_file("glassdoor", "autocomplete_response.json")).unwrap();
    assert_eq!(
        glassdoor::search_body(&vars, 1, None),
        json_file("glassdoor", "request_body.json")
    );

    let frozen = spec["frozen_now"].as_str().unwrap();
    let today = days_from_civil(
        frozen[..4].parse().unwrap(),
        frozen[5..7].parse().unwrap(),
        frozen[8..10].parse().unwrap(),
    );
    let (listings, _) = glassdoor::parse_page(
        &json_file("glassdoor", "search_response.json"),
        1,
        &base_url,
        &input,
        today,
    )
    .unwrap();
    let posts: Vec<_> = listings
        .into_iter()
        .filter_map(|(_, p)| p.ok().flatten())
        .take(input.results_wanted)
        .collect();
    assert_jobs("glassdoor", to_jobs("glassdoor", posts, country));
}

/// Days since 1970-01-01 (Howard Hinnant's days_from_civil).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}
