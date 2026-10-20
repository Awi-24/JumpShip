//! Salary normalization (PLAN §5): `salary_range` text → annual amount in USD, for sorting and filtering only.
//! The original text stays what the UI shows.

use std::sync::LazyLock;

use regex::Regex;

/// ponytail: fixed approximate rates (2026), good enough to order a list; fetch daily rates if amounts get shown.
const USD_PER: &[(&str, f64)] = &[
    ("USD", 1.0),
    ("EUR", 1.08),
    ("GBP", 1.27),
    ("CHF", 1.12),
    ("CAD", 0.73),
    ("AUD", 0.66),
    ("NZD", 0.6),
    ("BRL", 0.18),
    ("MXN", 0.055),
    ("INR", 0.012),
    ("PLN", 0.25),
    ("SEK", 0.095),
    ("JPY", 0.0067),
    ("SGD", 0.74),
];

/// Symbols and codes in match order (`R$` / `CA$` before `$`).
const CURRENCIES: &[(&str, &str)] = &[
    ("R$", "BRL"),
    ("BRL", "BRL"),
    ("CA$", "CAD"),
    ("C$", "CAD"),
    ("CAD", "CAD"),
    ("A$", "AUD"),
    ("AUD", "AUD"),
    ("NZ$", "NZD"),
    ("NZD", "NZD"),
    ("S$", "SGD"),
    ("SGD", "SGD"),
    ("MX$", "MXN"),
    ("MXN", "MXN"),
    ("US$", "USD"),
    ("USD", "USD"),
    ("€", "EUR"),
    ("EUR", "EUR"),
    ("£", "GBP"),
    ("GBP", "GBP"),
    ("CHF", "CHF"),
    ("₹", "INR"),
    ("INR", "INR"),
    ("PLN", "PLN"),
    ("SEK", "SEK"),
    ("¥", "JPY"),
    ("JPY", "JPY"),
    ("$", "USD"),
];

static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(\d[\d.,]*)\s*(k|mil\b|m\b)?").unwrap());
static PERIOD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(hour|hora|/\s*h(?:r|our)?\b|\bhr\b)|(\bday\b|daily|/\s*dia|di[aá]ria)|(week|semana)|(month|/\s*mo\b|m[eê]s\b|mensal)|(year|annual|/\s*yr\b|\bano\b|anual)",
    )
    .unwrap()
});

/// `"5.000,50"` / `"120,000"` / `"35,3"` → number: the last separator is decimal unless 3 digits follow it.
fn number(raw: &str) -> Option<f64> {
    let raw = raw.trim_end_matches(['.', ',']);
    let last = raw.rfind(['.', ',']);
    let (int, frac) = match last {
        Some(i) if raw.len() - i - 1 != 3 || (raw.contains('.') && raw.contains(',')) => (&raw[..i], &raw[i + 1..]),
        _ => (raw, ""),
    };
    let int: String = int.chars().filter(char::is_ascii_digit).collect();
    format!("{int}.{frac}").trim_end_matches('.').parse().ok()
}

/// Annual USD for a salary text (midpoint of a range), or `None` when amount or currency is unknown.
pub fn annual_usd(text: &str) -> Option<f64> {
    let (_, code) = CURRENCIES.iter().find(|(sym, _)| text.contains(sym))?;
    let rate = USD_PER.iter().find(|(c, _)| c == code)?.1;
    let amounts: Vec<f64> = NUMBER
        .captures_iter(text)
        .filter_map(|c| {
            let n = number(&c[1])?;
            let mult = match c.get(2).map(|m| m.as_str().to_lowercase()).as_deref() {
                Some("k" | "mil") => 1e3,
                Some("m") => 1e6,
                _ => 1.0,
            };
            Some(n * mult)
        })
        .filter(|n| *n > 0.0)
        .take(2)
        .collect();
    if amounts.is_empty() {
        return None;
    }
    let mid = amounts.iter().sum::<f64>() / amounts.len() as f64 * rate;
    let per_year = match PERIOD.captures(text) {
        Some(c) if c.get(1).is_some() => 2080.0,
        Some(c) if c.get(2).is_some() => 260.0,
        Some(c) if c.get(3).is_some() => 52.0,
        Some(c) if c.get(4).is_some() => 12.0,
        Some(_) => 1.0,
        // ponytail: no period in the text (JobSpy drops it): guess from magnitude. A low annual pay (< $6k) reads
        // as monthly; pass JobSpy's interval through if that misorders real lists.
        None if mid < 200.0 => 2080.0,
        None if mid < 6000.0 => 12.0,
        None => 1.0,
    };
    Some((mid * per_year).round())
}

#[cfg(test)]
mod tests {
    use super::annual_usd;

    #[test]
    fn normalizes() {
        let cases = [
            ("USD 120,000 – 150,000", Some(135_000.0)),
            ("EUR 90,000 – 120,000", Some(113_400.0)),
            ("USD 5,000 – 6,000 / month", Some(66_000.0)),
            ("$45-$120/Hour", Some(171_600.0)),
            ("$35,3k- $52k", Some(43_650.0)),
            ("R$ 5.000,00 a R$ 7.000,00", Some(12_960.0)),
            ("R$ 8.000", Some(17_280.0)),
            ("R$ 120 mil / ano", Some(21_600.0)),
            ("GBP 82,400 – 103,000", Some(117_729.0)),
            ("Up to USD 90,000", Some(90_000.0)),
            ("A combinar", None),
            ("None 50,000 – 70,000", None),
            ("", None),
        ];
        for (text, want) in cases {
            assert_eq!(annual_usd(text), want, "{text}");
        }
    }
}
