//! `routers/applications.py`: the job tracker (table `applications`).

use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, put};
use axum::{Json, Router};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{row_json, utcnow};
use crate::error::{ApiError, ApiResult, Body};
use crate::profile::db_err;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/applications", get(list).post(create))
        .route("/api/applications/{id}/status", put(update_status))
        .route("/api/applications/{id}", delete(remove))
        .route("/api/applications/stats/summary", get(stats))
}

const STATUSES: &[&str] = &["saved", "applying", "applied", "interviewing", "offered", "rejected"];
const COLS: &str = "id, job_id, job_title, company_name, job_url, site, status, is_easy_apply, notes, analysis_id, \
                    assessment_data, match_score, job_description, applied_at, created_at, updated_at";

/// `_app_to_dict`.
fn to_dict(r: &rusqlite::Row) -> rusqlite::Result<Map<String, Value>> {
    let mut m = row_json(
        r,
        &["assessment_data"],
        &["is_easy_apply"],
        &["applied_at", "created_at", "updated_at"],
    )?;
    // bool(None) is False.
    m.entry("is_easy_apply")
        .and_modify(|v| *v = json!(v.as_bool().unwrap_or(false)));
    Ok(m)
}

fn fetch(st: &AppState, id: &str) -> ApiResult<Option<Map<String, Value>>> {
    st.db
        .conn()
        .query_row(&format!("SELECT {COLS} FROM applications WHERE id = ?1"), [id], to_dict)
        .optional()
        .map_err(db_err)
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
}

async fn list(State(st): State<AppState>, Query(q): Query<ListQuery>) -> ApiResult<Json<Value>> {
    let conn = st.db.conn();
    let status = q.status.filter(|s| !s.is_empty());
    let sql = format!(
        "SELECT {COLS} FROM applications {} ORDER BY created_at DESC",
        if status.is_some() { "WHERE status = ?1" } else { "" }
    );
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let rows: Vec<_> = match &status {
        Some(s) => stmt.query_map([s], to_dict),
        None => stmt.query_map([], to_dict),
    }
    .and_then(|rows| rows.collect::<Result<_, _>>())
    .map_err(db_err)?;
    Ok(Json(json!({"count": rows.len(), "applications": rows})))
}

/// Legacy `saved_jobs` (title, company_name, job_url, site).
type SavedJob = (String, Option<String>, Option<String>, Option<String>);

#[derive(Deserialize)]
struct CreateRequest {
    job_id: Option<String>,
    job_title: String,
    company_name: Option<String>,
    job_url: Option<String>,
    site: Option<String>,
    notes: Option<String>,
    analysis_id: Option<String>,
    status: Option<String>,
    is_easy_apply: Option<bool>,
    assessment_data: Option<Map<String, Value>>,
    match_score: Option<f64>,
    job_description: Option<String>,
}

async fn create(State(st): State<AppState>, Body(req): Body<CreateRequest>) -> ApiResult<Json<Value>> {
    let conn = st.db.conn();
    let (mut title, mut company, mut url, mut site) = (Some(req.job_title), req.company_name, req.job_url, req.site);
    if let Some(job_id) = req.job_id.as_deref().filter(|j| !j.is_empty()) {
        // Legacy saved_jobs row fills what the request left empty.
        let saved: Option<SavedJob> = conn
            .query_row(
                "SELECT title, company_name, job_url, site FROM saved_jobs WHERE id = ?1",
                [job_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(db_err)?;
        if let Some((t, c, u, s)) = saved {
            let fill = |cur: Option<String>, saved: Option<String>| cur.filter(|v| !v.is_empty()).or(saved);
            title = fill(title, Some(t));
            company = fill(company, c);
            url = fill(url, u);
            site = fill(site, s);
        }
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM applications WHERE job_id = ?1 AND job_url IS ?2",
                params![job_id, url],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if let Some(id) = existing {
            return Ok(Json(
                json!({"message": "Application already exists", "id": id, "already_existed": true}),
            ));
        }
    }
    let status = req
        .status
        .filter(|s| STATUSES.contains(&s.as_str()))
        .unwrap_or_else(|| "saved".into());
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO applications (id, job_id, job_title, company_name, job_url, site, notes, analysis_id, status, \
         is_easy_apply, assessment_data, match_score, job_description) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            req.job_id,
            title,
            company,
            url,
            site,
            req.notes,
            req.analysis_id,
            status,
            req.is_easy_apply.unwrap_or(false),
            req.assessment_data.map(|m| Value::Object(m).to_string()),
            req.match_score.map(|s| s.round() as i64),
            req.job_description,
        ],
    )
    .map_err(db_err)?;
    Ok(Json(
        json!({"message": "Application created", "id": id, "already_existed": false}),
    ))
}

#[derive(Deserialize)]
struct StatusRequest {
    status: String,
    notes: Option<String>,
}

async fn update_status(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Body(req): Body<StatusRequest>,
) -> ApiResult<Json<Map<String, Value>>> {
    if !STATUSES.contains(&req.status.as_str()) {
        return Err(ApiError::new(
            400,
            format!("Invalid status '{}'. Valid: {}", req.status, STATUSES.join(", ")),
        ));
    }
    fetch(&st, &id)?.ok_or_else(|| ApiError::new(404, "Application not found."))?;
    {
        let conn = st.db.conn();
        // Notes only overwrite when non-empty (the tracker re-sends the status to save notes).
        conn.execute(
            "UPDATE applications SET status = ?1, notes = COALESCE(NULLIF(?2, ''), notes), \
             applied_at = CASE WHEN ?1 = 'applied' THEN ?3 ELSE applied_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![req.status, req.notes, utcnow(), id],
        )
        .map_err(db_err)?;
    }
    Ok(Json(fetch(&st, &id)?.unwrap_or_default()))
}

async fn remove(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let n = st
        .db
        .conn()
        .execute("DELETE FROM applications WHERE id = ?1", [&id])
        .map_err(db_err)?;
    if n == 0 {
        return Err(ApiError::new(404, "Application not found."));
    }
    Ok(Json(json!({"message": "Application deleted"})))
}

async fn stats(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = st.db.conn();
    let mut stmt = conn.prepare("SELECT status FROM applications").map_err(db_err)?;
    let statuses: Vec<Option<String>> = stmt
        .query_map([], |r| r.get(0))
        .and_then(|r| r.collect())
        .map_err(db_err)?;
    let by_status: Map<String, Value> = STATUSES
        .iter()
        .map(|s| {
            (
                s.to_string(),
                json!(statuses.iter().filter(|x| x.as_deref() == Some(s)).count()),
            )
        })
        .collect();
    Ok(Json(json!({"total": statuses.len(), "by_status": by_status})))
}
