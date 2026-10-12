"""
JumpShip — Job scraper combining JobSpy + extra free sources.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
import json as _json
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

from backend.services.text_match import fold

logger = logging.getLogger(__name__)

# Simple in-memory cache with TTL: value = (timestamp, jobs, per-source status)
_search_cache: dict[str, tuple[float, list[dict], dict]] = {}
_CACHE_TTL = 900  # 15 minutes

# Sites handled by JobSpy
_JOBSPY_SITES = {"linkedin", "indeed", "glassdoor", "zip_recruiter", "bayt", "google"}
# Sites handled by our extra scrapers
_EXTRA_SITES = {"remoteok", "arbeitnow", "gupy", "programathor", "trampos", "greenhouse", "lever", "workday", "playwright"}

# ZipRecruiter only returns results for US locations.
# When the user searches "Remote" or a non-US location, we swap in a broad US fallback.
_ZIPRECRUITER_US_FALLBACK = "United States"


_US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}
# "City, ST" codes shared with Brazilian states ("Joinville, SC", "Belém, PA"): too ambiguous to call US.
_US_STATES_AMBIGUOUS = {"AL", "MA", "MT", "MS", "PA", "SC"}
_US_STATE_RE = re.compile(r",\s*([A-Z]{2})\b")


# ── Location resolution ───────────────────────────────────────────────────────
# Keys are JobSpy country names (valid `country_indeed` values); values are folded aliases.
_COUNTRIES: dict[str, tuple[str, ...]] = {
    "brazil": ("brasil", "brazil"),
    "usa": ("united states", "usa", "us", "estados unidos"),
    "canada": ("canada",),
    "uk": ("united kingdom", "uk", "england", "scotland", "wales", "great britain"),
    "germany": ("germany", "deutschland", "alemanha"),
    "france": ("france",),
    "spain": ("spain", "espana"),
    "portugal": ("portugal",),
    "netherlands": ("netherlands", "nederland", "holland"),
    "ireland": ("ireland",),
    "switzerland": ("switzerland", "schweiz", "suisse"),
    "sweden": ("sweden", "sverige"),
    "poland": ("poland", "polska"),
    "mexico": ("mexico",),
    "argentina": ("argentina",),
    "colombia": ("colombia",),
    "chile": ("chile",),
    "australia": ("australia",),
    "india": ("india",),
    "japan": ("japan",),
    "singapore": ("singapore",),
    "italy": ("italy", "italia"),
    "austria": ("austria",),
    "belgium": ("belgium",),
    "norway": ("norway",),
    "denmark": ("denmark",),
    "finland": ("finland",),
    "israel": ("israel",),
    "china": ("china",),
    "peru": ("peru",),
    "uruguay": ("uruguay",),
    "venezuela": ("venezuela",),
    "ecuador": ("ecuador",),
    "costa rica": ("costa rica",),
    "panama": ("panama",),
    "new zealand": ("new zealand",),
    "south africa": ("south africa",),
    "turkey": ("turkey", "turkiye"),
    "ukraine": ("ukraine",),
    "romania": ("romania",),
    "greece": ("greece",),
    "hungary": ("hungary",),
    "czech republic": ("czech republic", "czechia"),
    "hong kong": ("hong kong",),
    "indonesia": ("indonesia",),
    "philippines": ("philippines",),
    "vietnam": ("vietnam",),
    "thailand": ("thailand",),
    "malaysia": ("malaysia",),
    "south korea": ("south korea",),
    "united arab emirates": ("united arab emirates", "uae"),
}
# Only recognised in job locations (so "Salvador" is not mistaken for "El Salvador"); not JobSpy countries.
_OTHER_COUNTRIES: dict[str, tuple[str, ...]] = {
    "el salvador": ("el salvador", "san salvador"),
    "paraguay": ("paraguay",),
    "bolivia": ("bolivia",),
}
_CITIES: dict[str, tuple[str, ...]] = {
    "brazil": (
        "sao paulo", "rio de janeiro", "belo horizonte", "curitiba", "porto alegre", "brasilia",
        "florianopolis", "salvador", "recife", "fortaleza", "campinas", "manaus", "goiania", "belem",
        "natal", "maceio", "joao pessoa", "teresina", "campo grande", "aracaju", "macapa", "boa vista",
        "palmas", "porto velho", "rio branco", "joinville", "blumenau", "londrina", "maringa",
        "uberlandia", "sorocaba", "santos", "ribeirao preto", "sao jose dos campos", "niteroi",
        "cuiaba", "sao luis", "osasco", "barueri",
    ),
    "usa": (
        "new york", "san francisco", "seattle", "austin", "boston", "chicago", "los angeles", "miami",
        "denver", "san jose", "atlanta", "dallas", "houston",
    ),
    "canada": ("toronto", "vancouver", "montreal", "ottawa", "calgary"),
    "uk": ("london", "manchester", "edinburgh"),
    "germany": ("berlin", "munich", "munchen", "hamburg", "frankfurt", "koln", "cologne", "stuttgart", "dusseldorf"),
    "france": ("paris", "lyon", "toulouse"),
    "spain": ("madrid", "barcelona", "valencia", "las palmas"),
    "portugal": ("lisbon", "porto"),
    "netherlands": ("amsterdam", "rotterdam"),
    "ireland": ("dublin", "cork"),
    "switzerland": ("zurich", "geneva", "basel"),
    "sweden": ("stockholm", "gothenburg", "malmo"),
    "poland": ("warsaw", "krakow", "wroclaw"),
    "mexico": ("mexico city", "guadalajara", "monterrey"),
    "argentina": ("buenos aires", "cordoba"),
    "colombia": ("bogota", "medellin"),
    "chile": ("santiago",),
    "australia": ("sydney", "melbourne", "brisbane"),
    "india": ("bengaluru", "bangalore", "mumbai", "hyderabad", "pune"),
    "japan": ("tokyo", "osaka"),
}
_COUNTRY_DISPLAY = {"usa": "United States", "uk": "United Kingdom"}


def _alt(words) -> str:
    return "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))


_COUNTRY_OF = {a: k for k, al in {**_COUNTRIES, **_OTHER_COUNTRIES}.items() for a in al}
_CITY_OF = {c: k for k, cs in _CITIES.items() for c in cs}
_COUNTRY_RE = re.compile(rf"(?<!\w)(?:{_alt(_COUNTRY_OF)})(?!\w)")
_CITY_RE = re.compile(rf"(?<!\w)(?:{_alt(_CITY_OF)})(?!\w)")

_REMOTE_LABELS = {"remote", "remoto", "anywhere", "worldwide", "global"}
_HYBRID_LABELS = {"hybrid", "hibrido"}
_REMOTE_WORDS = ("remote", "remoto", "home office", "anywhere", "distributed",
                 "teletrabalho", "trabalho remoto", "wfh", "100% remoto", "fully remote")
_HYBRID_WORDS = ("híbrido", "hibrido", "hybrid", "modelo híbrido", "home office/escritório")


class ResolvedLocation(NamedTuple):
    board_location: str   # string sent to the job boards ("" = none)
    country_indeed: str   # JobSpy country name for Indeed/Glassdoor
    is_remote: bool
    hybrid: bool
    country_key: str      # country used by the post-filter ("" = any)
    plain_location: str = ""  # board_location without the appended country (Glassdoor rejects "City, Country")


def _job_countries(loc: str) -> set[str]:
    """Countries a location string points to (country names beat cities; 'City, ST' means US)."""
    folded = fold(loc)
    found = {_COUNTRY_OF[m] for m in _COUNTRY_RE.findall(folded)}
    if not found:
        found = {_CITY_OF[m] for m in _CITY_RE.findall(folded)}
    if not found and any(
        st in _US_STATES and st not in _US_STATES_AMBIGUOUS for st in _US_STATE_RE.findall(loc or "")
    ):
        found = {"usa"}
    return found


def _is_us_location(location: str) -> bool:
    """Return True when the location string looks like a US place."""
    return "usa" in _job_countries(location)


def resolve_location(label: str | None) -> ResolvedLocation:
    """Turn a UI location label ("Brasil (Remoto)", "São Paulo", "Hybrid"...) or free text into board inputs."""
    raw = (label or "").strip()
    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", raw)
    base_raw, qual = (m.group(1).strip(), fold(m.group(2))) if m else (raw, "")
    base = fold(base_raw)
    if base in _REMOTE_LABELS:
        if qual and "remot" not in qual and "todo o pais" not in qual and "country" not in qual:
            return resolve_location(m.group(2))._replace(is_remote=True)  # "Remote (Brazil)"
        return ResolvedLocation("Remote", "usa", True, False, "", "Remote")
    if base in _HYBRID_LABELS:
        return ResolvedLocation("", "usa", False, True, "")

    found = _job_countries(base_raw)
    ck = next(iter(found)) if len(found) == 1 else ""
    name = _COUNTRY_DISPLAY.get(ck, ck.title())
    if base in _COUNTRY_OF:
        board = name
    elif base in _CITY_OF:
        board = f"{base_raw}, {name}"
    else:
        board = base_raw
    plain = name if base in _COUNTRY_OF else base_raw
    return ResolvedLocation(board, ck if ck in _COUNTRIES else "usa", "remot" in qual, False, ck, plain)


def _location_matches(job_loc: str, search: ResolvedLocation | str, job_is_remote: bool | None = None) -> bool:
    """
    Post-filter: check if a scraped job location is compatible with what the user searched.
    Returns True if the job should be kept. Unknown job location -> keep.
    """
    if isinstance(search, str):
        search = resolve_location(search)
    jl = (job_loc or "").strip()
    if not jl or jl.lower() in ("nan", "none"):
        return True
    remote_job = job_is_remote if job_is_remote is not None else any(w in jl.lower() for w in _REMOTE_WORDS)
    if search.is_remote and not remote_job:
        return False
    if not search.country_key:
        return True
    found = _job_countries(jl)
    return not found or search.country_key in found


# Lightweight static PT-BR equivalents for the most common tech search terms.
# Only covers terms that Brazilian job boards index in Portuguese.
_EN_TO_PT: dict[str, str] = {
    "software engineer": "engenheiro de software",
    "software developer": "desenvolvedor de software",
    "backend": "backend",
    "frontend": "frontend",
    "full stack": "full stack",
    "data engineer": "engenheiro de dados",
    "data scientist": "cientista de dados",
    "machine learning": "aprendizado de máquina",
    "product manager": "gerente de produto",
    "devops": "devops",
    "cloud": "nuvem",
    "mobile": "mobile",
    "android": "android",
    "ios": "ios",
    "qa": "qa",
    "quality assurance": "garantia de qualidade",
    "security": "segurança",
    "designer": "designer",
    "ux": "ux",
    "analyst": "analista",
}

def _pt_keywords(keywords: list[str]) -> list[str]:
    """Return keywords enriched with PT-BR equivalents for Brazilian job boards."""
    result = list(keywords)
    for kw in keywords:
        pt = _EN_TO_PT.get(kw.lower())
        if pt and pt not in result:
            result.append(pt)
    return result


def _normalize_text(s: str) -> str:
    """Normalize a string for fuzzy comparison (accent-folded, keeps unicode word chars)."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w ]", "", fold(s))).strip()


def _dedup_jobs(jobs: list[dict]) -> list[dict]:
    """Remove near-duplicate jobs by normalized title + company."""
    seen: set[str] = set()
    unique: list[dict] = []
    for job in jobs:
        key = f"{_normalize_text(job.get('title', ''))}|{_normalize_text(job.get('company', ''))}"
        if key not in seen:
            seen.add(key)
            unique.append(job)
    return unique


def _extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}"
    except Exception:
        pass
    return ""


def _infer_work_mode(location: str, description: str, raw_is_remote) -> tuple[bool | None, bool]:
    """Remote/hybrid heuristic from the board flag + location string + description. -> (is_remote, hybrid)."""
    location_str = str(location or "").lower()
    desc_lower = str(description or "")[:500].lower()

    if raw_is_remote is True or str(raw_is_remote).lower() == "true":
        return True, False
    if any(w in location_str for w in _REMOTE_WORDS):
        return True, False
    if any(w in location_str for w in _HYBRID_WORDS):
        return None, True
    if any(w in desc_lower for w in _REMOTE_WORDS):
        return True, False
    if any(w in desc_lower for w in _HYBRID_WORDS):
        return None, True
    return (False if location_str and location_str != "nan" else None), False


def _enrich_extra(job: dict) -> None:
    """Fill is_remote/tags for extra-source jobs (JobSpy rows get them in _search_jobspy)."""
    explicit = job.get("is_remote")
    tags = list(job.get("tags") or [])
    if explicit is None and "hybrid" in tags:
        is_remote, hybrid = None, True
    elif explicit is not None:
        is_remote, hybrid = explicit, False
    else:
        is_remote, hybrid = _infer_work_mode(job.get("location", ""), job.get("description", ""), None)
    job["is_remote"] = is_remote
    job["tags"] = list(dict.fromkeys(tags + _basic_tags(job, is_remote, hybrid)))


def _work_mode_ok(job: dict, mode: str) -> bool:
    if mode == "remote":
        return job.get("is_remote") is True
    if mode == "hybrid":
        return "hybrid" in (job.get("tags") or [])
    if mode == "onsite":
        return job.get("is_remote") is False and "hybrid" not in (job.get("tags") or [])
    return True


def _within_hours(posted: str, hours_old: int | None) -> bool:
    """False only when `posted` parses and is older than hours_old. Undated jobs are kept."""
    posted = str(posted or "").strip()
    if not hours_old or not posted:
        return True
    try:
        dt = datetime.fromisoformat(posted.replace("Z", "+00:00"))
    except ValueError:
        return True
    if len(posted) <= 10:  # date only: count the whole day
        dt += timedelta(days=1)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() <= hours_old * 3600


async def search_jobs(
    keywords: list[str],
    location: str = "Remote",
    job_type: str = "fulltime",
    sites: list[str] | None = None,
    results_wanted: int = 20,
    hours_old: int | None = None,
    work_mode: str = "any",
    status_out: dict | None = None,
) -> list[dict[str, Any]]:
    """
    Search for jobs using JobSpy (one call per board) and extra scrapers,
    merge and return a deduplicated list.

    If `status_out` is given it is filled with {site: {"count": int, "error": str | None}}
    for every requested site.
    """
    if sites is None:
        sites = ["indeed", "linkedin", "glassdoor"]
    job_type = None if (job_type or "all").lower() in ("all", "") else job_type
    work_mode = (work_mode or "any").lower().replace("-", "").replace("_", "")

    cache_key = _json.dumps({"kw": sorted(keywords), "loc": location, "jt": job_type, "sites": sorted(sites),
                             "n": results_wanted, "h": hours_old, "wm": work_mode}, sort_keys=True)
    if cache_key in _search_cache:
        ts, cached, cached_status = _search_cache[cache_key]
        if time.time() - ts < _CACHE_TTL:
            logger.info("Cache hit for search: %s", cache_key[:80])
            if status_out is not None:
                status_out.update(cached_status)
            return cached

    resolved = resolve_location(location)
    remote = resolved.is_remote or work_mode == "remote"
    if remote and not resolved.is_remote:
        resolved = resolved._replace(is_remote=True)
    mode = work_mode if work_mode != "any" else ("remote" if resolved.is_remote else "hybrid" if resolved.hybrid else "any")
    board_loc = resolved.board_location

    named: list[tuple[str, Any]] = []
    for site in sites:
        if site in _JOBSPY_SITES:
            site_loc = resolved.plain_location if site == "glassdoor" else board_loc
            if site == "zip_recruiter":
                site_loc = board_loc if _is_us_location(board_loc) else _ZIPRECRUITER_US_FALLBACK
            named.append((site, _search_jobspy(
                keywords, site_loc, job_type, [site], results_wanted,
                country_indeed=resolved.country_indeed, is_remote=remote, hours_old=hours_old,
            )))
        elif site in _EXTRA_SITES:
            # BR/JumpShip sources benefit from PT-BR keywords — translate on the fly
            kws = _pt_keywords(keywords) if site in {"gupy", "programathor", "trampos", "greenhouse", "lever", "workday", "playwright"} else keywords
            named.append((site, _search_extra(site, kws, board_loc, results_wanted, remote=remote)))

    status: dict[str, dict] = {s: {"count": 0, "error": None} for s in sites}
    for s in sites:
        if s not in _JOBSPY_SITES and s not in _EXTRA_SITES:
            status[s]["error"] = "unknown site"
    results_nested = await asyncio.gather(*[c for _, c in named], return_exceptions=True)

    all_results: list[dict] = []
    seen_ids: set[str] = set()
    for (site, _), batch in zip(named, results_nested):
        if isinstance(batch, BaseException):
            logger.error("Job search batch '%s' failed: %s", site, batch)
            status[site]["error"] = f"{type(batch).__name__}: {str(batch)[:120]}"
            continue
        for job in batch:
            if job["id"] not in seen_ids:
                seen_ids.add(job["id"])
                all_results.append(job)

    all_results = _dedup_jobs(all_results)
    for j in all_results:
        if j.get("site") in _EXTRA_SITES:
            _enrich_extra(j)

    # Post-filter by location (boards don't guarantee country-level filtering).
    # Only playwright hardcodes "Brasil" as location, so it is exempt.
    before = len(all_results)
    all_results = [
        j for j in all_results
        if j.get("site") == "playwright" or _location_matches(j.get("location", ""), resolved, j.get("is_remote"))
    ]
    if before != len(all_results):
        logger.info("Location filter '%s': kept %d/%d jobs", location, len(all_results), before)

    all_results = [j for j in all_results if _work_mode_ok(j, mode)]
    # JobSpy filters hours_old itself; the other sources get it here.
    all_results = [j for j in all_results if j.get("site") not in _EXTRA_SITES or _within_hours(j.get("posted_date", ""), hours_old)]

    for j in all_results:
        if j.get("site") in status:
            status[j["site"]]["count"] += 1
    if status_out is not None:
        status_out.update(status)

    # Don't cache empty or partially failed searches — retry them next time.
    if all_results and not any(v["error"] for v in status.values()):
        _search_cache[cache_key] = (time.time(), all_results, status)
    now = time.time()
    for k in [k for k, (ts, _, _) in _search_cache.items() if now - ts > _CACHE_TTL]:
        del _search_cache[k]

    return all_results


async def _search_jobspy(
    keywords: list[str],
    location: str,
    job_type: str | None,
    sites: list[str],
    results_wanted: int,
    country_indeed: str = "usa",
    is_remote: bool = False,
    hours_old: int | None = None,
) -> list[dict]:
    # Use OR between keywords so job boards return results matching ANY keyword,
    # not requiring ALL. Most boards (LinkedIn, Indeed, Glassdoor) support this.
    # For a single keyword, no OR is needed.
    if len(keywords) == 1:
        search_term = keywords[0]
    else:
        # Wrap multi-word keywords in quotes to keep them as phrases
        parts = [f'"{kw}"' if " " in kw else kw for kw in keywords]
        search_term = " OR ".join(parts)

    logger.info("JobSpy search_term: %s", search_term)

    try:
        from jobspy import scrape_jobs
        df = await asyncio.to_thread(
            scrape_jobs,
            site_name=sites,
            search_term=search_term,
            location=location or None,
            results_wanted=results_wanted,
            job_type=job_type,
            country_indeed=country_indeed,
            is_remote=is_remote,
            hours_old=hours_old,
            fetch_description="linkedin" in sites,
            description_format="markdown",
            verbose=0,
        )
    except Exception as exc:
        logger.error("JobSpy scraping failed: %s", exc)
        raise

    results = []
    for _, row in df.iterrows():
        job_id = hashlib.md5(
            f"{row.get('title', '')}-{row.get('company', '')}-{row.get('job_url', '')}".encode()
        ).hexdigest()[:12]

        raw_company_url = row.get("company_url_direct") or row.get("company_url") or ""
        company_url = str(raw_company_url) if raw_company_url and str(raw_company_url) != "nan" else ""
        if company_url and not company_url.startswith("http"):
            base = _extract_domain(str(row.get("job_url", "")))
            company_url = base + company_url if base else ""

        description = str(row.get("description", "") or "")
        if description == "nan":
            description = ""

        is_remote_job, hybrid = _infer_work_mode(row.get("location", ""), description, row.get("is_remote"))
        tags = _basic_tags(row, is_remote_job, hybrid)

        results.append(
            {
                "id": job_id,
                "title": _cell(row.get("title")),
                "company": _cell(row.get("company")),
                "company_url": company_url,
                "location": _cell(row.get("location")),
                "job_type": _cell(row.get("job_type")),
                "salary_range": _format_salary(row),
                "posted_date": _cell(row.get("date_posted")),
                "description": description,
                "url": _cell(row.get("job_url")),
                "site": _cell(row.get("site")),
                "match_score": None,
                "is_remote": is_remote_job,
                "tags": tags,
            }
        )
    return results


def _cell(v) -> str:
    """DataFrame cell → str; JobSpy 1.3 yields None/NaN for missing fields."""
    s = "" if v is None else str(v)
    return "" if s in ("nan", "None", "NaT") else s


async def _search_extra(site: str, keywords: list[str], location: str, results_wanted: int, remote: bool = False) -> list[dict]:
    from backend.services.extra_sources import fetch_remoteok, fetch_arbeitnow
    from backend.services.br_sources import fetch_gupy, fetch_programathor, fetch_trampos
    if site == "remoteok":
        return await fetch_remoteok(keywords, results_wanted)
    elif site == "arbeitnow":
        return await fetch_arbeitnow(keywords, results_wanted)
    elif site == "gupy":
        return await fetch_gupy(keywords, location, results_wanted, remote=remote)
    elif site == "programathor":
        return await fetch_programathor(keywords, results_wanted)
    elif site == "trampos":
        return await fetch_trampos(keywords, results_wanted)
    elif site == "greenhouse":
        from backend.services.greenhouse_scraper import fetch_greenhouse
        return await fetch_greenhouse(keywords, results_wanted)
    elif site == "lever":
        from backend.services.lever_scraper import fetch_lever
        return await fetch_lever(keywords, results_wanted)
    elif site == "workday":
        from backend.services.workday_scraper import fetch_workday
        return await fetch_workday(keywords, results_wanted)
    elif site == "playwright":
        from backend.services.playwright_scraper import fetch_playwright
        return await fetch_playwright(keywords, results_wanted)
    return []


def _basic_tags(row, is_remote: bool | None, hybrid: bool = False) -> list[str]:
    """Generate lightweight tags from raw job data (no LLM needed)."""
    tags: list[str] = []

    # Work mode
    location_str = str(row.get("location", "")).lower()
    if is_remote is True:
        tags.append("remote")
    elif hybrid or any(w in location_str for w in ("híbrido", "hibrido", "hybrid")):
        tags.append("hybrid")
    elif is_remote is False and location_str not in ("nan", "", "none"):
        tags.append("on-site")

    # Seniority from title
    title = str(row.get("title", "")).lower()
    if any(w in title for w in ("senior", "sênior", "sr.", " sr ", "staff", "principal", "lead")):
        tags.append("senior")
    elif any(w in title for w in ("junior", "júnior", "jr.", " jr ", "entry")):
        tags.append("junior")
    elif any(w in title for w in ("mid", "pleno", "ii", "iii")):
        tags.append("mid-level")

    # Contract type
    job_type = str(row.get("job_type", "")).lower()
    if "contract" in job_type or "freelan" in job_type:
        tags.append("contract")
    elif "parttime" in job_type or "part-time" in job_type or "part time" in job_type:
        tags.append("part-time")

    return tags


def _format_salary(row) -> str:
    min_sal = row.get("min_amount")
    max_sal = row.get("max_amount")
    currency = row.get("currency", "USD")
    try:
        if min_sal and max_sal and str(min_sal) != "nan" and str(max_sal) != "nan":
            return f"{currency} {float(min_sal):,.0f} – {float(max_sal):,.0f}"
        elif min_sal and str(min_sal) != "nan":
            return f"{currency} {float(min_sal):,.0f}+"
        elif max_sal and str(max_sal) != "nan":
            return f"Up to {currency} {float(max_sal):,.0f}"
    except (TypeError, ValueError):
        pass
    return ""
