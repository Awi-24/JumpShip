# Job sources: spec for the Rust port

Live-tested 2026-10-11/12 from a residential IP in Argentina (Cloudflare edge EZE), keywords `python`, location Brazil / Sao Paulo.
Everything here describes the Python behaviour in `backend/services/` at the time of writing; the Rust port must reproduce it.

Contract files (shared by Python and Rust):

| File | Purpose |
|---|---|
| `backend/data/locations.json` | US states, ambiguous state codes, country/city alias tables, remote/hybrid label and word lists |
| `backend/data/keywords_pt.json` | `en_to_pt` keyword translation table |
| `backend/data/brazil-career-sources.json` | Registry of ATS boards (Greenhouse/Lever/Workday tokens) |
| `tests/fixtures/sources/cases.json` | Golden manifest for the 8 non-JobSpy parsers (`{site, case, raw, expected, keywords, ctx, request}`) |
| `tests/fixtures/sources/<board>/request.json` + `expected.json` | JobSpy boards: recorded HTTP exchange + expected normalized output |
| `tests/unit/test_source_parsers.py` | Python runner for all of the above (offline) |

Normalized job dict (what every source produces, before the pipeline enriches it):
`id, title, company, company_url, location, job_type, salary_range, posted_date, description, url, site, match_score(null)`
and optionally `is_remote` (bool|null) and `tags` (list). The pipeline adds `is_remote`/`tags` to every row (see section 3).

Golden manifest semantics: `raw` is a path (or list of paths) relative to `tests/fixtures/sources/`; a list means several
responses of one search (Gupy/Trampos/Workday: one per keyword, Programathor: one per page). `keywords` are exactly what the parser
receives (already PT-expanded for BR sites, see 3.4). `ctx` are extra keyword arguments (`results_wanted`, plus `company`/`token`,
`company`/`site` or `hostname`/`tenant`/`company` for ATS boards). Payload per site: JSON-decoded body (remoteok, arbeitnow, trampos,
greenhouse, lever, workday), HTML text (programathor), Gupy `props.pageProps` dict from `extract_gupy_next_data(html)`.
Raw files were trimmed to <= ~10 items and < 150 KB by dropping list elements and non-data `<script>/<style>` blocks only; fields are untouched.

Common to all non-JobSpy fetchers: `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`
(RemoteOK/Arbeitnow append ` JumpShip/1.0`), `Accept: application/json, text/plain, */*` (HTML sources: `text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`
and `Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7`), redirects followed, HTTP/1.1 via httpx, no cookies, no API keys.

---

## 1. Non-JobSpy sources

### 1.1 RemoteOK  (`site=remoteok`, id `rok_<id>`) , status: LIVE

- `GET https://remoteok.com/api`, timeout 12 s. No params; returns the whole feed (~100 jobs, ~580 KB). Behind Cloudflare, no blocking seen with the UA above.
- Response: JSON list. Element 0 is `{"last_updated", "legal"}` (no `id` -> skipped by the `job.get("id")` check). Job fields used: `id, position, company, company_logo, tags[], description (HTML), salary_min, salary_max, date (ISO), url, slug`.
- Filter (local): `matches_any(keywords, position, " ".join(tags), description)`. Stop at `results_wanted`.
- Mapping: `id="rok_"+id`; `title=position`; `company`; `company_url=company_logo` (sic, it is the logo URL); `location="Remote"`; `job_type="fulltime"`;
  `salary_range`: both min&max -> `USD {min:,} – {max:,}` (en dash U+2013, thousands comma, ints), only min -> `USD {min:,}+`, else ""; (max only -> "");
  `posted_date=date[:10]`; `description` raw HTML; `url=url or https://remoteok.com/l/<slug>`.
- Quirks: no server-side search, keywords filtered locally against position/tags/description. Keywords are NOT PT-expanded.
- Fixtures: `remoteok/live.json` (legal notice + 8 jobs); cases `python`, `data_engineer`, `python_cap2`.

### 1.2 Arbeitnow  (`site=arbeitnow`, id `an_<md5(slug)[:8]>`) , status: LIVE (EU focus; rarely useful for Brazil)

- `GET https://www.arbeitnow.com/api/job-board-api?page=1&search=<" ".join(keywords[:4])>`, timeout 22 s. `search` omitted when empty. If `data` is empty and a search term was sent, a second request without `search` is made.
- Observed 2026-10-11: **the `search` param is ignored by the server** (`search=zzzqqq` returns the same 325 jobs as no search; `page=2` also returns 325 items). So the fallback branch never fires and filtering is entirely local. Response headers `x-ratelimit-limit: 50` (remaining decremented per call). Whole feed ~2.9 MB.
- Response: `{"data":[...], "links":{...}, "meta":{...}}`. Job fields: `slug, company_name, title, description (HTML), remote(bool), url, tags[], job_types[], location, created_at (unix seconds), salary_from, salary_to`.
- Filter: `matches_any(keywords, title, " ".join(tags), description)`; cap `results_wanted`.
- Mapping: `id="an_"+md5(str(slug))[:8]`; `company=company_name`; `company_url=""`; `location=location or ("Remote" if remote else "")`; `job_type="fulltime"`;
  salary: from&to -> `EUR {from:,} – {to:,}`, from only -> `EUR {from:,}+`, else ""; `posted_date`: int/float -> UTC `YYYY-MM-DD` (failure -> ""), string -> first 10 chars, None -> "";
  `description` raw HTML; `url`.
- Fixtures: `arbeitnow/live.json` (10 jobs of 325, with links/meta kept); cases `python`, `data_engineer`, `python_cap2`.

### 1.3 Gupy portal  (`site=gupy`, id `gupy_<md5(str(id))[:8]>`) , status: LIVE (the only working Gupy path)

- Old API `https://portal.api.gupy.io/api/job?name=...` returns **404** for every query (verified 2026-10-11). Company subdomains `<x>.gupy.io` listed in the registry are not used by any scraper.
- Working path: `GET https://portal.gupy.io/job-search/term=<urlencode(term[:200], safe="")>` (+ `&workplaceTypes[]=remote` when the search is remote). HTML headers (see above). Timeout 18 s.
- Data: the page embeds `<script id="__NEXT_DATA__" type="application/json">{...}</script>`; regex `<script id="__NEXT_DATA__"[^>]*>(.*?)</script>` (DOTALL); jobs at `props.pageProps.initialJobList.data` (12 items); `initialJobList.pagination = {total, limit:12, offset:0}`.
- **No pagination**: `offset`/`?offset=` are ignored (same first 12 ids). Only the first 12 results per term are reachable. Total hits e.g. python=29, "engenheiro de dados"=86.
- One request per distinct keyword (case-insensitive dedupe, trimmed, max 4 terms, fallback term `desenvolvedor` when no keywords), **sequential with >= 1.0 s sleep between terms** (Gupy resets connections after a quick burst: a 3rd request within ~1 s raised `ConnectError` in testing). Per term: 2 attempts, 1.5 s sleep between; retried on any exception including "no `__NEXT_DATA__`" / missing `initialJobList`. If every term failed (no page had rows and the last error exists) the last exception is raised (-> `status.error`).
- Merge: rows keyed by `str(job["id"])`, first wins (`id` None or non-dict skipped), insertion order = term order then page order.
- Filter: `matches_any(keywords, name, description)` where `keywords` is the PT-expanded list (3.4). Cap `results_wanted`.
- Mapping: `title=name`; `company=careerPageName`; `company_url=careerPageUrl or careerPageLogo or ""`; `posted_date=publishedDate[:10]`; `description` plain text; `url=jobUrl`;
  `location`: workplaceType (lower) == `remote` -> `Remoto, Brasil`; else `"{city}, {state}"` stripped of leading/trailing `", "` chars when either present, else `Brasil`;
  `job_type` from `type` via {full_time: fulltime, part_time: parttime, internship: internship, temporary: contract, freelancer: contract, apprenticeship: parttime}, default `fulltime`;
  `is_remote`: remote -> true; hybrid -> null + `tags=["hybrid"]`; any other non-empty workplaceType -> false; empty -> key absent.
- Fixtures: `gupy/{python,python_remote,data_engineer,engenheiro_de_dados}.html` (trimmed HTML containing the original head + the trimmed `__NEXT_DATA__`); cases `python`, `python_remote`, `data_engineer_pt_merged` (2 pages), `python_cap2`.

### 1.4 Programathor  (`site=programathor`, id `pt_<md5(href)[:8]>`) , status: LIVE

- `GET https://programathor.com.br/jobs` and `?page=N` (N>=2), HTML headers, timeout 20 s. `max_pages = min(15, max(3, results_wanted // 8 + 3))`; sequential, no sleep. Stop when a page yields no cards or fewer than 5 cards. Any HTTP error raises (-> status error). The `/jobs-json` legacy endpoint no longer returns JSON.
- There is no server-side search used: all keyword matching is local. About 15 cards/page, page weight ~220 KB.
- Card parse (`parse_programathor_listing`): for each `a[href^="/jobs/"]` whose href matches `^/jobs/(\d+)-` and not already seen **within the page**: `title` = text of `h3` (whitespace joined with a space, strip) with a trailing `NOVA` (case-insens.) removed; for each `span` in `.cell-list-content-icon span, .cell-list-content span`: if its `<i>` markup contains `briefcase` and company empty -> company; contains `map-marker` and location empty -> location (the `i` is `fa fa-briefcase` / `fas fa-map-marker-alt`); `.tag-list` texts (strip) joined with a space = description (skills). `url = https://programathor.com.br{href}`.
- Pages are concatenated without cross-page dedup (the pipeline dedups later). Filter: `matches_any(keywords, title, skills, company)`; cap.
- Mapping: `location` = parsed or `Brasil` (e.g. `Sao Caetano do Sul/SP  (Hibrido)`, kept verbatim so `_infer_work_mode` can see "hibrido"); `job_type="fulltime"`; `posted_date=""`; `company_url=""`; no `is_remote` key.
- Fixtures: `programathor/page1.html` (8 cards), `page2.html` (5 cards): original card markup under a minimal wrapper. Cases `python_page1`, `python_two_pages`, `frontend_cap2`.

### 1.5 Trampos  (`site=trampos`, id `trampos_<md5(str(id))[:8]>`) , status: LIVE

- `GET https://trampos.co/api/v2/opportunities?tr=<term>`, JSON headers, timeout 18 s, nginx. One request per distinct keyword (same `_terms` rule as Gupy: max 4, fallback `desenvolvedor`), sequential, no sleep. If every term failed -> raise last error.
- Response: `{"opportunities":[...], "types", "categories", "pagination":{total,total_pages,per_page:12}}`. A `page=N` param works (verified: `analista de dados` has 3 pages) but the scraper only reads page 1 (<= 12 per term).
- Search semantics: server-side, all words must match (AND): `python` -> 4, `data engineer` -> 0, `engenheiro de dados` -> 0, `analista de dados` -> 29. No local keyword filter (the PT-expanded keyword list still drives the queries).
- Merge by `str(id)`, first wins. Fields used: `id, name, custom_company_name, company{name,url}, city, state, home_office, hybrid, type_slug, salary, published_at, category_name`.
- Mapping: `title=name`; `company=custom_company_name or company.name or ""`; `company_url=company.url or ""`; `location`: city/state present -> `"{city}, {state}"` stripped of `", "` edge chars; else `Remoto, Brasil` if home_office else `Brasil`;
  `job_type` from `type_slug` {estagio: internship, freelance: contract, trainee: internship} default `fulltime`; `salary_range=salary or ""` (verbatim, e.g. `R$ 10.000 a R$ 12.000`);
  `posted_date=published_at[:10]`; `description=category_name or ""`; `url=https://trampos.co/oportunidades/<id>`; `is_remote`: home_office -> true; elif hybrid -> null + `tags=["hybrid"]`; else key absent.
- Fixtures: `trampos/{python,analista_de_dados,data_engineer_empty}.json`; cases `python`, `analista_de_dados`, `data_engineer_empty`, `two_terms_merged`.

### 1.6 Greenhouse  (`site=greenhouse`, id `gh_<token[:6]>_<md5(str(id))[:8]>`) , status: LIVE

- Boards: every registry source with `ats=="greenhouse"` and an `api` block (`ifoodcarreiras`, `hotmartcareersbr`) plus hard-coded supplemental boards `anthropic` (company `Anthropic`) and `inter` (company `Banco Inter`), in that order.
- `GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`, JSON headers, timeout 18 s, boards fetched concurrently with a semaphore of 5. 404 -> that board returns []; any other error -> logged, board returns [] (**swallowed**, not in status). No pagination (whole board, ifood 417 KB, inter 1.5 MB, anthropic 9.3 MB).
- Dead/empty boards verified 2026-10-11: `nubank` -> `200 {"jobs":[],"meta":{"total":0}}`; `picpay`, `creditas` -> `404 {"status":404,"error":"Job not found"}` (moved ATS); not in the registry.
- Response: `{"jobs":[{id,title,updated_at,absolute_url,location:{name},content (HTML-escaped HTML)}], "meta"}`.
- Filter (only if keywords non-empty): `matches_any(keywords, title, strip_html(content))` with `strip_html = unescape -> replace <[^>]+> with " " -> collapse whitespace -> strip`.
- Mapping: `company` = registry `name` (e.g. `iFood (Greenhouse)`) ; `location=location.name or "Brasil"`; `job_type="fulltime"`; `posted_date=updated_at[:10]`; `description=strip_html(content)`; `url=absolute_url`; `company_url=""`.
- Result: boards' lists concatenated in board order then `[:results_wanted]` (so earlier boards can starve later ones).
- Fixtures: `greenhouse/{ifood,hotmart,anthropic,inter,nubank_empty}.json`; cases `ifood_python`, `hotmart_python`, `anthropic_python`, `inter_data_engineer`, `nubank_empty` (ctx `company`, `token`).

### 1.7 Lever  (`site=lever`, id `lv_<site[:6]>_<md5(id or text)[:8]>`) , status: LIVE (single board)

- Boards: registry `ats=="lever"` -> only `neon` (`Neon Pagamentos (Lever)`). `GET https://api.lever.co/v0/postings/<site>?mode=json`, JSON headers, timeout 18 s, semaphore 5, 404/other errors -> []. Returns the full list (13 postings, 167 KB). No rate limit seen.
- Response: JSON list; non-list -> []. Fields: `id, text, categories{location,commitment,...}, descriptionPlain, createdAt (ms), hostedUrl, workplaceType (ignored)`.
- Filter: `matches_any(keywords, text, descriptionPlain)` (always applied; empty keywords match all).
- Mapping: `title=text`; `location=categories.location or "Brasil"`; `job_type="fulltime"` (commitment ignored); `posted_date`: `createdAt/1000` -> UTC date ISO, falsy/error -> ""; `description=descriptionPlain`; `url=hostedUrl`.
- Fixtures: `lever/neon.json` (8 postings); cases `neon_analista`, `neon_engineer`, `neon_no_match`.

### 1.8 Workday  (`site=workday`, id `wd_<tenant[:6]>_<md5(externalPath or title)[:8]>`) , status: LIVE for 3 of 4 boards

- Boards from registry (`ats=="workday"`): `santander` (`santander.wd3.myworkdayjobs.com/pt-BR/SantanderCareers`), `equinor` (`equinor.wd3.../pt-BR/EQNR`), `aes` (`aes.wd1.../pt-BR/AES_BRAZIL`), `natura` (`avon.wd5.../NaturaCarreiras`).
  **Natura -> 403** `{"errorCode":"S22","httpStatus":403,"message":"permission denied"}` (verified; scraper `break`s the keyword loop on 403/404).
- URL parse: hostname = URL host (must contain `myworkdayjobs`), tenant = first host label, site = last non-empty path segment (a leading locale segment like `pt-BR` is skipped only because site is the last one).
- `POST https://<host>/wday/cxs/<tenant>/<site>/jobs`, headers JSON + `Content-Type: application/json`, body `{"appliedFacets":{},"limit":min(results_wanted,20),"offset":0,"searchText":<term>}`. One POST per term (keywords stripped, empty skipped, max 3 terms, `[""]` if none), sequential inside a board, boards concurrent with semaphore 4, timeout 20 s. Errors other than 403/404 are logged per term and ignored. No pagination (offset always 0).
- Search semantics: Workday ANDs the words of `searchText`; santander `python` -> 55 total (20 returned), equinor `python` -> 0, `data engineer` -> 2, aes `python` -> 0.
- Response: `{"total", "jobPostings":[{title, externalPath, locationsText, postedOn ("Posted 16 Days Ago" , ignored), bulletFields[]}], "facets", "userAuthenticated"}`.
- No local keyword filter. Merge by `externalPath or title`, first wins.
- Mapping: `title`; `company` = registry name (`Santander Brasil (Workday)`); `location=locationsText or "Brasil"` (e.g. `6 Locations`); `url=https://<host><externalPath>` ("" if no path); `posted_date=""`; `description=""`; `job_type="fulltime"`.
- Result: boards concatenated, `[:results_wanted]`.
- Fixtures: `workday/{santander_python,santander_data_engineer,equinor_data_engineer,aes_empty}.json`; cases `santander_python`, `santander_two_terms_merged`, `equinor_data_engineer`, `aes_empty` (ctx `hostname`, `tenant`, `company`).

### 1.9 Dead / disabled / unused

| Source | State (2026-10-11) |
|---|---|
| Gupy old API `portal.api.gupy.io/api/job` | 404 for every query |
| Google Jobs (JobSpy `google`) | 0 results, `Google returned no job data` (broken upstream as well) |
| ZipRecruiter (JobSpy `zip_recruiter`) | Cloudflare 403 (`ZipRecruiter response status code 403`); US-only anyway |
| Natura Workday (`avon.wd5`) | 403 permission denied |
| Nubank Greenhouse (`nubank`) | 200 but 0 jobs |
| PicPay / Creditas Greenhouse | 404 (moved) |
| Registry entries with `ats` gupy / eightfold / oracle_jobs2web | no API scraper; Eightfold/Jobs2Web only reachable through Playwright |
| Bayt (JobSpy) | in `_JOBSPY_SITES` but irrelevant for Brazil (MENA); untested |

### 1.10 Playwright scraper (`site=playwright`, id `pw_<source[:8]>_<hash>`) , slated for replacement

Generic headless-Chromium extractor in `playwright_scraper.py` for ~30 "priority" corporate career portals from the registry (Itau, Bradesco, Magalu, B3, Stone, Uber, OpenAI, IBM, Meta, Apple, Google, Amazon, Microsoft, SAP, Vale/MercadoLibre Eightfold, Shell, Petrobras, ..., with 2 URL overrides).
Behaviour: semaphore 3 pages; navigate `listing_url` (domcontentloaded, then up to 10 s networkidle + 2 s wait, cookie banner dismissal), find job links with an ordered list of CSS selectors (`a[href*="/jobs/"]`, `a[href*="/job/"]`, ...), derive the title from the anchor/container, filter with `matches_any`, emit rows with **hard-coded `location="Brasil"`, `job_type="fulltime"`, empty date/description**. It is exempt from the location post-filter for that reason. Sites excluded for bot detection are listed in the module header (nubank, rappi, quintoandar, vivo, globo).
Replacement plan: per portal, capture the site's own XHR JSON (record the request once like the other fixtures) or read `application/ld+json` `JobPosting` objects from the HTML, both without a browser. Not ported as-is.

---

## 2. JobSpy boards (vendored `jobspy/`, version 1.3.0)

All three below are reimplemented from scratch in Rust, so this section documents the wire format. The call made by `_search_jobspy` is
`scrape_jobs(site_name=[site], search_term, location=location or None, results_wanted, job_type, country_indeed, is_remote, hours_old, fetch_description=("linkedin" in sites), description_format="markdown", verbose=0)`.
`distance` is JobSpy's default 50 (miles) on every board. `verbose=0` => only ERROR records are emitted by the board loggers (`JobSpy:LinkedIn`, `JobSpy:Indeed`, `JobSpy:Glassdoor`, ...).
Recorded exchange for each board: `tests/fixtures/sources/<board>/request.json` (+ response files, `expected.json` = output of `_search_jobspy`, replayed offline by `test_jobspy_replay`).

Post-processing in `scrape_jobs` that shapes the DataFrame row (identical for all boards): `location` = `Location.display_location()` = `city, state, country` where a known country is rendered by `country.value[0].split(",")[0].title()` except `usa`/`uk` -> upper-case; `job_type` = comma-joined first alias of each enum; `emails`/`skills` comma-joined; compensation (direct data) -> `interval,min_amount,max_amount,currency`; **only when `country_indeed == usa`** and there is no direct compensation the salary is regex-extracted from the description; rows are sorted by `site` asc then `date_posted` desc (None last). `_search_jobspy` then maps each row (section 3.7).

### 2.1 LinkedIn (guest API) , status: LIVE (2026-10-12: 200, 10 cards/page, no auth, no 429 in 6 requests)

- Library `requests` (no TLS impersonation needed; default python UA also worked), cookies cleared before every request (`clear_cookies=True`).
- Headers: `user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`, `accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7`, `accept-language: en-US,en;q=0.9`.
- Search: `GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<term>&location=<board_location>&distance=50&start=<0,10,20,...>`; extra params only when set: `f_AL=true` (easy_apply, unused), `f_C` (company ids, unused), `f_TPR=r<hours_old*3600>`. None-valued params are dropped. `is_remote` and `job_type` are NOT supported (ignored with a WARNING that verbose=0 hides).
- Response: HTML fragment of `<li><div class="base-card ... base-search-card ..." data-entity-urn="urn:li:jobPosting:<id>">`; **end of results = body exactly `"<!DOCTYPE html>\n\n<!---->"`** (empty page); any other card-less body is logged as `LinkedIn: unexpected page with no jobs (blocked?)` (ERROR). Non-200 -> ERROR `LinkedIn response status code <n>` (429 = rate limit "Blocked by LinkedIn" in earlier sessions) and the loop stops with the jobs gathered so far.
- Pagination: `start += 10` while `len(job_list) < results_wanted`, `start < 1000` and the page had 10 cards and >= 1 new id; between pages `sleep(uniform(3, 7))`. Cards are deduped by job id. Stops as soon as `results_wanted` cards are processed (so 5 wanted = 5 detail fetches).
- Card parse (CSS): title `h3.base-search-card__title` text; company `h4.base-search-card__subtitle` text, company_url = href of its `a` without query; location `span.job-search-card__location` text -> `parse_location` (3 comma parts = city/state/country; 2 parts with a 2-letter upper-case last part = city,state,USA; 2 parts otherwise = city,country; 1 part = a country if known else a city/area); date `time[datetime]` ISO date (None if missing); `is_remote` = any of `remote|work from home|wfh` in `"<title> <display_location>".lower()`; `job_url = https://www.linkedin.com/jobs/view/<id>`; `id = li-<id>`.
- **Job detail** (only with `fetch_description`, i.e. always for LinkedIn in JumpShip): per job `GET https://www.linkedin.com/jobs/view/<id>` (same headers, redirects followed, ~300 KB, sequential, no delay). Skipped (empty details, WARNING) when status != 200 or the final URL path does not start with `/jobs/view/` (auth wall). Extracted: description = `div.show-more-less-html__markup` with attributes stripped, `prettify(formatter="html")`, converted by `markdownify` to Markdown (+ emails regex); logo `img.artdeco-entity-image[data-delayed-url]`; salary `div.compensation__salary` with regex `([^\d\s]+) ?([\d,]+\.\d\d)(/\w+) - [^\d\s]+ ?([\d,]+\.\d\d)/\w+` (`$117,000.00/yr - $234,000.00/yr`; intervals /hr /mo /yr; currency map `$`USD `CA$`CAD `£`GBP `€`EUR `₹`INR); criteria list `h3.description__job-criteria-subheader` -> next sibling `span.description__job-criteria-text` for "Employment type" (job_type via alias lookup after lower-casing and removing `-`), "Seniority level" (job_level lower), "Job function", "Industries".
- Quirks: Brazilian locations often come back as `Greater São Paulo Area`; the Markdown conversion is the hardest piece to replicate byte-exactly (fixtures `linkedin/expected.json` pin it).
- Fixtures: `linkedin/search_page.html` (raw 10-card page), `job_<id>.html` x5 (detail pages reduced to the subtrees listed above), `request.json`, `expected.json`.

### 2.2 Indeed (mobile GraphQL API) , status: LIVE (2026-10-12: 200, 100 results/page, 748 KB)

- Library `requests` (no TLS impersonation). `POST https://apis.indeed.com/graphql`, body JSON `{"query": "<GraphQL text>"}` (full text in `indeed/request_body.json`; built from `jobspy/indeed/constant.py::job_search_query`).
- Required headers: `content-type: application/json`, `indeed-api-key: 161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8` (without it: 401 `An API Key is required.`), a browser-like `user-agent` (**missing UA -> Cloudflare 403**; vendored one is `Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1`), `accept: application/json`, `accept-language: en-US,en;q=0.9`, `indeed-app-info: appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone` (optional; works without), `indeed-co: <CC>` (**required for country**: without it the search returns 0 results) and `indeed-locale: <lang>-<CC>` (optional). `<CC>`: `BR` for brazil; table in `jobspy/model.py::Country.indeed_domain_value` (e.g. uk -> `GB`, usa -> `US`); language map in `jobspy/indeed/constant.py::languages` (BR -> pt).
- Query variables inlined into the GraphQL string: `what: <json-encoded term>`, `location: {where: <json string>, radius: 50, radiusUnit: MILES}`, `limit: 100`, optional `cursor: "<nextCursor>"`, `sort: RELEVANCE`, `filters: [...]`: `{ date: { field: "dateOnIndeed", start: "<hours_old>h" } }`; job type attribute keys (fulltime `CF3CP`, parttime `75GKK`, contract `NJXCK/T9BXE/T65DZ` OR-ed, internship `VDTG7`, temporary `4HKF7/CJWTS`, per diem `TQKYQ`, volunteer `UXQZ8`; Japan fulltime also `5QWDV`); remote: attribute `DSQF7` and exclude hybrid `PAXZC` (`match: MUST_NOT`).
- Pagination: cursor-based (`pageInfo.nextCursor`), loop until `results_wanted`, no cursor, or an empty page. No inter-page delay. Errors: non-200 -> ERROR `Indeed response status code <n>`; `data.jobSearch` null -> ERROR `Indeed: <errors>`.
- Response: `data.jobSearch.results[].job` with `key, title, sourceEmployerName, dateOnIndeed (ms), description.html, location{countryCode,admin1Code,city}, compensation{estimated,baseSalary{unitOfWork,range},currencyCode}, attributes[{key,label}], employer{relativeCompanyPageUrl,name,ugcStats,dossier{...}}, recruit.viewJobUrl`. Jobs deduped by `key`.
- Mapping to JobPost: `id=in-<key>`; `company=employer.name or sourceEmployerName`; `company_url=https://br.indeed.com<relativeCompanyPageUrl>`; `company_url_direct=dossier.links.corporateWebsite`; `location` city, `admin1Code` as state, country from `countryCode`; description HTML -> Markdown; `date_posted` = UTC date of `dateOnIndeed/1000`; `job_url=https://<sub>.indeed.com/viewjob?jk=<key>` (`br.indeed.com`); `job_url_direct` = `recruit.viewJobUrl` unless its host ends with `.indeed.com`; `is_remote` = attribute `DSQF7` present and `PAXZC` absent; job_type from attribute codes; compensation: employer pay else Indeed estimate, interval map HOUR/DAY/WEEK/MONTH/YEAR, range `min/max/value`.
- Fixtures: `indeed/search_response.json` (first 5 of 100 results, nextCursor kept), `request.json`, `request_body.json`, `expected.json`.

### 2.3 Glassdoor (GraphQL) , status: LIVE (2026-10-12) but needs TLS impersonation + cookie priming

- Library `curl_cffi` with `impersonate="chrome"`. **Verified**: plain `requests`, plain `curl_cffi` (no impersonation) and a Chrome user-agent over plain TLS all get Cloudflare `403 Forbidden / "Security | Glassdoor"`. Rust needs a Chrome-fingerprint TLS client (e.g. `wreq`/`rquest`). A single cookie jar must be shared by both calls.
- Host by country: `Country.glassdoor_domain_value` (brazil -> `https://www.glassdoor.com.br`, usa -> `https://www.glassdoor.com`; countries without a Glassdoor domain raise -> ERROR and 0 results).
- Call 1 (also the cookie priming): `GET https://www.glassdoor.com.br/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY&caller=jobs&term=<percent-encoded plain location>` with header `gd-csrf-token: Ft6oHEWlRZrxDww95Cpazw:0pGUrkb2y3TyOpAIqF2vbPmUXoXVkD3oEGDVkvfeCerceQ5-n8mBg3BovySUIjmCPHCaW0H2nQVdqzbtsYqf4Q:wcqRqeegRUa9MVLJGyujVXB7vWFPjdaS1CtrrzJq-ok`. Sets cookies `gdId`, `asst`, `__cf_bm`. Response: list of places; the first is used (`locationId` int, `locationType` C/S/N -> CITY/STATE/COUNTRY). Empty list -> ERROR `Glassdoor: location '<x>' not found` and no search. **Glassdoor rejects "City, Country"** so JumpShip sends `plain_location` (`São Paulo`, or `Brazil`/`Brasil` for a country).
- Call 2: `POST https://www.glassdoor.com.br/graph`, `Content-Type: application/json`, same `gd-csrf-token` header, body = JSON array of one operation `{"operationName":"JobSearchResultsQuery","variables":{keyword, numJobsToShow:100, filterParams:[{filterKey,values}], locationId, locationType, parameterUrlInput:"IL.0,12_I<TYPE><id>", pageNumber, pageCursor},"query":<search_query>}` (full text in `glassdoor/request_body.json`). filterParams (all values strings): `radius=50` (when a location is set), `fromAge=ceil(hours_old/24)`, `jobType` (`fulltime|parttime|contract|internship|temporary`), `remoteWorkType=1`, `applicationType=1`. **Verified**: POST without the priming cookies -> 403; without the csrf header -> 403 (even primed); the static token value above is accepted.
- Pagination: `pageNumber` + `pageCursor` from `paginationCursors` (`pageNumber == page+1`), 100 jobs/page, loop until `results_wanted` or no cursor / no new ids. Non-200 -> ERROR `Glassdoor response status code <n>`; missing `data.jobListings` -> ERROR `Glassdoor: API error: <errors>`.
- Response: JSON array `[ {"data":{"jobListings":{"jobListings":[{"jobview":{header{...},job{jobTitleText,listingId},map{country},overview{...}}}],"paginationCursors":[...]}}} ]`.
- Mapping: `id=gd-<listingId>`; title; `company=header.employerNameFromSearch`; `company_url=https://www.glassdoor.com.br/Overview/W-EI_IE<employerId>.htm`; `company_url_direct=overview.website` (prefix `https://` when missing); `location` from `locationName` + `locationType` (N=country only, S=state, else `city, state`), country from `map.country`; `Remote` => no location; `date_posted = today(UTC) - ageInDays` (**time-dependent**; fixtures freeze `now` to 2026-10-12T00:55:00Z); `job_url=https://www.glassdoor.com.br/job-listing/j?jl=<id>`; `is_remote` = `WORK_FROM_HOME` in `remoteWorkTypes` or `locationName == "Remote"`; compensation from `payPeriodAdjustedPay.p10/p90` + `payPeriod` (ANNUAL/MONTHLY/HOURLY) + `payCurrency`; `listing_type = adOrderSponsorshipLevel.lower()`; when `hours_old` is set jobs with `ageInDays >= ceil(hours_old/24)` are dropped.
- **No description**: `fetch_description` is False for Glassdoor in JumpShip (only LinkedIn gets it), so Glassdoor rows have `description == ""`. (JobSpy can fetch 25 descriptions per `JobDetails` GraphQL call; not used.)
- Fixtures: `glassdoor/autocomplete_response.json`, `search_response.json` (first 5 of 100 listings, cursors kept), `request.json`, `request_body.json`, `expected.json`.

### 2.4 Source error surfacing (new)

JobSpy never raises for board failures; it logs. `_search_jobspy` now attaches a `_BoardLogCapture` handler (level WARNING) to the board's logger (`JobSpy:LinkedIn|Indeed|Glassdoor|ZipRecruiter|Google|Bayt`) for the duration of the call and removes it in `finally`; the first ERROR message (else the first WARNING that does not contain "isn't supported") is returned through the `board_errors` dict and `search_jobs` stores it (truncated to 200 chars) as `status[site].error`, even when some jobs were found (such a search is then not cached). Because each call handles one board with its own logger, concurrent board calls do not see each other's records (two concurrent searches for the *same* board can). Examples seen live: `ZipRecruiter response status code 403`, `Google returned no job data`; LinkedIn 429 shows as `LinkedIn response status code 429`.

---

## 3. Cross-source pipeline (`backend/services/job_scraper_v2.py::search_jobs`)

Signature: `search_jobs(keywords, location="Remote", job_type="fulltime", sites=None, results_wanted=20, hours_old=None, work_mode="any", status_out=None)`.
Called by `POST /api/jobs/search`; the router sets header `X-Source-Status: json.dumps(status)` (ASCII-escaped) = `{site: {"count": int, "error": str|null}}` for every requested site.

### 3.1 Normalisation and cache

1. `sites` default `["indeed","linkedin","glassdoor"]`. `job_type`: `None` if `(job_type or "all").lower()` is `"all"` or `""`, else passed as-is. `work_mode = (work_mode or "any").lower()` with `-` and `_` removed (`on-site` -> `onsite`).
2. `cache_key = json.dumps({"kw": sorted(keywords), "loc": location, "jt": job_type, "sites": sorted(sites), "n": results_wanted, "h": hours_old, "wm": work_mode}, sort_keys=True)`. In-memory dict `key -> (timestamp, jobs, status)`; TTL 900 s. A hit returns the cached jobs and copies the cached status into `status_out`.
3. Cache write: only if the final job list is non-empty **and no site has an error**. After every search, entries older than the TTL are evicted.

### 3.2 Location resolution (`resolve_location(label) -> ResolvedLocation`)

Fields: `board_location` (string sent to boards, "" = none), `country_indeed` (JobSpy country name), `is_remote`, `hybrid`, `country_key` (post-filter country, "" = any), `plain_location`.
Tables come from `backend/data/locations.json`: `countries` (key = JobSpy country name -> folded aliases), `other_countries` (recognised only in *job* locations), `cities` (country -> folded city names), `country_display` (`usa`->"United States", `uk`->"United Kingdom"; others `key.title()`), `us_states`, `us_states_ambiguous`, `remote_labels`, `hybrid_labels`, `remote_words`, `hybrid_words`.

- `fold(s)`: NFKD, drop combining marks, `casefold()`, collapse whitespace, strip.
- `_job_countries(text)`: `folded = fold(text)`; alias regex `(?<!\w)(?:a1|a2|...)(?!\w)` over all aliases of `countries` + `other_countries` (alternatives escaped, sorted by length desc, stable); if any matches -> set of their countries; else same with the city regex (cities -> country); else if any `,\s*([A-Z]{2})\b` match in the **unfolded** text is in `us_states` and not in `us_states_ambiguous` -> `{"usa"}`; else empty set.
- `resolve_location(label)`:
  1. `raw = (label or "").strip()`. Regex `^(.*?)\s*\(([^)]*)\)\s*$`: `base_raw` = group 1 stripped, `qual = fold(group 2)`; no match -> `base_raw=raw`, `qual=""`. `base = fold(base_raw)`.
  2. `base` in `remote_labels`: if `qual` and `"remot" not in qual` and `"todo o pais" not in qual` and `"country" not in qual` -> `resolve_location(group 2)` with `is_remote=True` (e.g. `Remote (Brazil)`); else `("Remote","usa",True,False,"","Remote")`.
  3. `base` in `hybrid_labels` -> `("", "usa", False, True, "", "")`.
  4. `found = _job_countries(base_raw)`; `ck = the single element if len(found)==1 else ""`; `name = country_display.get(ck, ck.title())`.
  5. `board = name` if `base` is a country alias (any key of the merged alias map); `f"{base_raw}, {name}"` if `base` is a known city; else `base_raw`. `plain = name` if base is a country alias else `base_raw`.
  6. Result `(board, ck if ck in countries else "usa", "remot" in qual, False, ck, plain)`.
- Examples (also the unit tests): `Brasil (todo o país)` -> (`Brazil`,`brazil`,F,F,`brazil`); `Brasil (Remoto)` -> remote True; `São Paulo` -> (`São Paulo, Brazil`, plain `São Paulo`); `New York, NY` -> (`New York, NY`,`usa`); `Remote` -> (`Remote`,`usa`,T,F,``); `Hybrid` -> (``,`usa`,F,T,``); `Cambridge` -> (`Cambridge`,`usa`,F,F,``).

### 3.3 Per-site dispatch

`remote = resolved.is_remote or work_mode == "remote"` (if true and not resolved.is_remote, `resolved.is_remote` is set). `mode = work_mode` if not `"any"`, else `"remote"` if `resolved.is_remote`, `"hybrid"` if `resolved.hybrid`, else `"any"`. `board_loc = resolved.board_location`. One task per requested site, all awaited concurrently (`asyncio.gather(return_exceptions=True)`), in request order:

- JobSpy sites (`linkedin, indeed, glassdoor, zip_recruiter, bayt, google`): location sent = `plain_location` for glassdoor; for zip_recruiter `board_loc` if `_is_us_location(board_loc)` (country set == {usa}... i.e. `"usa" in _job_countries`) else `"United States"`; else `board_loc`. Args: `country_indeed=resolved.country_indeed`, `is_remote=remote`, `hours_old`, `job_type`. Search term: one keyword -> as is; several -> each keyword containing a space wrapped in double quotes, joined with ` OR `. Raw JobSpy runs in a thread.
- Extra sites (`remoteok, arbeitnow, gupy, programathor, trampos, greenhouse, lever, workday, playwright`): keywords passed through `_pt_keywords` for `gupy, programathor, trampos, greenhouse, lever, workday, playwright` (not for remoteok/arbeitnow); `gupy` additionally gets `remote` (adds `&workplaceTypes[]=remote`) and `board_loc` (unused). Other fetchers ignore location entirely.
- Unknown site -> `status[site].error = "unknown site"`.
- Exceptions from a site task -> `status[site].error = f"{ExceptionClassName}: {str(exc)[:120]}"`, no results from that site. JobSpy-logged errors (2.4) -> `status[site].error = msg[:200]`.

### 3.4 PT keyword expansion (`_pt_keywords`)

`result = list(keywords)`; for each keyword `kw`, `pt = en_to_pt.get(kw.lower())`; if `pt` and `pt not in result` append (exact string compare). Table `backend/data/keywords_pt.json` (`software engineer`->`engenheiro de software`, `data engineer`->`engenheiro de dados`, `machine learning`->`aprendizado de máquina`, ...). Note the lookup key is `kw.lower()` only (no trimming/folding).

### 3.5 Merge, dedup, enrichment

1. Concatenate site results in request order; drop duplicate `id` (first wins).
2. `_dedup_jobs`: key `f"{n(title)}|{n(company)}"`, `n(s) = re.sub(r"\s+"," ", re.sub(r"[^\w ]","", fold(s))).strip()` (Unicode `\w`: CJK titles are kept distinct); first occurrence wins, order preserved. This collapses the same job from different boards (e.g. Indeed/Glassdoor) and also same-title postings of one company.
3. Rows whose `site` is an extra site get `_enrich_extra`: `explicit = job.is_remote`; `tags = list(job.tags or [])`; if `explicit is None and "hybrid" in tags` -> (None, hybrid); elif `explicit is not None` -> (explicit, False); else `_infer_work_mode(location, description, None)`. Then `job.is_remote = is_remote`; `job.tags = unique(tags + _basic_tags(job, is_remote, hybrid))`. (JobSpy rows get the same inference inside `_search_jobspy`.)
4. `_infer_work_mode(location, description, raw_is_remote) -> (is_remote, hybrid)`: `loc = str(location or "").lower()`, `desc = str(description or "")[:500].lower()`. In order: raw flag `True`/`"true"` -> (True, False); any `remote_words` in `loc` -> (True, False); any `hybrid_words` in `loc` -> (None, True); `remote_words` in `desc` -> (True, False); `hybrid_words` in `desc` -> (None, True); else `(False if loc and loc != "nan" else None, False)`.
5. `_basic_tags(row, is_remote, hybrid)`: work mode tag: `remote` if is_remote is True; elif `hybrid` flag or `híbrido|hibrido|hybrid` in lower location -> `hybrid`; elif `is_remote is False` and location not in (`nan`,``,`none`) -> `on-site`. Seniority from lower title (first match wins): `senior|sênior|sr.| sr |staff|principal|lead` -> `senior`; elif `junior|júnior|jr.| jr |entry` -> `junior`; elif `mid|pleno|ii|iii` -> `mid-level` (plain substring tests, so `ii` matches inside words). Contract from lower `job_type`: `contract|freelan` -> `contract`; elif `parttime|part-time|part time` -> `part-time`.

### 3.6 Post-filters (applied in this order after enrichment)

1. **Location** (`_location_matches(job_location, resolved, job_is_remote)`), skipped for `site == "playwright"`. Keep when: job location blank or `nan`/`none` (case-insens.); else `remote_job = job.is_remote if not None else any(remote_words in loc.lower())`; if `resolved.is_remote and not remote_job` -> drop; if `resolved.country_key == ""` -> keep; else `found = _job_countries(job_location)`; keep when `found` is empty or contains `country_key` (so a "City" search is country-level). Examples: `Rio de Janeiro, RJ`, `Remote`, `` kept for Brazil; `New York, NY`, `El Salvador`, `Las Palmas, Spain`, `Indianapolis, IN` dropped.
2. **Work mode** (`_work_mode_ok(job, mode)`): `remote` -> `is_remote is True`; `hybrid` -> `"hybrid" in tags`; `onsite` -> `is_remote is False and "hybrid" not in tags`; any other -> keep.
3. **hours_old** for extra sites only (JobSpy filters itself): `_within_hours(posted_date, hours_old)`: keep if `hours_old` falsy or `posted_date` blank; parse `datetime.fromisoformat(posted.replace("Z","+00:00"))` (failure -> keep); if the string length is <= 10 (date only) add one day; naive -> UTC; keep when `now_utc - dt <= hours_old*3600 s`.

### 3.7 `_search_jobspy` row mapping (JobSpy -> job dict)

`id = md5(f"{title}-{company}-{job_url}")[:12]` (hex); `company_url`: `company_url_direct or company_url`, `nan` -> "", a value without `http` prefix is prefixed with the scheme+host of `job_url` (or dropped if none); `description` = str, `nan` -> ""; `(is_remote, hybrid) = _infer_work_mode(location, description, row.is_remote)`; `tags = _basic_tags(row, is_remote, hybrid)`; `location, job_type, title, company, url(job_url), site` via `_cell` (`None|nan|None|NaT` -> ""); `posted_date = _cell(date_posted)` (ISO date); `salary_range = _format_salary(row)`: both amounts -> `{currency} {min:,.0f} – {max:,.0f}`; min only -> `{currency} {min:,.0f}+`; max only -> `Up to {currency} {max:,.0f}`; currency default `USD`; `match_score=None`.
(Amounts are rounded half-even by Python's `format`; `nan` amounts count as missing.)

### 3.8 Status header and counts

After filters: for each remaining job `status[job.site].count += 1` (counted by the job's own `site`, after dedup and filters, so a board whose rows were all duplicates/filtered shows 0 without an error). `status_out.update(status)`.

---

## 4. Fixture inventory (`tests/fixtures/sources/`)

Non-JobSpy (29 golden cases in `cases.json`): `remoteok/live.json` 57 KB; `arbeitnow/live.json` 89 KB; `trampos/{python 8.6 KB, analista_de_dados 20 KB, data_engineer_empty 130 B}.json`;
`gupy/{python,python_remote,data_engineer,engenheiro_de_dados}.html` 141-148 KB each; `programathor/page1.html` 16 KB, `page2.html` 8 KB;
`greenhouse/{ifood 53 KB, hotmart 42 KB, anthropic 58 KB, inter 31 KB, nubank_empty 30 B}.json`; `lever/neon.json` 72 KB;
`workday/{santander_python 8 KB, santander_data_engineer 8 KB, equinor_data_engineer 2 KB, aes_empty 66 B}.json`; `<case>.expected.json` next to each case's group.
JobSpy boards: `linkedin/` (search_page.html 31 KB, 5 trimmed detail pages 4-6 KB, request.json, expected.json), `indeed/` (search_response.json 19 KB, request.json, request_body.json, expected.json), `glassdoor/` (autocomplete_response.json 3 KB, search_response.json 8 KB, request.json, request_body.json, expected.json).

Re-recording: the raw responses were fetched live with the headers above and trimmed by keeping the first matching items plus 1-2 non-matching ones (so the local keyword filter is exercised); `expected` files are generated by the Python parser (`run_case` in `tests/unit/test_source_parsers.py`), JobSpy `expected.json` by replaying the recording through the vendored jobspy and `_search_jobspy`.
