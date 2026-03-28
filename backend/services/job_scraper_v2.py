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
_JOBSPY_SITES = {"linkedin", "indeed", "glassdoor", "zip_recruiter", "bayt"}
# Sites handled by our extra scrapers
_EXTRA_SITES = {"remoteok", "arbeitnow", "gupy", "programathor", "trampos"}


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

    tasks = []
    if jobspy_sites:
        tasks.append(_search_jobspy(keywords, location, job_type, jobspy_sites, results_wanted))
    for site in extra_sites:
        tasks.append(_search_extra(site, keywords, location, results_wanted))

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
