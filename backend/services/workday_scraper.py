"""
JumpShip — Workday public job board scraper.

Uses Workday's undocumented public CXS REST endpoint (no auth, no browser).
POST https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from urllib.parse import urlparse

import httpx

from backend.services.career_sources import get_by_ats

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
}
_SEMAPHORE_LIMIT = 4
_TIMEOUT = 20
_MAX_TERMS = 3


def _parse_workday_url(careers_url: str) -> tuple[str, str, str] | None:
    """Extract (hostname, tenant, site) from a Workday careers URL."""
    p = urlparse(careers_url)
    if not p.hostname or "myworkdayjobs" not in p.hostname:
        return None
    hostname = p.hostname  # santander.wd3.myworkdayjobs.com
    tenant = hostname.split(".")[0]
    path_parts = [x for x in p.path.split("/") if x]
    # path is /[locale/]SiteName — site is always the last segment
    site = path_parts[-1] if path_parts else None
    if not site:
        return None
    return hostname, tenant, site


async def _fetch_board(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    source: dict,
    keywords: list[str],
    results_wanted: int,
) -> list[dict]:
    api_config = source.get("api") or {}
    careers_url = api_config.get("careers_url", "")
    parsed = _parse_workday_url(careers_url)
    if not parsed:
        logger.warning("Workday: could not parse URL for %s", source.get("id"))
        return []

    hostname, tenant, site = parsed
    api_url = f"https://{hostname}/wday/cxs/{tenant}/{site}/jobs"
    # One request per keyword (Workday ANDs the words of a single searchText); merge by externalPath.
    terms = [k.strip() for k in (keywords or [])[:_MAX_TERMS] if k and k.strip()] or [""]
    payloads: list[dict] = []

    async with sem:
        for term in terms:
            try:
                r = await client.post(
                    api_url,
                    json={
                        "appliedFacets": {},
                        "limit": min(results_wanted, 20),
                        "offset": 0,
                        "searchText": term,
                    },
                    headers=_HEADERS,
                )
                if r.status_code in (404, 403):
                    logger.warning("Workday board unreachable (%s): HTTP %s", site, r.status_code)
                    break
                r.raise_for_status()
                payloads.append(r.json())
            except Exception as exc:
                logger.warning("Workday fetch failed (%s, '%s'): %s", site, term, exc)

    return parse_workday(payloads, keywords, hostname, tenant, source.get("name", tenant))


def parse_workday(
    payload: dict | list[dict], keywords: list[str] | None, hostname: str, tenant: str, company: str,
) -> list[dict]:
    """Normalize Workday CXS /jobs JSON ({"jobPostings": [...]}; one or several responses) into job dicts.

    No local keyword filter: the server already matched `searchText`.
    """
    postings: dict[str, dict] = {}
    for data in [payload] if isinstance(payload, dict) else payload:
        for posting in data.get("jobPostings", []):
            if isinstance(posting, dict):
                key = posting.get("externalPath") or posting.get("title") or ""
                postings.setdefault(key, posting)

    results: list[dict] = []

    for posting in postings.values():
        ext_path = posting.get("externalPath") or ""
        url = f"https://{hostname}{ext_path}" if ext_path else ""
        title = posting.get("title") or ""

        uid = hashlib.md5((ext_path or title).encode()).hexdigest()[:8]
        results.append(
            {
                "id": f"wd_{tenant[:6]}_{uid}",
                "title": title,
                "company": company,
                "company_url": "",
                "location": posting.get("locationsText") or "Brasil",
                "job_type": "fulltime",
                "salary_range": "",
                "posted_date": "",
                "description": "",
                "url": url,
                "site": "workday",
                "match_score": None,
            }
        )

    return results


async def fetch_workday(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """Fetch jobs from all Workday boards in the source registry."""
    sources = get_by_ats("workday")
    if not sources:
        return []

    sem = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        batches = await asyncio.gather(
            *[_fetch_board(client, sem, src, keywords, results_wanted) for src in sources],
            return_exceptions=True,
        )

    results: list[dict] = []
    for batch in batches:
        if isinstance(batch, Exception):
            logger.error("Workday board batch error: %s", batch)
            continue
        results.extend(batch)

    logger.info("Workday: fetched %d jobs across %d boards", len(results), len(sources))
    return results[:results_wanted]
