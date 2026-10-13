//! `routers/profile.py` (singleton profile row) and `settings.py` `/api/settings/llm-keys` (encrypted key blob).

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{OptionalExtension, params_from_iter};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{row_json, sql};
use crate::error::{ApiError, ApiResult, Body};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/profile", get(get_profile).post(upsert).put(patch))
        .route("/api/settings/llm-keys", get(get_keys).put(put_keys))
}

#[derive(Clone, Copy, PartialEq)]
enum Ty {
    Str,
    Bool,
    Int,
    Dict,
}

const FIELDS: &[(&str, Ty)] = &[
    ("full_name", Ty::Str),
    ("email", Ty::Str),
    ("phone", Ty::Str),
    ("linkedin_url", Ty::Str),
    ("github_url", Ty::Str),
    ("portfolio_url", Ty::Str),
    ("location_city", Ty::Str),
    ("location_state", Ty::Str),
    ("location_country", Ty::Str),
    ("work_authorization", Ty::Str),
    ("willing_to_relocate", Ty::Bool),
    ("preferred_work_mode", Ty::Str),
    ("years_experience", Ty::Int),
    ("highest_degree", Ty::Str),
    ("university", Ty::Str),
    ("graduation_year", Ty::Int),
    ("salary_min", Ty::Int),
    ("salary_max", Ty::Int),
    ("salary_currency", Ty::Str),
    ("custom_answers", Ty::Dict),
    ("extra_info", Ty::Str),
];

const ID: &str = "singleton";

/// `verify_api_key`: enforced only when `API_KEY` is set.
fn check_key(st: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let key = &st.cfg.api_key;
    if key.is_empty() || headers.get("x-api-key").is_some_and(|v| v.as_bytes() == key.as_bytes()) {
        Ok(())
    } else {
        Err(ApiError::new(403, "Invalid or missing API Key"))
    }
}

/// Pydantic lax coercion of one ProfileSchema field (null passes through).
fn coerce(v: &Value, ty: Ty) -> Result<Value, &'static str> {
    Ok(match (ty, v) {
        (_, Value::Null) => Value::Null,
        (Ty::Str, Value::String(_)) | (Ty::Dict, Value::Object(_)) | (Ty::Bool, Value::Bool(_)) => v.clone(),
        (Ty::Bool, Value::Number(n)) if n.as_i64().is_some_and(|n| n == 0 || n == 1) => json!(n.as_i64() == Some(1)),
        (Ty::Bool, Value::String(s)) => match s.to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" | "t" | "y" => json!(true),
            "false" | "0" | "no" | "off" | "f" | "n" => json!(false),
            _ => return Err("Input should be a valid boolean"),
        },
        (Ty::Int, Value::Number(n)) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => json!(i),
            (None, Some(f)) if f.fract() == 0.0 => json!(f as i64),
            _ => return Err("Input should be a valid integer"),
        },
        (Ty::Int, Value::String(s)) => json!(s.trim().parse::<i64>().map_err(|_| "Input should be a valid integer")?),
        (Ty::Str, _) => return Err("Input should be a valid string"),
        (Ty::Bool, _) => return Err("Input should be a valid boolean"),
        (Ty::Int, _) => return Err("Input should be a valid integer"),
        (Ty::Dict, _) => return Err("Input should be a valid dictionary"),
    })
}

/// Validated `(field, value)` pairs present in the body; `keep_null` = PUT's `exclude_unset`.
fn fields(body: &Value, keep_null: bool) -> ApiResult<Vec<(&'static str, Value)>> {
    let obj = body.as_object().cloned().unwrap_or_default();
    let mut out = Vec::new();
    let mut errors = Vec::new();
    for (name, ty) in FIELDS {
        let Some(v) = obj.get(*name) else { continue };
        match coerce(v, *ty) {
            Ok(Value::Null) if !keep_null => {}
            Ok(v) => out.push((*name, v)),
            Err(msg) => errors.push(json!({"loc": ["body", name], "msg": msg, "type": "value_error"})),
        }
    }
    if !body.is_object() {
        errors.push(
            json!({"loc": ["body"], "msg": "Input should be a valid dictionary", "type": "model_attributes_type"}),
        );
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, json!(errors)))
    }
}

fn load(st: &AppState) -> ApiResult<Option<Map<String, Value>>> {
    let cols: Vec<&str> = FIELDS.iter().map(|f| f.0).collect();
    let bools = ["willing_to_relocate"];
    let conn = st.db.conn();
    conn.query_row(
        &format!("SELECT {} FROM user_profiles WHERE id = ?1", cols.join(", ")),
        [ID],
        |r| row_json(r, &["custom_answers"], &bools, &[]),
    )
    .optional()
    .map_err(db_err)
}

pub fn db_err(e: rusqlite::Error) -> ApiError {
    tracing::error!("database error: {e}");
    ApiError::new(500, format!("Database error: {e}"))
}

async fn get_profile(State(st): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Map<String, Value>>> {
    check_key(&st, &headers)?;
    load(&st)?
        .map(Json)
        .ok_or_else(|| ApiError::new(404, "Profile not set up yet."))
}

fn write(st: &AppState, set: Vec<(&'static str, Value)>) -> ApiResult<Json<Map<String, Value>>> {
    {
        let conn = st.db.conn();
        // UserProfile() ORM defaults for a new row.
        conn.execute(
            "INSERT OR IGNORE INTO user_profiles (id, willing_to_relocate, years_experience, salary_currency, custom_answers) \
             VALUES (?1, 0, 0, 'USD', '{}')",
            [ID],
        )
        .map_err(db_err)?;
        if !set.is_empty() {
            let assigns: Vec<String> = set.iter().map(|(k, _)| format!("{k} = ?")).collect();
            let mut values: Vec<_> = set.iter().map(|(_, v)| sql(v)).collect();
            values.push(rusqlite::types::Value::Text(ID.into()));
            conn.execute(
                &format!(
                    "UPDATE user_profiles SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    assigns.join(", ")
                ),
                params_from_iter(values),
            )
            .map_err(db_err)?;
        }
    }
    Ok(Json(load(st)?.unwrap_or_default()))
}

/// POST: upsert with only the non-null fields (`exclude_none`, so it cannot clear a field).
async fn upsert(
    State(st): State<AppState>,
    headers: HeaderMap,
    Body(body): Body<Value>,
) -> ApiResult<Json<Map<String, Value>>> {
    check_key(&st, &headers)?;
    let set = fields(&body, false)?;
    write(&st, set)
}

/// PUT: partial update where an explicit null overwrites (`exclude_unset`).
async fn patch(
    State(st): State<AppState>,
    headers: HeaderMap,
    Body(body): Body<Value>,
) -> ApiResult<Json<Map<String, Value>>> {
    check_key(&st, &headers)?;
    let set = fields(&body, true)?;
    write(&st, set)
}

// ── LLM keys ────────────────────────────────────────────────────────────────────────────────────

/// First profile row by `created_at` (not necessarily the singleton) and its encrypted blob.
fn key_row(st: &AppState) -> ApiResult<Option<(String, Option<String>)>> {
    st.db
        .conn()
        .query_row(
            "SELECT id, llm_keys_encrypted FROM user_profiles ORDER BY created_at LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_err)
}

fn stored_keys(st: &AppState, blob: Option<&str>) -> Map<String, Value> {
    let Some(text) = blob.filter(|b| !b.is_empty()).and_then(|b| st.secrets.decrypt(b)) else {
        return Map::new();
    };
    match serde_json::from_str(&text) {
        Ok(Value::Object(m)) => m.into_iter().filter(|(_, v)| v.is_string()).collect(),
        _ => Map::new(),
    }
}

async fn get_keys(State(st): State<AppState>) -> ApiResult<Json<Map<String, Value>>> {
    let keys = match key_row(&st)? {
        Some((_, blob)) => stored_keys(&st, blob.as_deref()),
        None => Map::new(),
    };
    Ok(Json(
        keys.into_iter()
            .filter(|(_, v)| v.as_str().is_some_and(|s| !s.is_empty()))
            .collect(),
    ))
}

/// Merge `{provider: key}` into the blob; an empty key removes that provider. 204.
async fn put_keys(
    State(st): State<AppState>,
    Body(payload): Body<std::collections::BTreeMap<String, String>>,
) -> ApiResult<StatusCode> {
    let (id, blob) = match key_row(&st)? {
        Some(row) => row,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            st.db
                .conn()
                .execute(
                    "INSERT INTO user_profiles (id, willing_to_relocate, years_experience, salary_currency, custom_answers) \
                     VALUES (?1, 0, 0, 'USD', '{}')",
                    [&id],
                )
                .map_err(db_err)?;
            (id, None)
        }
    };
    let mut current = stored_keys(&st, blob.as_deref());
    for (provider, key) in payload {
        if key.is_empty() {
            current.remove(&provider);
        } else {
            current.insert(provider, json!(key));
        }
    }
    // Python json.dumps separators, so the plaintext matches what the Python backend writes.
    let plain = if current.is_empty() {
        None
    } else {
        let items: Vec<String> = current.iter().map(|(k, v)| format!("{}: {}", json!(k), v)).collect();
        Some(st.secrets.encrypt(&format!("{{{}}}", items.join(", "))))
    };
    st.db
        .conn()
        .execute(
            "UPDATE user_profiles SET llm_keys_encrypted = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![plain, id],
        )
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}
