"""
JumpShip — Job scraper combining JobSpy + extra free sources.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
import json as _json
from typing import Any

logger = logging.getLogger(__name__)

# Simple in-memory cache with TTL
_search_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 900  # 15 minutes

# Sites handled by JobSpy
_JOBSPY_SITES = {"linkedin", "indeed", "glassdoor", "zip_recruiter", "bayt", "google"}
# Sites handled by our extra scrapers
_EXTRA_SITES = {"remoteok", "arbeitnow", "gupy", "programathor", "trampos"}

# ZipRecruiter only returns results for US locations.
# When the user searches "Remote" or a non-US location, we swap in a broad US fallback.
_ZIPRECRUITER_US_FALLBACK = "United States"

# Glassdoor is heavily protected; we silently add "google" as a parallel source
# whenever glassdoor is selected so we always get some results.
_GLASSDOOR_FALLBACK_SITE = "google"


_US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}

def _is_us_location(location: str) -> bool:
    """Return True when the location string looks like a US place."""
    loc = location.upper()
    if "UNITED STATES" in loc or "USA" in loc:
        return True
    # "City, ST" pattern
    parts = loc.split(",")
    if len(parts) == 2 and parts[1].strip() in _US_STATES:
        return True
    return False


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
    """Normalize a string for fuzzy comparison."""
    import re
    s = s.lower().strip()
    s = re.sub(r'[^a-z0-9 ]', '', s)
    s = re.sub(r'\s+', ' ', s)
    return s


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


_BR_LOCATION_TERMS = {
    "brasil", "brazil", "são paulo", "sao paulo", "rio de janeiro", "belo horizonte",
    "curitiba", "porto alegre", "brasília", "brasilia", "fortaleza", "manaus",
    "recife", "salvador", "campinas", "florianópolis", "florianopolis",
    "goiânia", "goiania", "belém", "belem", "natal", "maceió", "maceio",
    "joão pessoa", "joao pessoa", "teresina", "campo grande", "aracaju",
    "macapá", "macapa", "boa vista", "palmas", "porto velho", "rio branco",
    # abbreviation used in job boards
    " br", ", br",
}

_BR_COUNTRY_EXCLUSIONS = {
    "mexico", "méxico", "argentina", "colombia", "chile", "peru", "venezuela",
    "spain", "españa", "portugal", "united states", "usa", "canada", "uk",
    "germany", "france", "italy", "netherlands", "india", "china", "australia",
}

def _is_brazil_location(loc: str) -> bool:
    """True if the location string matches a Brazilian city/country."""
    l = loc.lower()
    for term in _BR_LOCATION_TERMS:
        if term in l:
            return True
    return False

def _is_excluded_location(loc: str, target: str) -> bool:
    """True if the job location clearly belongs to a country different from target."""
    if not loc or loc.lower() in ("nan", "", "none", "remote", "remoto", "anywhere"):
        return False  # remote jobs — keep
    l = loc.lower()
    for term in _BR_COUNTRY_EXCLUSIONS:
        if term in l:
            return True
    return False

def _location_matches(job_loc: str, search_loc: str) -> bool:
    """
    Post-filter: check if a scraped job location is compatible with what the user searched.
    Returns True if the job should be kept.
    """
    if not search_loc:
        return True
    sl = search_loc.lower().strip()
    jl = job_loc.lower().strip() if job_loc else ""

    # Remote searches — keep all remote/hybrid jobs anywhere
    if sl in ("remote", "remoto", "anywhere", "worldwide"):
        return jl == "" or any(w in jl for w in ("remote", "remoto", "anywhere", "home office", "teletrabalho"))

    # Brazil search — keep BR locations + remote jobs, exclude clear non-BR countries
    br_search = any(t in sl for t in ("brasil", "brazil", "br"))
    if br_search:
        if not jl or jl in ("nan", "", "none"):
            return True  # unknown location — keep
        if any(w in jl for w in ("remote", "remoto", "anywhere", "home office", "worldwide", "teletrabalho")):
            return True  # remote jobs are fine for any country search
        if _is_brazil_location(jl):
            return True
        if _is_excluded_location(jl, sl):
            return False
        return True  # uncertain — keep rather than miss

    return True  # no strict filtering for other locations


def _extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}"
    except Exception:
        pass
    return ""


async def search_jobs(
    keywords: list[str],
    location: str = "Remote",
    job_type: str = "fulltime",
    sites: list[str] | None = None,
    results_wanted: int = 20,
) -> list[dict[str, Any]]:
    """
    Search for jobs using JobSpy (for major boards) and extra scrapers,
    merge and return a deduplicated list.
    """
    # Check cache
    cache_key = _json.dumps({"kw": sorted(keywords), "loc": location, "jt": job_type, "sites": sorted(sites or []), "n": results_wanted}, sort_keys=True)
    if cache_key in _search_cache:
        ts, cached = _search_cache[cache_key]
        if time.time() - ts < _CACHE_TTL:
            logger.info("Cache hit for search: %s", cache_key[:80])
            return cached

    if sites is None:
        sites = ["indeed", "linkedin", "glassdoor"]

    jobspy_sites = [s for s in sites if s in _JOBSPY_SITES]
    extra_sites = [s for s in sites if s in _EXTRA_SITES]

    # When Glassdoor is selected, also run Google Jobs in parallel as a fallback —
    # Glassdoor's anti-bot measures frequently block results entirely.
    if "glassdoor" in jobspy_sites and _GLASSDOOR_FALLBACK_SITE not in jobspy_sites:
        jobspy_sites = list(jobspy_sites) + [_GLASSDOOR_FALLBACK_SITE]

    tasks = []
    if jobspy_sites:
        # ZipRecruiter needs a US location — run it separately with the fallback if needed.
        if "zip_recruiter" in jobspy_sites:
            other_sites = [s for s in jobspy_sites if s != "zip_recruiter"]
            if other_sites:
                tasks.append(_search_jobspy(keywords, location, job_type, other_sites, results_wanted))
            zr_location = location if _is_us_location(location) else _ZIPRECRUITER_US_FALLBACK
            tasks.append(_search_jobspy(keywords, zr_location, job_type, ["zip_recruiter"], results_wanted))
        else:
            tasks.append(_search_jobspy(keywords, location, job_type, jobspy_sites, results_wanted))

    # BR sources work better with PT-BR keywords — translate on the fly if needed
    br_sites = [s for s in extra_sites if s in {"gupy", "programathor", "trampos"}]
    other_extra = [s for s in extra_sites if s not in {"gupy", "programathor", "trampos"}]
    br_keywords = _pt_keywords(keywords)
    for site in other_extra:
        tasks.append(_search_extra(site, keywords, location, results_wanted))
    for site in br_sites:
        tasks.append(_search_extra(site, br_keywords, location, results_wanted))

    results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    all_results: list[dict] = []
    seen_ids: set[str] = set()
    for batch in results_nested:
        if isinstance(batch, Exception):
            logger.error("Job search batch failed: %s", batch)
            continue
        for job in batch:
            if job["id"] not in seen_ids:
                seen_ids.add(job["id"])
                all_results.append(job)

    all_results = _dedup_jobs(all_results)

    # Post-filter by location (JobSpy doesn't guarantee country-level filtering)
    before = len(all_results)
    all_results = [j for j in all_results if _location_matches(j.get("location", ""), location)]
    if before != len(all_results):
        logger.info("Location filter '%s': kept %d/%d jobs", location, len(all_results), before)

    # Store in cache
    _search_cache[cache_key] = (time.time(), all_results)
    # Evict old entries
    now = time.time()
    expired = [k for k, (ts, _) in _search_cache.items() if now - ts > _CACHE_TTL]
    for k in expired:
        del _search_cache[k]

    return all_results


async def _search_jobspy(
    keywords: list[str],
    location: str,
    job_type: str,
    sites: list[str],
    results_wanted: int,
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
        df = scrape_jobs(
            site_name=sites,
            search_term=search_term,
            location=location,
            results_wanted=results_wanted,
            job_type=job_type,
            linkedin_fetch_description=True,
            description_format="markdown",
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

        # Derive is_remote from jobspy field + location string + description keywords
        raw_is_remote = row.get("is_remote")
        location_str = str(row.get("location", "")).lower()
        desc_lower = description[:500].lower()

        _remote_words = ("remote", "remoto", "home office", "anywhere", "distributed",
                         "teletrabalho", "trabalho remoto", "wfh", "100% remoto", "fully remote")
        _hybrid_words = ("híbrido", "hibrido", "hybrid", "modelo híbrido", "home office/escritório")

        if raw_is_remote is True or str(raw_is_remote).lower() == "true":
            is_remote = True
        elif any(w in location_str for w in _remote_words):
            is_remote = True
        elif any(w in location_str for w in _hybrid_words):
            is_remote = None  # hybrid
        elif any(w in desc_lower for w in _remote_words):
            is_remote = True
        elif any(w in desc_lower for w in _hybrid_words):
            is_remote = None
        else:
            is_remote = False if location_str and location_str not in ("nan", "") else None

        tags = _basic_tags(row, is_remote)

        results.append(
            {
                "id": job_id,
                "title": str(row.get("title", "")),
                "company": str(row.get("company", "")),
                "company_url": company_url,
                "location": str(row.get("location", "")),
                "job_type": str(row.get("job_type", "")),
                "salary_range": _format_salary(row),
                "posted_date": str(row.get("date_posted", "")),
                "description": description,
                "url": str(row.get("job_url", "")),
                "site": str(row.get("site", "")),
                "match_score": None,
                "is_remote": is_remote,
                "tags": tags,
            }
        )
    return results


async def _search_extra(site: str, keywords: list[str], location: str, results_wanted: int) -> list[dict]:
    from backend.services.extra_sources import fetch_remoteok, fetch_arbeitnow
    from backend.services.br_sources import fetch_gupy, fetch_programathor, fetch_trampos
    if site == "remoteok":
        return await fetch_remoteok(keywords, results_wanted)
    elif site == "arbeitnow":
        return await fetch_arbeitnow(keywords, results_wanted)
    elif site == "gupy":
        return await fetch_gupy(keywords, location, results_wanted)
    elif site == "programathor":
        return await fetch_programathor(keywords, results_wanted)
    elif site == "trampos":
        return await fetch_trampos(keywords, results_wanted)
    return []


def _basic_tags(row, is_remote: bool | None) -> list[str]:
    """Generate lightweight tags from raw job data (no LLM needed)."""
    tags: list[str] = []

    # Work mode
    location_str = str(row.get("location", "")).lower()
    if is_remote is True:
        tags.append("remote")
    elif any(w in location_str for w in ("híbrido", "hibrido", "hybrid")):
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
