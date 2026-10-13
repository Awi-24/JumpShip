//! "Career Pages" (site `playwright`; PLAN §5 headless-browser rewrite of `playwright_scraper.py`): company career
//! sites without a board API of their own. A live survey (2026-10-13) showed the jobs sit behind known ATSs, so
//! those go through the ATS's API (Eightfold, Workday, Oracle HCM, Empregare); the rest are rendered in a headless
//! Edge / Chrome over CDP and their job links read by URL shape (`career_links.js`). Capturing arbitrary XHR JSON
//! was dropped: on these sites it was cookie-banner noise.

use std::collections::HashSet;
use std::time::Duration;

use futures::future::{BoxFuture, FutureExt};
use futures::{StreamExt, stream};
use jumpship_core::{Job, matches_any, relevance};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::Value;

use crate::cdp::Browser;
use crate::search::{Resolved, location_matches};
use crate::{ACCEPT_JSON, Error, get, md5_8, prefix, pyint, pystr, s, soup, terms, unix_date};

enum How {
    Eightfold {
        host: &'static str,
        domain: &'static str,
    },
    Workday(&'static str),
    Oracle {
        host: &'static str,
        site: &'static str,
    },
    Empregare {
        slug: &'static str,
        empresa: &'static str,
    },
    /// Rendered page; `{q}` is replaced by one keyword (one render per keyword, up to 2).
    Page(&'static str),
}
use How::*;

/// (registry id, company, how). Dropped from the Python list: Bradesco (404), Nestlé and Coca-Cola (no job links),
/// JBS (Gupy source), OpenAI (Ashby source), Amazon (Amazon source).
// ponytail: verified by hand 2026-10-13; sites change — move to the registry with a health check if this rots.
const PAGES: &[(&str, &str, How)] = &[
    (
        "stone_jornada",
        "Stone",
        Page("https://jornada.stone.com.br/vagas-abertas"),
    ),
    (
        "itau_carreiras",
        "Itaú Unibanco",
        Page("https://carreiras.itau.com.br/busca-de-vagas"),
    ),
    (
        "magalu_carreiras",
        "Magazine Luiza",
        Page("https://carreiras.magazineluiza.com.br/encontre-sua-vaga/"),
    ),
    ("b3_vagas", "B3", Page("https://vagas.b3.com.br/search/?q={q}")),
    (
        "uber_careers_list",
        "Uber",
        Oracle {
            host: "iaziqy.fa.ocs.oraclecloud.com",
            site: "UberCareers",
        },
    ),
    (
        "ibm_careers_brazil_search",
        "IBM",
        Page("https://www.ibm.com/br-pt/careers/search?q={q}"),
    ),
    (
        "meta_careers_jobs_brazil",
        "Meta",
        Page("https://www.metacareers.com/jobsearch/?q={q}"),
    ),
    (
        "apple_jobs_brazil_search",
        "Apple",
        Page("https://jobs.apple.com/pt-br/search?search={q}&location=brazil-BRAC"),
    ),
    (
        "google_careers_brazil",
        "Google",
        Page("https://www.google.com/about/careers/applications/jobs/results/?location=Brazil&q={q}"),
    ),
    (
        "microsoft_careers_sao_paulo",
        "Microsoft",
        Page("https://apply.careers.microsoft.com/careers?query={q}&location=Brazil"),
    ),
    ("sap_jobs_brazil", "SAP", Page("https://jobs.sap.com/en/jobs/")),
    (
        "vale_eightfold",
        "Vale",
        Eightfold {
            host: "vale.eightfold.ai",
            domain: "vale.com",
        },
    ),
    (
        "mercadolibre_eightfold",
        "Mercado Livre",
        Eightfold {
            host: "mercadolibre.eightfold.ai",
            domain: "mercadolibre.com",
        },
    ),
    (
        "shell_jobs_global",
        "Shell",
        Workday("https://shell.wd3.myworkdayjobs.com/shellcareers"),
    ),
    (
        "toyota_empregos_portal",
        "Toyota",
        Workday("https://toyota.wd503.myworkdayjobs.com/TLAC"),
    ),
    (
        "unilever_brasil_busca_vagas",
        "Unilever",
        Page("https://careers.unilever.com/pt-br/search-jobs/{q}/Brasil"),
    ),
    (
        "petrobras_jobs2web",
        "Petrobras",
        Page("https://petrobras.jobs2web.com/search/?q={q}"),
    ),
    (
        "totalenergies_jobs_search_br",
        "TotalEnergies",
        Page("https://jobs.totalenergies.com/pt_BR/careers/SearchJobs/{q}"),
    ),
    (
        "siemens_energy_jobs_brazil",
        "Siemens Energy",
        Page("https://jobs.siemens-energy.com/en_US/jobs/searchJobsBrazil?q={q}"),
    ),
    (
        "heineken_brazil_careers_portal",
        "HEINEKEN",
        Page("https://careers.theheinekencompany.com/HEINEKEN-Brasil?locale=pt_BR"),
    ),
    (
        "vw_group_jobs_portal",
        "Volkswagen Group",
        Page("https://jobs.volkswagen-group.com/search/?q={q}&locationsearch=Brasil"),
    ),
    (
        "volvo_group_brasil_job_openings",
        "Volvo Group",
        Page("https://jobs.volvogroup.com/search/?q={q}&locationsearch=Brazil"),
    ),
    ("klabin_carreiras", "Klabin", Page("https://carreira.klabin.com.br/")),
    (
        "stellantis_empregare_br",
        "Stellantis",
        Empregare {
            slug: "stellantis",
            empresa: "6n6b-1HP-lE|",
        },
    ),
];

const SCRIPT: &str = include_str!("career_links.js");

fn job(src_id: &str, company: &str, title: String, url: String, location: String) -> Job {
    Job {
        id: format!("pw_{}_{}", prefix(src_id, 8), md5_8(&url)),
        title,
        company: company.into(),
        location,
        job_type: "fulltime".into(),
        url,
        site: "playwright".into(),
        ..Job::default()
    }
}

/// Work mode from an ATS's own flag: remote → `is_remote`, hybrid → the `hybrid` tag, on-site → `false`.
fn work_mode(j: &mut Job, mode: &str) {
    match mode.to_lowercase().as_str() {
        "remote" | "remoto" => j.is_remote = Some(Some(true)),
        "hybrid" | "híbrido" | "hibrido" => j.tags = Some(vec!["hybrid".into()]),
        "onsite" | "on-site" | "presencial" => j.is_remote = Some(Some(false)),
        _ => {}
    }
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, Error> {
    Ok(crate::polite::send(
        client
            .get(url)
            .header("Accept", ACCEPT_JSON)
            .timeout(Duration::from_secs(20)),
    )
    .await?
    .error_for_status()?
    .json()
    .await?)
}

fn q(term: &str) -> String {
    utf8_percent_encode(term, NON_ALPHANUMERIC).to_string()
}

// ── ATS adapters ────────────────────────────────────────────────────────────────────────────────

/// Eightfold has two public search APIs and each tenant enables one: `pcsx` (Mercado Livre) or `apply/v2` (Vale).
async fn eightfold(client: &reqwest::Client, host: &str, domain: &str, term: &str) -> Result<Value, Error> {
    let pcsx = format!(
        "https://{host}/api/pcsx/search?domain={domain}&query={}&location=&start=0",
        q(term)
    );
    match get_json(client, &pcsx).await {
        Ok(v) => Ok(v),
        Err(_) => {
            let v2 = format!(
                "https://{host}/api/apply/v2/jobs?domain={domain}&query={}&start=0&num=20",
                q(term)
            );
            get_json(client, &v2).await
        }
    }
}

/// Both Eightfold shapes: `pcsx` → `data.positions[]`, `apply/v2` → `positions[]`.
pub fn parse_eightfold(data: &Value, src_id: &str, company: &str, host: &str) -> Vec<Job> {
    let positions = data["data"]["positions"]
        .as_array()
        .or(data["positions"].as_array())
        .into_iter()
        .flatten();
    positions
        .map(|p| {
            let url = match s(p, "canonicalPositionUrl") {
                u if !u.is_empty() => u,
                _ => format!("https://{host}{}", s(p, "positionUrl")),
            };
            let location = match s(p, "location") {
                l if !l.is_empty() => l,
                _ => p["locations"]
                    .as_array()
                    .map(|a| a.iter().map(pystr).collect::<Vec<_>>().join(" / "))
                    .unwrap_or_default(),
            };
            let mut j = job(src_id, company, s(p, "name"), url, location);
            j.posted_date = get(p, "postedTs")
                .or(get(p, "t_create"))
                .map_or(String::new(), |t| unix_date(pyint(t)));
            j.description = soup::markdown(&s(p, "job_description"));
            let mode = get(p, "workLocationOption").or(get(p, "work_location_option"));
            work_mode(&mut j, &mode.map(pystr).unwrap_or_default());
            j
        })
        .collect()
}

/// Oracle Recruiting Cloud candidate-experience search.
async fn oracle(client: &reqwest::Client, host: &str, site: &str, term: &str) -> Result<Value, Error> {
    let url = format!(
        "https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true\
         &expand=requisitionList.secondaryLocations\
         &finder=findReqs;siteNumber={site},keyword=%22{}%22,limit=25,sortBy=POSTING_DATES_DESC",
        q(term)
    );
    get_json(client, &url).await
}

pub fn parse_oracle(data: &Value, src_id: &str, company: &str, host: &str, site: &str) -> Vec<Job> {
    data["items"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|it| it["requisitionList"].as_array().into_iter().flatten())
        .map(|r| {
            let url = format!(
                "https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{}",
                s(r, "Id")
            );
            let mut j = job(src_id, company, s(r, "Title"), url, s(r, "PrimaryLocation"));
            j.posted_date = prefix(&s(r, "PostedDate"), 10);
            j.description = s(r, "ShortDescriptionStr");
            work_mode(&mut j, &s(r, "WorkplaceType"));
            j
        })
        .collect()
}

async fn empregare(client: &reqwest::Client, slug: &str, empresa: &str, term: &str) -> Result<Value, Error> {
    let url = format!(
        "https://www.empregare.com/api/pt-br/vagas/buscar-novo?pagina=1&itensPagina=50&query={}&localidade=\
         &empresa={}&hotSiteUrl={slug}",
        q(term),
        q(empresa)
    );
    get_json(client, &url).await
}

pub fn parse_empregare(data: &Value, src_id: &str, company: &str, slug: &str) -> Vec<Job> {
    data["model"]["dados"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| {
            let url = format!("https://{slug}.empregare.com/pt-br/{}", s(v, "url"));
            let cities = v["cidades"]
                .as_array()
                .map(|a| a.iter().map(pystr).collect::<Vec<_>>().join(" / "))
                .unwrap_or_default();
            let mut j = job(src_id, company, s(v, "titulo"), url, cities);
            j.posted_date = get(v, "timestamp").map_or(String::new(), |t| unix_date(pyint(t)));
            j.description = s(v, "chamada");
            j.salary_range = s(v, "salario");
            work_mode(&mut j, &s(v, "trabalhoRemoto"));
            j
        })
        .collect()
}

// ── Rendered pages ──────────────────────────────────────────────────────────────────────────────

/// `career_links.js` output → jobs: titled links only, one per URL and per title.
pub fn page_jobs(src_id: &str, company: &str, found: &Value) -> Vec<Job> {
    let mut seen = HashSet::new();
    found["links"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| {
            let (title, url) = (s(l, "title"), s(l, "url"));
            if title.is_empty() || url.is_empty() || !seen.insert(title.to_lowercase()) || !seen.insert(url.clone()) {
                return None;
            }
            Some(job(src_id, company, title, url, s(l, "location")))
        })
        .collect()
}

async fn render(browser: &Browser, url: &str) -> Result<Value, String> {
    let found = browser.eval_page(url, SCRIPT).await?;
    // Landing page without job links: follow its listing link once.
    match found["next"].as_str() {
        Some(next) if found["links"].as_array().is_none_or(Vec::is_empty) => browser.eval_page(next, SCRIPT).await,
        _ => Ok(found),
    }
}

/// Most relevant first; among equals, companies take turns (the i-th job of each before any company's next), so one
/// big board can't fill the cap.
fn fair_rank(jobs: &mut [Job], keywords: &[String]) {
    let mut turn = std::collections::HashMap::<String, usize>::new();
    let keys: Vec<_> = jobs
        .iter()
        .map(|j| {
            let t = turn.entry(j.company.clone()).or_default();
            *t += 1;
            (std::cmp::Reverse(relevance(keywords, &j.title, &j.description)), *t)
        })
        .collect();
    let mut order: Vec<usize> = (0..jobs.len()).collect();
    order.sort_by_key(|&i| keys[i]);
    let sorted: Vec<Job> = order.iter().map(|&i| jobs[i].clone()).collect();
    jobs.clone_from_slice(&sorted);
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

// The source id is owned: a `&str` here trips the same higher-ranked check as above.
type Outcome = (String, Result<Vec<Job>, String>);

pub async fn fetch_career_pages(
    client: &reqwest::Client,
    keywords: &[String],
    n: usize,
    resolved: &Resolved,
) -> Result<Vec<Job>, Error> {
    let mut terms = terms(keywords, 2, "");
    if terms.is_empty() {
        terms.push(String::new());
    }
    // Every (source, keyword) call; pages without `{q}` render once.
    let mut api: Vec<BoxFuture<'_, Outcome>> = Vec::new();
    let mut pages: Vec<(&'static str, &'static str, String)> = Vec::new();
    for (id, company, how) in PAGES {
        match how {
            Workday(url) => api.push(
                async move {
                    let jobs = crate::ats::workday_board(client, url, Some(company.to_string()), keywords, n).await;
                    let jobs = jobs
                        .into_iter()
                        .map(|mut j| {
                            j.site = "playwright".into();
                            j
                        })
                        .collect();
                    (id.to_string(), Ok(jobs))
                }
                .boxed(),
            ),
            Page(url) if url.contains("{q}") => {
                for t in &terms {
                    pages.push((id, company, url.replace("{q}", &q(t))));
                }
            }
            Page(url) => pages.push((id, company, url.to_string())),
            _ => {
                for t in terms.clone() {
                    api.push(
                        async move {
                            let r = match how {
                                Eightfold { host, domain } => eightfold(client, host, domain, &t)
                                    .await
                                    .map(|v| parse_eightfold(&v, id, company, host)),
                                Oracle { host, site } => oracle(client, host, site, &t)
                                    .await
                                    .map(|v| parse_oracle(&v, id, company, host, site)),
                                Empregare { slug, empresa } => empregare(client, slug, empresa, &t)
                                    .await
                                    .map(|v| parse_empregare(&v, id, company, slug)),
                                Workday(_) | Page(_) => unreachable!(),
                            };
                            (id.to_string(), r.map_err(|e| e.to_string()))
                        }
                        .boxed(),
                    );
                }
            }
        }
    }

    let api_run = stream::iter(api).buffer_unordered(4).collect::<Vec<_>>();
    let page_run = async {
        if pages.is_empty() {
            return vec![];
        }
        let browser = match Browser::launch().await {
            Ok(b) => b,
            Err(e) => return vec![("browser".to_string(), Err(e))],
        };
        let browser = &browser;
        // Boxed up front: a closure inside the stream trips rustc's higher-ranked `Send` check (rust-lang/rust#102211).
        let renders: Vec<BoxFuture<'_, Outcome>> = pages
            .into_iter()
            .map(|(id, company, url)| {
                async move {
                    let r = tokio::time::timeout(Duration::from_secs(60), render(browser, &url))
                        .await
                        .unwrap_or_else(|_| Err(format!("timed out rendering {url}")));
                    (id.to_string(), r.map(|found| page_jobs(id, company, &found)))
                }
                .boxed()
            })
            .collect();
        stream::iter(renders).buffer_unordered(4).collect::<Vec<_>>().await
    };
    let (api_out, page_out) = futures::join!(api_run, page_run);

    let mut jobs = Vec::new();
    let mut errors = Vec::new();
    let mut ids = HashSet::new();
    for (id, r) in api_out.into_iter().chain(page_out) {
        match r {
            Ok(js) => {
                tracing::info!("Career pages ({id}): {} links", js.len());
                jobs.extend(js.into_iter().filter(|j| ids.insert(j.id.clone())));
            }
            Err(e) => {
                tracing::warn!("Career pages ({id}): {e}");
                errors.push(format!("{id}: {e}"));
            }
        }
    }
    // Rendered pages list every job (search URLs still show nav links): keep the ones the keywords name, in the
    // searched location (unknown = kept), once per title + company.
    let mut seen = HashSet::new();
    jobs.retain(|j| {
        matches_any(keywords, &[&j.title, &j.description])
            && location_matches(&j.location, resolved, j.is_remote.flatten())
            && seen.insert(format!("{}|{}", j.company, j.title.to_lowercase()))
    });
    fair_rank(&mut jobs, keywords);
    jobs.truncate(n);
    if jobs.is_empty() && !errors.is_empty() {
        return Err(errors.join("; ").into());
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Acceptance (PLAN §5 headless rewrite): both Eightfold API shapes → jobs with URL, location, date, mode.
    #[test]
    fn eightfold_shapes() {
        let pcsx = json!({"data": {"positions": [{"name": "Especialista em TI", "locations": ["Sudeste,Brazil"],
            "postedTs": 1791553209, "positionUrl": "/careers/job/44338111", "workLocationOption": "onsite"}]}});
        let j = &parse_eightfold(
            &pcsx,
            "mercadolibre_eightfold",
            "Mercado Livre",
            "mercadolibre.eightfold.ai",
        )[0];
        assert_eq!(j.url, "https://mercadolibre.eightfold.ai/careers/job/44338111");
        assert_eq!(j.location, "Sudeste,Brazil");
        assert_eq!(j.is_remote, Some(Some(false)));
        assert!(j.id.starts_with("pw_mercadol_"));
        let v2 = json!({"positions": [{"name": "ENGENHEIRO PLENO", "location": "Mariana, MG, Brasil", "t_create": 1790854718,
            "canonicalPositionUrl": "https://vale.eightfold.ai/careers/job/44758637", "job_description": "<p>Mineração</p>",
            "work_location_option": "hybrid"}]});
        let j = &parse_eightfold(&v2, "vale_eightfold", "Vale", "vale.eightfold.ai")[0];
        assert_eq!(j.url, "https://vale.eightfold.ai/careers/job/44758637");
        assert_eq!(j.location, "Mariana, MG, Brasil");
        assert!(j.description.contains("Mineração"));
        assert_eq!(j.tags, Some(vec!["hybrid".to_string()]));
        assert_eq!(j.posted_date.len(), 10);
    }

    #[test]
    fn oracle_and_empregare() {
        let o = json!({"items": [{"requisitionList": [{"Id": "157820", "Title": "Audio/Visual Application Engineer",
            "PostedDate": "2026-10-13", "PrimaryLocation": "San Francisco, CA, United States", "WorkplaceType": ""}]}]});
        let j = &parse_oracle(
            &o,
            "uber_careers_list",
            "Uber",
            "iaziqy.fa.ocs.oraclecloud.com",
            "UberCareers",
        )[0];
        assert_eq!(
            j.url,
            "https://iaziqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/UberCareers/job/157820"
        );
        assert_eq!((j.posted_date.as_str(), j.is_remote), ("2026-10-13", None));
        let e = json!({"model": {"dados": [{"id": 164983, "url": "vaga-operador_164983", "titulo": "OPERADOR (A)",
            "chamada": "Montar", "cidades": ["Betim, MG, BR"], "trabalhoRemoto": "Presencial", "timestamp": 1791919247,
            "salario": ""}]}});
        let j = &parse_empregare(&e, "stellantis_empregare_br", "Stellantis", "stellantis")[0];
        assert_eq!(j.url, "https://stellantis.empregare.com/pt-br/vaga-operador_164983");
        assert_eq!((j.location.as_str(), j.is_remote), ("Betim, MG, BR", Some(Some(false))));
    }

    #[test]
    fn fair_ranking() {
        let j = |company: &str, title: &str| Job {
            company: company.into(),
            title: title.into(),
            ..Job::default()
        };
        let mut jobs = vec![
            j("Uber", "Software Engineer"),
            j("Uber", "Software Engineer II"),
            j("Uber", "Recruiter"),
            j("Google", "Software Engineer"),
        ];
        fair_rank(&mut jobs, &["software engineer".into()]);
        let order: Vec<_> = jobs.iter().map(|j| format!("{} {}", j.company, j.title)).collect();
        assert_eq!(
            order,
            [
                "Uber Software Engineer",
                "Google Software Engineer",
                "Uber Software Engineer II",
                "Uber Recruiter"
            ]
        );
    }

    #[test]
    fn page_links_to_jobs() {
        let found = json!({"links": [
            {"title": "VENDEDOR", "url": "https://x.test/vagas/1", "location": "Magazine Luiza - CARAPICUIBA / SP"},
            {"title": "VENDEDOR", "url": "https://x.test/vagas/1?dup", "location": ""},
            {"title": "", "url": "https://x.test/vagas/2", "location": ""},
            {"title": "Engenheiro de Software", "url": "https://x.test/vagas/3", "location": ""}
        ]});
        let jobs = page_jobs("magalu_carreiras", "Magazine Luiza", &found);
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].location, "Magazine Luiza - CARAPICUIBA / SP");
        assert_eq!(jobs[1].site, "playwright");
    }

    /// Acceptance (PLAN §5 headless rewrite, end to end): a local page rendered by the installed Edge / Chrome over
    /// CDP; the script finds the job links (one rendered by JS after load) and skips the nav. Skipped without a browser.
    #[tokio::test(flavor = "multi_thread")]
    async fn renders_local_page() {
        if crate::cdp::browser().is_none() {
            eprintln!("no browser installed: skipped");
            return;
        }
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let html = r#"<html><body><nav><a href="/jobs/saved">Saved jobs</a><a href="/about">About us</a></nav>
            <ul id="list"><li class="card job-card"><h3 class="title">Engenheiro de Software <span class="job-location">São Paulo</span></h3>
            <a class="see-job" href="/vagas/12345">Saiba mais</a></li></ul>
            <script>setTimeout(() => { document.getElementById('list').insertAdjacentHTML('beforeend',
              '<li><a href="/jobs/98765/data-engineer"><h4>Data Engineer</h4></a></li>'); }, 1500);</script>
            </body></html>"#;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/careers", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
                    html.len()
                );
                let _ = sock.write_all(reply.as_bytes()).await;
            }
        });
        let browser = Browser::launch().await.unwrap();
        let found = render(&browser, &url).await.unwrap();
        let jobs = page_jobs("test", "Test", &found);
        let titles: Vec<_> = jobs.iter().map(|j| j.title.as_str()).collect();
        assert!(titles.contains(&"Engenheiro de Software"), "{found}");
        assert!(!titles.iter().any(|t| t.contains("Saved")));
        assert_eq!(jobs[0].location, "São Paulo");
    }
}
