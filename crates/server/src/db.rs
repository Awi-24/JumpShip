//! SQLite store: opens the Python backend's database in place (docs/rust-migration/schema.sql) and the
//! Fernet secret box of `backend/services/crypto.py`.

use std::sync::{Mutex, MutexGuard};

use base64::Engine;
use rusqlite::Connection;
use rusqlite::types::{Value as Sql, ValueRef};
use serde_json::{Map, Value, json};

pub struct Db(Mutex<Connection>);

/// Columns added by `main._migrate_db` after the first release: (table, column, type).
const MIGRATIONS: &[(&str, &str, &str)] = &[
    ("applications", "is_easy_apply", "BOOLEAN DEFAULT 0"),
    ("applications", "assessment_data", "JSON"),
    ("applications", "match_score", "INTEGER"),
    ("applications", "job_description", "TEXT"),
    ("user_profiles", "llm_keys_encrypted", "TEXT"),
    ("analyses", "keywords_matched", "JSON"),
    ("analyses", "keywords_missing", "JSON"),
];

/// Rust-only tables; the Python backend never reads them.
const RUST_DDL: &str = "CREATE TABLE IF NOT EXISTS assessment_cache     (key TEXT PRIMARY KEY, assessment JSON NOT NULL, created_at DATETIME NOT NULL);
    CREATE TABLE IF NOT EXISTS job_store (key TEXT PRIMARY KEY, first_seen DATETIME NOT NULL,     last_seen DATETIME NOT NULL, dismissed BOOLEAN NOT NULL DEFAULT 0);";

impl Db {
    /// `DATABASE_URL` (`sqlite:///./jobspy_ui.db`, `sqlite:////abs/path.db`, or a plain path).
    pub fn open(url: &str) -> rusqlite::Result<Db> {
        let path = url.strip_prefix("sqlite:///").unwrap_or(url);
        Db::init(Connection::open(path)?)
    }

    pub fn memory() -> Db {
        Db::init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn init(conn: Connection) -> rusqlite::Result<Db> {
        // The shared DDL, made idempotent: create_all() also only creates what is missing.
        let ddl = include_str!("../../../docs/rust-migration/schema.sql")
            .replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ")
            .replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ");
        conn.execute_batch(&ddl)?;
        conn.execute_batch(RUST_DDL)?;
        for (table, col, ty) in MIGRATIONS {
            let has: bool = conn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
                [col],
                |r| r.get::<_, i64>(0).map(|n| n > 0),
            )?;
            if !has {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {ty}"))?;
            }
        }
        Ok(Db(Mutex::new(conn)))
    }

    /// ponytail: one connection behind a mutex, queried on the async thread; a single-user app's
    /// statements take microseconds. Move to spawn_blocking / a pool if that ever shows up.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// SQLAlchemy `DateTime` text (`2026-10-12 03:00:00[.ffffff]`) → Python `.isoformat()`.
pub fn iso(s: &str) -> String {
    let s = s.replacen(' ', "T", 1);
    match s.split_once('.') {
        Some((head, frac)) if frac.trim_end_matches('0').is_empty() => head.to_string(),
        _ => s,
    }
}

/// Python-side `datetime.utcnow()` as SQLAlchemy stores it.
pub fn utcnow() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S%.6f").to_string()
}

/// One row as a JSON object: JSON columns parsed, BOOLEAN columns as bools, DATETIME as isoformat.
pub fn row_json(
    row: &rusqlite::Row,
    json_cols: &[&str],
    bool_cols: &[&str],
    time_cols: &[&str],
) -> rusqlite::Result<Map<String, Value>> {
    let stmt = row.as_ref();
    let mut out = Map::new();
    for i in 0..stmt.column_count() {
        let name = stmt.column_name(i)?;
        let v = match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) if bool_cols.contains(&name) => json!(n != 0),
            ValueRef::Integer(n) => json!(n),
            ValueRef::Real(f) => json!(f),
            ValueRef::Text(t) => {
                let t = String::from_utf8_lossy(t);
                if json_cols.contains(&name) {
                    serde_json::from_str(&t).unwrap_or(Value::Null)
                } else if time_cols.contains(&name) {
                    json!(iso(&t))
                } else {
                    json!(t)
                }
            }
            ValueRef::Blob(_) => Value::Null,
        };
        out.insert(name.to_string(), v);
    }
    Ok(out)
}

/// JSON value → SQLite value (objects / arrays as JSON text, like SQLAlchemy's JSON type).
pub fn sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0)), Sql::Integer),
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

// ── Fernet (crypto.py) ──────────────────────────────────────────────────────────────────────────

/// Fernet keyed by PBKDF2-HMAC-SHA256(SECRET_KEY, "jumpship-salt-2026", 100 000): reads the Python backend's tokens.
pub struct Secrets(fernet::Fernet);

impl Secrets {
    pub fn new(secret_key: &str) -> Secrets {
        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(secret_key.as_bytes(), b"jumpship-salt-2026", 100_000, &mut key);
        let key = base64::engine::general_purpose::URL_SAFE.encode(key);
        Secrets(fernet::Fernet::new(&key).expect("32-byte key"))
    }

    pub fn encrypt(&self, text: &str) -> String {
        self.0.encrypt(text.as_bytes())
    }

    pub fn decrypt(&self, token: &str) -> Option<String> {
        String::from_utf8(self.0.decrypt(token).ok()?).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_python_fernet_tokens() {
        let s = Secrets::new("test-secret");
        // Made by cryptography.fernet with the crypto.py derivation and SECRET_KEY=test-secret.
        let token = "gAAAAABqzZMUcw2F5Vm_ZwYqoEOv3qxGf1DZG28_9ZcC0jqh7EJ4_K0yyADvQUPASQAsCtgYh6BXOiIfWuHIfQCGcNoH5U5wazyh8jqKXE7eceFh_T2_6DQ=";
        assert_eq!(s.decrypt(token).as_deref(), Some(r#"{"openai": "sk-test"}"#));
        assert_eq!(s.decrypt(&s.encrypt("x")).as_deref(), Some("x"));
        assert_eq!(Secrets::new("other").decrypt(token), None);
    }

    #[test]
    fn schema_and_times() {
        let db = Db::memory();
        let n: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM pragma_table_info('applications')", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, 16);
        assert_eq!(iso("2026-10-12 03:00:00"), "2026-10-12T03:00:00");
        assert_eq!(iso("2026-10-12 03:00:00.000000"), "2026-10-12T03:00:00");
        assert_eq!(iso("2026-10-12 03:00:00.120000"), "2026-10-12T03:00:00.120000");
    }
}
