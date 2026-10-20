//! Job store (PLAN §5): every search result is recorded by canonical URL with first / last seen, so results
//! carry `is_new` ("not seen in an earlier search") and jobs the user dismissed stay out of later searches.

use axum::extract::State;
use axum::routing::{delete, post};
use axum::{Json, Router};
use jumpship_core::Job;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::db::{Db, utcnow};
use crate::error::{ApiResult, Body};
use crate::profile::db_err;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/jobs/dismiss", post(dismiss))
        .route("/api/jobs/dismissed", delete(restore))
}

/// Query parameters that only track the click; everything else (Indeed `jk`, Workday ids…) identifies the job.
fn tracking(key: &str) -> bool {
    let k = key.to_lowercase();
    k.starts_with("utm_")
        || matches!(
            k.as_str(),
            "ref"
                | "refid"
                | "trackingid"
                | "trk"
                | "src"
                | "source"
                | "gh_src"
                | "lever-source"
                | "from"
                | "position"
                | "pagenum"
        )
}

/// Canonical URL (lowercase host, no fragment, tracking params and trailing slash dropped); `id:<id>` when no URL.
pub fn canonical(job: &Job) -> String {
    let Ok(mut u) = reqwest::Url::parse(job.url.trim()) else {
        return format!("id:{}", job.id);
    };
    u.set_fragment(None);
    let kept: Vec<(String, String)> = u.query_pairs().into_owned().filter(|(k, _)| !tracking(k)).collect();
    u.set_query(None);
    if !kept.is_empty() {
        u.query_pairs_mut().extend_pairs(kept);
    }
    let path = u.path().trim_end_matches('/').to_string();
    u.set_path(&path);
    u.to_string()
}

/// Upsert the results; returns them minus dismissed ones (with `is_new` set) and how many were dismissed.
pub fn record(db: &Db, jobs: Vec<Job>) -> rusqlite::Result<(Vec<Job>, usize)> {
    let now = utcnow();
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let (mut kept, mut dismissed) = (Vec::with_capacity(jobs.len()), 0);
    for mut job in jobs {
        let key = canonical(&job);
        let seen: Option<(String, bool)> = tx
            .query_row(
                "SELECT first_seen, dismissed FROM job_store WHERE key = ?1",
                [&key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        tx.execute(
            "INSERT INTO job_store (key, first_seen, last_seen) VALUES (?1, ?2, ?2) \
             ON CONFLICT(key) DO UPDATE SET last_seen = ?2",
            (&key, &now),
        )?;
        match seen {
            Some((_, true)) => dismissed += 1,
            seen => {
                job.is_new = Some(seen.is_none());
                kept.push(job);
            }
        }
    }
    tx.commit()?;
    Ok((kept, dismissed))
}

#[derive(Deserialize)]
struct DismissRequest {
    #[serde(default)]
    id: String,
    #[serde(default)]
    url: String,
}

async fn dismiss(State(st): State<AppState>, Body(req): Body<DismissRequest>) -> ApiResult<Json<Value>> {
    let key = canonical(&Job {
        id: req.id,
        url: req.url,
        ..Job::default()
    });
    let now = utcnow();
    st.db
        .conn()
        .execute(
            "INSERT INTO job_store (key, first_seen, last_seen, dismissed) VALUES (?1, ?2, ?2, 1) \
             ON CONFLICT(key) DO UPDATE SET dismissed = 1",
            (&key, &now),
        )
        .map_err(db_err)?;
    Ok(Json(json!({"ok": true})))
}

async fn restore(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let n = st
        .db
        .conn()
        .execute("UPDATE job_store SET dismissed = 0 WHERE dismissed = 1", [])
        .map_err(db_err)?;
    Ok(Json(json!({"restored": n})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, url: &str) -> Job {
        Job {
            id: id.into(),
            url: url.into(),
            ..Job::default()
        }
    }

    #[test]
    fn canonical_urls() {
        assert_eq!(
            canonical(&job(
                "x",
                "https://WWW.Example.com/jobs/1/?utm_source=a&jk=9&trk=b#apply"
            )),
            "https://www.example.com/jobs/1?jk=9"
        );
        assert_eq!(canonical(&job("x", "")), "id:x");
    }

    /// Acceptance (PLAN §5 job store): new on first sight only; a dismissed job leaves later results until restored.
    #[test]
    fn new_and_dismissed() {
        let db = Db::memory();
        let a = job("a", "https://example.com/a?utm_medium=x");
        let b = job("b", "https://example.com/b");
        let (got, n) = record(&db, vec![a.clone()]).unwrap();
        assert_eq!((got[0].is_new, n), (Some(true), 0));

        let (got, _) = record(&db, vec![a.clone(), b.clone()]).unwrap();
        let flags: Vec<_> = got.iter().map(|j| (j.id.as_str(), j.is_new)).collect();
        assert_eq!(flags, [("a", Some(false)), ("b", Some(true))]);

        // Dismissed by its bare URL: the tracking-param variant is the same job.
        db.conn()
            .execute(
                "UPDATE job_store SET dismissed = 1 WHERE key = ?1",
                [canonical(&job("a", "https://example.com/a"))],
            )
            .unwrap();
        let (got, n) = record(&db, vec![a.clone(), b.clone()]).unwrap();
        assert_eq!((got.len(), got[0].id.as_str(), n), (1, "b", 1));
    }
}
