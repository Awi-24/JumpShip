//! `backend/routers/jobs_v2.py` job endpoints: search, assess, assess-batch, suggest / translate keywords.

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue};
use axum::{Json, Router, routing::post};
use futures::future::join_all;
use jumpship_core::Job;
use jumpship_sources::search::{self, Query, Status};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::AppState;
use crate::error::{ApiError, ApiResult, Body};
use crate::llm::{LlmClient, Override, load, parse_json, render, strip_fences};
use crate::web_search;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/jobs/search", post(search_jobs))
        .route("/api/jobs/assess", post(assess))
        .route("/api/jobs/assess-batch", post(assess_batch))
        .route("/api/jobs/suggest-keywords", post(suggest_keywords))
        .route("/api/jobs/translate-keywords", post(translate_keywords))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ResumeProfile {
    pub name: String,
    pub title: String,
    pub email: String,
    pub phone: String,
    pub location_city: String,
    pub location_country: String,
    pub skills: Vec<String>,
    pub experience_years: i64,
    pub domains: Vec<String>,
    pub suggested_keywords: Vec<String>,
    pub suggested_titles: Vec<String>,
    pub raw_text: String,
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(default)]
struct SearchRequest {
    keywords: Vec<String>,
    location: String,
    job_type: String,
    sites: Vec<String>,
    results_wanted: usize,
    hours_old: Option<u32>,
    work_mode: String,
}

impl Default for SearchRequest {
    fn default() -> Self {
        SearchRequest {
            keywords: vec![],
            location: "Remote".into(),
            job_type: "fulltime".into(),
            sites: ["linkedin", "indeed", "glassdoor"].map(String::from).to_vec(),
            results_wanted: 20,
            hours_old: None,
            work_mode: "any".into(),
        }
    }
}

/// Python `json.dumps(status)`: `", "` / `": "` separators, non-ASCII as `\uXXXX`.
pub fn status_header(status: &Status) -> String {
    let body: Vec<String> = status
        .iter()
        .map(|(site, s)| {
            format!(
                "{}: {{\"count\": {}, \"error\": {}}}",
                json!(site),
                s.count,
                json!(s.error)
            )
        })
        .collect();
    let mut out = String::new();
    for c in format!("{{{}}}", body.join(", ")).chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            for unit in c.encode_utf16(&mut [0; 2]) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

async fn search_jobs(
    State(st): State<AppState>,
    Body(req): Body<SearchRequest>,
) -> ApiResult<(HeaderMap, Json<Vec<Job>>)> {
    if req.keywords.is_empty() {
        return Err(ApiError::new(400, "At least one keyword is required."));
    }
    let q = Query {
        keywords: req.keywords,
        location: req.location,
        job_type: req.job_type,
        sites: req.sites,
        results_wanted: req.results_wanted,
        hours_old: req.hours_old,
        work_mode: req.work_mode,
    };
    let (jobs, status) = search::search(&st.http, &q).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        "X-Source-Status",
        HeaderValue::from_str(&status_header(&status)).unwrap(),
    );
    // JobResult always carries is_remote / tags.
    let jobs = jobs
        .into_iter()
        .map(|mut j| {
            j.is_remote.get_or_insert(None);
            j.tags.get_or_insert_with(Vec::new);
            j
        })
        .collect();
    Ok((headers, Json(jobs)))
}

// ── Assessment ──────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct JobAssessment {
    pub match_score: i64,
    pub summary: String,
    pub strong_points: Vec<String>,
    pub gaps: Vec<String>,
    pub career_suggestions: Vec<String>,
    pub company_insights: String,
    pub income_range: String,
    pub is_relevant: bool,
    pub job_tags: Vec<String>,
    pub keywords_matched: Vec<String>,
    pub keywords_missing: Vec<String>,
    pub resume_generation_triggered: bool,
    pub hire_recommendation: String,
}

impl Default for JobAssessment {
    fn default() -> Self {
        JobAssessment {
            match_score: 0,
            summary: String::new(),
            strong_points: vec![],
            gaps: vec![],
            career_suggestions: vec![],
            company_insights: String::new(),
            income_range: String::new(),
            is_relevant: true,
            job_tags: vec![],
            keywords_matched: vec![],
            keywords_missing: vec![],
            resume_generation_triggered: false,
            hire_recommendation: "borderline".into(),
        }
    }
}

/// `JobAssessment(**data)` with pydantic's lax coercions: null → default, "85" / 85.0 → 85.
pub fn assessment_from(mut data: Value) -> Result<JobAssessment, String> {
    let obj = data.as_object_mut().ok_or("LLM returned JSON that is not an object")?;
    obj.retain(|_, v| !v.is_null());
    if let Some(score) = obj.get_mut("match_score") {
        let n = match &*score {
            Value::String(s) => s.trim().parse::<f64>().ok(),
            v => v.as_f64(),
        };
        *score = json!(n.ok_or("match_score is not a number")?.round() as i64);
    }
    serde_json::from_value(data).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct AssessRequest {
    job: Job,
    resume_profile: ResumeProfile,
    #[serde(default = "yes")]
    include_company_research: bool,
    #[serde(flatten)]
    llm: Override,
}

#[derive(Deserialize)]
struct BatchRequest {
    jobs: Vec<Job>,
    resume_profile: ResumeProfile,
    #[serde(default)]
    include_company_research: bool,
    #[serde(flatten)]
    llm: Override,
}

fn yes() -> bool {
    true
}

fn or<'a>(s: &'a str, fallback: &'a str) -> &'a str {
    if s.is_empty() { fallback } else { s }
}

fn chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn assess_user(p: &ResumeProfile, job: &Job, company_context: &str) -> String {
    let skills: Vec<_> = p.skills.iter().take(20).cloned().collect();
    render(
        "assess_user",
        &[
            ("name", or(&p.name, "Unknown")),
            ("title", &p.title),
            ("experience_years", &p.experience_years.to_string()),
            ("skills", or(&skills.join(", "), "Not specified")),
            ("domains", or(&p.domains.join(", "), "Not specified")),
            ("resume_extract", or(&chars(&p.raw_text, 1500), "Not available")),
            ("job_title", &job.title),
            ("company", &job.company),
            ("location", &job.location),
            (
                "salary",
                or(&job.salary_range, "NOT DISCLOSED — estimate from market data"),
            ),
            ("site", &job.site),
            (
                "description",
                or(&chars(&job.description, 2500), "No description available."),
            ),
            ("company_context", company_context),
        ],
    )
}

/// `"\n" + assess_company_context + "\n"` when researching, else "".
fn company_context(research: bool, info: &str) -> String {
    if !research {
        return String::new();
    }
    let info = or(
        info,
        "No external data found. Use your training knowledge about this company if available.",
    );
    format!("\n{}\n", render("assess_company_context", &[("company_info", info)]))
}

async fn run_assessment(
    st: &AppState,
    llm: &LlmClient,
    p: &ResumeProfile,
    job: &Job,
    research: bool,
) -> Result<JobAssessment, String> {
    let info = if research && !job.company.is_empty() {
        web_search::company_info(&st.http, &job.company, &job.title).await
    } else {
        String::new()
    };
    let company_context = company_context(research, &info);
    let raw = llm
        .complete(
            &st.http,
            load("assess_system"),
            &assess_user(p, job, &company_context),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
    // Unparseable output is an error, never a fake score that would pollute the ranking.
    let mut a = assessment_from(parse_json(&raw).map_err(|e| e.to_string())?)?;
    a.resume_generation_triggered = a.match_score >= st.cfg.resume_gen_threshold && a.is_relevant;
    Ok(a)
}

async fn assess(State(st): State<AppState>, Body(req): Body<AssessRequest>) -> ApiResult<Json<JobAssessment>> {
    let llm = LlmClient::from_override(&st.cfg, &req.llm);
    run_assessment(&st, &llm, &req.resume_profile, &req.job, req.include_company_research)
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!("Assessment endpoint error: {e}");
            ApiError::new(500, format!("Assessment failed: {e}"))
        })
}

#[derive(Serialize)]
struct BatchItem {
    job_id: String,
    assessment: Option<JobAssessment>,
    error: Option<String>,
}

async fn assess_batch(State(st): State<AppState>, Body(req): Body<BatchRequest>) -> Json<Vec<BatchItem>> {
    let llm = LlmClient::from_override(&st.cfg, &req.llm);
    let items = join_all(req.jobs.iter().map(|job| async {
        let r = run_assessment(&st, &llm, &req.resume_profile, job, req.include_company_research).await;
        if let Err(e) = &r {
            tracing::warn!("Batch assess failed for job {}: {e}", job.id);
        }
        let (assessment, error) = match r {
            Ok(a) => (Some(a), None),
            Err(e) => (None, Some(e)),
        };
        BatchItem {
            job_id: job.id.clone(),
            assessment,
            error,
        }
    }))
    .await;
    Json(items)
}

// ── Keywords ────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KeywordsRequest {
    keywords: Vec<String>,
    #[serde(default = "pt")]
    target_language: String,
    #[serde(flatten)]
    llm: Override,
}

fn pt() -> String {
    "pt".into()
}

/// One LLM call whose reply must be a JSON array of strings; any failure → empty list.
async fn string_list(st: &AppState, llm: &Override, system: &str, user: &str) -> Vec<String> {
    let llm = LlmClient::from_override(&st.cfg, llm);
    let res = async {
        let raw = llm.complete(&st.http, system, user, None).await?;
        Ok::<Value, crate::llm::Error>(serde_json::from_str(strip_fences(&raw))?)
    }
    .await;
    match res {
        Ok(Value::Array(items)) => items.into_iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        Ok(_) => vec![],
        Err(e) => {
            tracing::warn!("Keyword LLM call failed: {e}");
            vec![]
        }
    }
}

fn suggest_user(keywords: &[String]) -> String {
    render("suggest_keywords_user", &[("keywords", &keywords.join(", "))])
}

fn translate_user(keywords: &[String], target: &str) -> String {
    let lang = match target {
        "pt" => "Portuguese",
        "en" => "English",
        "de" => "German",
        "es" => "Spanish",
        "fr" => "French",
        other => other,
    };
    render(
        "translate_keywords_user",
        &[("language", lang), ("keywords", &keywords.join(", "))],
    )
}

async fn suggest_keywords(State(st): State<AppState>, Body(req): Body<KeywordsRequest>) -> Json<Value> {
    if req.keywords.is_empty() {
        return Json(json!({"suggestions": []}));
    }
    let user = suggest_user(&req.keywords);
    let input: Vec<String> = req.keywords.iter().map(|k| k.to_lowercase()).collect();
    let mut out = string_list(&st, &req.llm, load("suggest_keywords_system"), &user).await;
    out.retain(|s| !input.contains(&s.to_lowercase()));
    out.truncate(10);
    Json(json!({"suggestions": out}))
}

async fn translate_keywords(State(st): State<AppState>, Body(req): Body<KeywordsRequest>) -> Json<Value> {
    if req.keywords.is_empty() {
        return Json(json!({"translations": []}));
    }
    let user = translate_user(&req.keywords, &req.target_language);
    let mut out = string_list(&st, &req.llm, load("translate_keywords_system"), &user).await;
    out.truncate(20);
    Json(json!({"translations": out}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jumpship_sources::search::SiteStatus;

    #[test]
    fn header_matches_python_json_dumps() {
        let status = vec![
            ("gupy".to_string(), SiteStatus { count: 2, error: None }),
            (
                "indeed".to_string(),
                SiteStatus {
                    count: 0,
                    error: Some("Não \"ok\"".into()),
                },
            ),
        ];
        assert_eq!(
            status_header(&status),
            concat!(
                r#"{"gupy": {"count": 2, "error": null}, "#,
                r#""indeed": {"count": 0, "error": "N"#,
                "\\",
                r#"u00e3o \"ok\""}}"#
            )
        );
    }

    #[test]
    fn lax_assessment() {
        let a =
            assessment_from(json!({"match_score": "85", "summary": null, "is_relevant": false, "extra": 1})).unwrap();
        assert_eq!((a.match_score, a.summary.as_str(), a.is_relevant), (85, "", false));
        assert_eq!(a.hire_recommendation, "borderline");
        assert_eq!(assessment_from(json!({"match_score": 72.0})).unwrap().match_score, 72);
        assert!(assessment_from(json!([1])).is_err());
    }

    /// sha256 of Python `json.dumps([[system, user]], ensure_ascii=False)`.
    fn h(system: &str, user: &str) -> String {
        use sha2::Digest;
        let dumped = format!("[[{}, {}]]", json!(system), json!(user));
        sha2::Sha256::digest(dumped.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn prompts_match_python_hashes() {
        // Same inputs and hashes as tests/unit/test_prompts.py (EXPECTED).
        let full = ResumeProfile {
            name: "Ada {Lovelace}".into(),
            title: "Senior ML Engineer".into(),
            experience_years: 5,
            skills: (0..25).map(|i| format!("skill{i}")).collect(),
            domains: vec!["MLOps".into(), "Data {Eng}".into()],
            raw_text: "Résumé text with {braces} and ünïcode. ".repeat(60),
            ..Default::default()
        };
        let job = Job {
            id: "1".into(),
            title: "ML Engineer".into(),
            company: "Acme {Corp}".into(),
            location: "Remote".into(),
            salary_range: "USD 100k".into(),
            site: "linkedin".into(),
            description: "Build {things}.\nSecond line ".repeat(300),
            ..Default::default()
        };
        let sparse_job = Job {
            id: "2".into(),
            title: "Dev".into(),
            ..Default::default()
        };
        let sys = load("assess_system");
        let info = "Acme builds {widgets}.";
        let kws = ["data engineer".to_string(), "{x}".to_string()];
        let cases = [
            (
                h(sys, &assess_user(&full, &job, &company_context(true, info))),
                "cd50ffe0896fd3c6a1e6bb828175d6515730d5ee6fd27ff4800d832e0c1f34f9",
            ),
            (
                h(sys, &assess_user(&full, &job, &company_context(false, info))),
                "9ddcd295a7a49f080498b461b16e55e2f71af8b5734caef4d2d5b1126f93cc0f",
            ),
            (
                h(
                    sys,
                    &assess_user(&ResumeProfile::default(), &sparse_job, &company_context(true, "")), // no company: no lookup,
                ),
                "d4f8b00832bbc81a15b6b68235806f24df11f63298861167e46f7fcc25d8210c",
            ),
            (
                h(
                    load("suggest_keywords_system"),
                    &suggest_user(&["python".into(), "FastAPI {x}".into()]),
                ),
                "af64ffc5b82368380bf504642468b81ea9f71f1328314eb3eaea9b7122a449ad",
            ),
            (
                h(load("translate_keywords_system"), &translate_user(&kws, "pt")),
                "757686d22b3c6949988552885d058cff78b3319ef01b9bbdd66c516256a85fae",
            ),
            (
                h(load("translate_keywords_system"), &translate_user(&kws, "xx")),
                "05c6238182f38ec60d51a50e47516b23b84643a75df1d493526d3110a48adea6",
            ),
        ];
        for (i, (got, want)) in cases.iter().enumerate() {
            assert_eq!(got, want, "case {i}");
        }
    }
}
