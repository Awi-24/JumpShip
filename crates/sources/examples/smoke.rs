//! Live smoke: `cargo run -p jumpship-sources --example smoke -- python "data engineer"` → count per source.

use jumpship_sources::{ats, br, client, extra};

#[tokio::main]
async fn main() {
    let kw: Vec<String> = std::env::args().skip(1).collect();
    let c = client();
    let n = 20;
    let report = |site: &str, r: Result<Vec<jumpship_sources::Job>, jumpship_sources::Error>| match r {
        Ok(jobs) => println!("{site:<13} {:>3}  {}", jobs.len(), jobs.first().map_or("", |j| j.title.as_str())),
        Err(e) => println!("{site:<13} ERR  {e}"),
    };
    report("remoteok", extra::fetch_remoteok(&c, &kw, n).await);
    report("arbeitnow", extra::fetch_arbeitnow(&c, &kw, n).await);
    report("gupy", br::fetch_gupy(&c, &kw, n, false).await);
    report("programathor", br::fetch_programathor(&c, &kw, n).await);
    report("trampos", br::fetch_trampos(&c, &kw, n).await);
    report("greenhouse", Ok(ats::fetch_greenhouse(&c, &kw, n).await));
    report("lever", Ok(ats::fetch_lever(&c, &kw, n).await));
    report("workday", Ok(ats::fetch_workday(&c, &kw, n).await));
}
