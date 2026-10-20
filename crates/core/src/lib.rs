//! JumpShip core: the normalized job model and keyword matching shared by every source.
//! Mirrors `backend/services/text_match.py` and the job dicts the Python sources return.

use serde::{Deserialize, Serialize};
use unicode_normalization::{UnicodeNormalization, char::canonical_combining_class};

/// One normalized job posting; serializes to the same JSON as the Python job dicts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Job {
    pub id: String,
    pub title: String,
    pub company: String,
    pub company_url: String,
    pub location: String,
    pub job_type: String,
    pub salary_range: String,
    pub posted_date: String,
    pub description: String,
    pub url: String,
    pub site: String,
    pub match_score: Option<f64>,
    /// Absent = unknown, `Some(None)` = hybrid (serialized as null), `Some(Some(b))` = remote or on-site.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_remote: Option<Option<bool>>,
    /// Absent for sources that don't tag (JobSpy rows always carry the list, even empty).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// `salary_range` as annual USD (search results only; for sorting, never shown).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salary_annual_usd: Option<f64>,
    /// Not seen in an earlier search (job store; search results only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_new: Option<bool>,
    /// Keyword relevance of title + description ([`relevance`]; search results only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance: Option<u32>,
}

/// NFKD, drop combining marks, casefold, collapse whitespace.
pub fn fold(s: &str) -> String {
    // ponytail: to_lowercase + ß→ss approximates str.casefold (differs only for rare folds such as final sigma).
    let s: String = s.nfkd().filter(|c| canonical_combining_class(*c) == 0).collect();
    s.to_lowercase()
        .replace('ß', "ss")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `kw` occurs in `hay` with a word boundary on each edge that is a word char ("c++" has none at the end).
fn contains_word(hay: &str, kw: &str) -> bool {
    let lead = kw.chars().next().is_some_and(is_word);
    let trail = kw.chars().next_back().is_some_and(is_word);
    let mut from = 0;
    while let Some(i) = hay[from..].find(kw) {
        let start = from + i;
        let end = start + kw.len();
        let lead_ok = !lead || !hay[..start].chars().next_back().is_some_and(is_word);
        let trail_ok = !trail || !hay[end..].chars().next().is_some_and(is_word);
        if lead_ok && trail_ok {
            return true;
        }
        from = start + hay[start..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

/// True when `keywords` is empty or any keyword appears (as a whole word/phrase) in any text.
pub fn matches_any<K: AsRef<str>>(keywords: &[K], texts: &[&str]) -> bool {
    let kws: Vec<String> = keywords
        .iter()
        .map(|k| fold(k.as_ref()))
        .filter(|k| !k.is_empty())
        .collect();
    if kws.is_empty() {
        return true;
    }
    let hay = fold(
        &texts
            .iter()
            .filter(|t| !t.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join(" "),
    );
    kws.iter().any(|k| contains_word(&hay, k))
}

/// Cheap local relevance (PLAN §5 ranking): per keyword, 10 for the whole phrase in the title, else 2 per word of
/// it in the title; +2 for the phrase in the description.
pub fn relevance<K: AsRef<str>>(keywords: &[K], title: &str, description: &str) -> u32 {
    let (title, description) = (fold(title), fold(description));
    keywords
        .iter()
        .map(|k| fold(k.as_ref()))
        .filter(|k| !k.is_empty())
        .map(|k| {
            let in_title = if contains_word(&title, &k) {
                10
            } else {
                2 * k
                    .split(' ')
                    .filter(|w| w.chars().count() > 2 && contains_word(&title, w))
                    .count() as u32
            };
            in_title + if contains_word(&description, &k) { 2 } else { 0 }
        })
        .sum()
}

/// Most relevant first; ties keep their order (stable sort).
pub fn rank<K: AsRef<str>>(jobs: &mut [Job], keywords: &[K]) {
    jobs.sort_by_cached_key(|j| std::cmp::Reverse(relevance(keywords, &j.title, &j.description)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching() {
        assert!(matches_any(&["java"], &["Senior Java dev"]));
        assert!(!matches_any(&["java"], &["JavaScript dev"]));
        assert!(matches_any(&["senior"], &["Sênior"]));
        assert!(matches_any(&["c++"], &["C++ engineer"]));
        assert!(matches_any(&[".net"], &["ASP.NET core"]));
        assert!(matches_any(&["data engineer"], &["Data   Engineer II"]));
        assert!(matches_any::<&str>(&[], &["anything"]));
        assert!(matches_any(&["", "  "], &["anything"]));
        assert!(!matches_any(&["go"], &["google"]));
    }

    /// Acceptance (PLAN §5 ranking before truncation): title phrase > title words > description only.
    #[test]
    fn ranking() {
        let kws = ["software engineer", "engenheiro de software"];
        let job = |id: &str, title: &str, description: &str| Job {
            id: id.into(),
            title: title.into(),
            description: description.into(),
            ..Job::default()
        };
        let mut jobs = vec![
            job("apprentice", "Jovem Aprendiz", "software engineer mentoring"),
            job("none", "Office Manager", ""),
            job("words", "Analista de Desenvolvimento de Software", ""),
            job("phrase", "Senior Software Engineer", "Rust"),
            job("pt", "Engenheiro de Software Pleno", ""),
        ];
        assert_eq!(relevance(&kws, "Senior Software Engineer", ""), 10 + 2);
        rank(&mut jobs, &kws);
        let ids: Vec<_> = jobs.iter().map(|j| j.id.as_str()).collect();
        assert_eq!(ids, ["phrase", "pt", "words", "apprentice", "none"]);
    }
}
