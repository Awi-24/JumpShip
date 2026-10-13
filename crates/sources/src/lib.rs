//! JumpShip job sources. Each module ports one Python source module: pure `parse_*` functions
//! (golden-tested against `tests/fixtures/sources/cases.json`) plus async `fetch_*` wrappers.

pub mod ats;
pub mod br;
pub mod extra;
pub mod jobspy;
pub mod polite;
pub mod remote;
pub mod salary;
pub mod search;
pub mod soup;

use serde_json::Value;

pub use jumpship_core::Job;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const ACCEPT_JSON: &str = "application/json, text/plain, */*";

/// HTTP client shared by every fetcher.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client")
}

// ── Python-compat helpers: the parsers must reproduce the Python output byte for byte ──────────

/// Python truthiness of a JSON value.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Python `str(v)`.
fn pystr(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True" } else { "False" }.into(),
        other => other.to_string(),
    }
}

/// `v.get(key)` if truthy (Python `v.get(key) or ...`).
fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.get(key).filter(|x| truthy(x))
}

/// Python `str(v.get(key) or "")`.
fn s(v: &Value, key: &str) -> String {
    get(v, key).map(pystr).unwrap_or_default()
}

/// Python `s[:n]`.
fn prefix(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// `hashlib.md5(s.encode()).hexdigest()`.
fn md5_hex(s: &str) -> String {
    format!("{:x}", md5::compute(s))
}

/// `hashlib.md5(s.encode()).hexdigest()[:8]`.
fn md5_8(s: &str) -> String {
    md5_hex(s)[..8].to_string()
}

/// Python `int(v)` for JSON numbers / numeric strings (0 when not convertible).
fn pyint(v: &Value) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as i64),
        Value::String(s) => s.trim().parse().unwrap_or(0),
        Value::Bool(b) => *b as i64,
        _ => 0,
    }
}

/// Python `f"{n:,}"`.
fn thousands(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// UTC date (`YYYY-MM-DD`) of a unix timestamp in seconds.
fn unix_date(secs: i64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Distinct (case-insensitive) non-empty keywords, at most `max`; `[fallback]` when none.
fn terms(keywords: &[String], max: usize, fallback: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for kw in keywords.iter().map(|k| k.trim()) {
        if !kw.is_empty() && !seen.iter().any(|t| t.to_lowercase() == kw.to_lowercase()) {
            seen.push(kw.to_string());
        }
    }
    seen.truncate(max);
    if seen.is_empty() && !fallback.is_empty() {
        seen.push(fallback.to_string());
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(thousands(1234567), "1,234,567");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(-1000), "-1,000");
        assert_eq!(unix_date(0), "1970-01-01");
        assert_eq!(unix_date(1_760_140_800), "2025-10-11");
        assert_eq!(md5_8("123"), "202cb962");
        assert_eq!(
            terms(&["Python".into(), "python".into(), " ".into()], 4, "x"),
            vec!["Python"]
        );
        assert_eq!(terms(&[], 4, "desenvolvedor"), vec!["desenvolvedor"]);
    }
}
