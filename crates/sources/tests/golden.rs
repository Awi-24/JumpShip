//! Runs the parity manifest shared with tests/unit/test_source_parsers.py.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use jumpship_sources::{ats, br, extra};
use serde_json::{Value, json};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sources")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn run_case(case: &Value) -> Vec<jumpship_sources::Job> {
    let dir = fixtures();
    let raws: Vec<String> = match &case["raw"] {
        Value::Array(a) => a.iter().map(|p| read(&dir.join(p.as_str().unwrap()))).collect(),
        p => vec![read(&dir.join(p.as_str().unwrap()))],
    };
    let json_raws = || {
        raws.iter()
            .map(|r| serde_json::from_str::<Value>(r).unwrap())
            .collect::<Vec<_>>()
    };
    let kw: Vec<String> = serde_json::from_value(case["keywords"].clone()).unwrap();
    let ctx = &case["ctx"];
    let rw = ctx["results_wanted"].as_u64().unwrap_or(20) as usize;
    let c = |k: &str| ctx[k].as_str().unwrap().to_string();

    match case["site"].as_str().unwrap() {
        "remoteok" => extra::parse_remoteok(&json_raws()[0], &kw, rw),
        "arbeitnow" => extra::parse_arbeitnow(&json_raws()[0], &kw, rw),
        "gupy" => {
            let pages: Vec<Value> = raws.iter().map(|h| br::extract_gupy_next_data(h).unwrap()).collect();
            br::parse_gupy(&pages, &kw, rw)
        }
        "programathor" => br::parse_programathor(&raws, &kw, rw),
        "trampos" => br::parse_trampos(&json_raws(), rw),
        "greenhouse" => ats::parse_greenhouse(&json_raws()[0], &kw, &c("company"), &c("token")),
        "lever" => ats::parse_lever(&json_raws()[0], &kw, &c("company"), &c("site")),
        "workday" => ats::parse_workday(&json_raws(), &c("hostname"), &c("tenant"), &c("company")),
        other => panic!("no parser for {other}"),
    }
}

#[test]
fn golden_cases() {
    let cases: Vec<Value> = serde_json::from_str(&read(&fixtures().join("cases.json"))).unwrap();
    let sites: BTreeSet<&str> = cases.iter().map(|c| c["site"].as_str().unwrap()).collect();
    assert_eq!(sites.len(), 8, "manifest sites: {sites:?}");

    let mut failures = Vec::new();
    for case in &cases {
        let name = format!("{}/{}", case["site"].as_str().unwrap(), case["case"].as_str().unwrap());
        let got = json!(run_case(case));
        let expected: Value =
            serde_json::from_str(&read(&fixtures().join(case["expected"].as_str().unwrap()))).unwrap();
        if got == expected {
            continue;
        }
        let (g, e) = (got.as_array().unwrap(), expected.as_array().unwrap());
        let detail = match (0..g.len().max(e.len())).find(|&i| g.get(i) != e.get(i)) {
            Some(i) => match (g.get(i), e.get(i)) {
                (Some(Value::Object(go)), Some(Value::Object(eo))) => {
                    let diffs: Vec<String> = eo
                        .keys()
                        .chain(go.keys())
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .filter(|k| go.get(*k) != eo.get(*k))
                        .map(|k| format!("  {k}: got {:.200} / expected {:.200}", fmt(go.get(k)), fmt(eo.get(k))))
                        .collect();
                    format!("item {i}:\n{}", diffs.join("\n"))
                }
                (gi, ei) => format!("item {i}: got {} / expected {}", fmt(gi), fmt(ei)),
            },
            None => unreachable!(),
        };
        failures.push(format!("{name} (got {} items, expected {}) {detail}", g.len(), e.len()));
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

fn fmt(v: Option<&Value>) -> String {
    v.map_or("<absent>".into(), |v| v.to_string())
}
