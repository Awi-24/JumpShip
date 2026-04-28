"""
JumpShip — Lever public postings scraper.

Fetches all Lever boards defined in brazil-career-sources.json concurrently.
No API key required — uses the public Lever Postings API v0.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.services.career_sources import get_by_ats

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.lever.co/v0/postings/{site}?mode=json"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}
_SEMAPHORE_LIMIT = 5
_TIMEOUT = 18


def _ts_to_date(ts_ms: int | None) -> str:
    if not ts_ms:
        return ""
    try:
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date().isoformat()
    except (OSError, ValueError):
        return ""


def _map_posting(posting: dict[str, Any], company: str, site: str) -> dict[str, Any]:
    uid = hashlib.md5((posting.get("id") or posting.get("text") or "").encode()).hexdigest()[:8]
    cats = posting.get("categories") or {}
    desc_plain = posting.get("descriptionPlain") or ""
    return {
        "id": f"lv_{site[:6]}_{uid}",
        "title": posting.get("text") or "",
        "company": company,
        "company_url": "",
        "location": cats.get("location") or "Brasil",
        "job_type": "fulltime",
        "salary_range": "",
        "posted_date": _ts_to_date(posting.get("createdAt")),
        "description": desc_plain,
        "url": posting.get("hostedUrl") or "",
        "site": "lever",
        "match_score": None,
    }


async def _fetch_board(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    source: dict,
    keywords: list[str],
) -> list[dict]:
    site: str = source["api"]["site"]
    company: str = source.get("name", site)
    url = _BASE_URL.format(site=site)

    async with sem:
        try:
            r = await client.get(url, headers=_HEADERS)
            if r.status_code == 404:
                logger.warning("Lever board not found: %s", site)
                return []
            r.raise_for_status()
            postings = r.json()
        except Exception as exc:
            logger.warning("Lever fetch failed (%s): %s", site, exc)
            return []

    if not isinstance(postings, list):
        logger.warning("Lever unexpected response shape for %s", site)
        return []

    kw_lower = [k.lower() for k in keywords] if keywords else []
    results: list[dict] = []

    for posting in postings:
        if not isinstance(posting, dict):
            continue
        if kw_lower:
            title = (posting.get("text") or "").lower()
            desc = (posting.get("descriptionPlain") or "").lower()
            if not any(kw in title or kw in desc for kw in kw_lower):
                continue
        results.append(_map_posting(posting, company, site))

    return results


async def fetch_lever(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """Fetch jobs from all Lever boards in the source registry."""
    sources = get_by_ats("lever")
    if not sources:
        return []

    sem = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        batches = await asyncio.gather(
            *[_fetch_board(client, sem, src, keywords) for src in sources],
            return_exceptions=True,
        )

    results: list[dict] = []
    for batch in batches:
        if isinstance(batch, Exception):
            logger.error("Lever board batch error: %s", batch)
            continue
        results.extend(batch)

    logger.info("Lever: %d jobs across %d boards (capped at %d)", len(results), len(sources), results_wanted)
    return results[:results_wanted]
