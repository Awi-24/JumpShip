"""
JumpShip — Greenhouse public board scraper.

Fetches all Greenhouse boards defined in brazil-career-sources.json concurrently.
No API key required — uses the public Job Board API.
"""
from __future__ import annotations

import asyncio
import hashlib
import html as _html
import logging
import re
from typing import Any

import httpx

from backend.services.career_sources import get_by_ats

logger = logging.getLogger(__name__)

_BASE_URL = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs"

# Sites whose career pages embed Greenhouse but are listed as "custom" in the sources JSON.
# Format: {source_id: {"board_token": str, "company": str}}
_SUPPLEMENTAL_BOARDS: dict[str, dict] = {
    "anthropic_jobs": {"board_token": "anthropic", "company": "Anthropic"},
    "inter_carreiras": {"board_token": "inter", "company": "Banco Inter"},
}
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}
_SEMAPHORE_LIMIT = 5
_TIMEOUT = 18


def _strip_html(text: str) -> str:
    unescaped = _html.unescape(text or "")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescaped)).strip()


def _map_job(job: dict[str, Any], company: str, token: str) -> dict[str, Any]:
    uid = hashlib.md5(str(job.get("id", "")).encode()).hexdigest()[:8]
    raw_desc = job.get("content") or ""
    location_obj = job.get("location") or {}
    return {
        "id": f"gh_{token[:6]}_{uid}",
        "title": job.get("title") or "",
        "company": company,
        "company_url": "",
        "location": location_obj.get("name") or "Brasil",
        "job_type": "fulltime",
        "salary_range": "",
        "posted_date": (job.get("updated_at") or "")[:10],
        "description": _strip_html(raw_desc),
        "url": job.get("absolute_url") or "",
        "site": "greenhouse",
        "match_score": None,
    }


async def _fetch_board(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    source: dict,
    keywords: list[str],
) -> list[dict]:
    token: str = source["api"]["board_token"]
    company: str = source.get("name", token)
    url = _BASE_URL.format(token=token)

    async with sem:
        try:
            r = await client.get(url, params={"content": "true"}, headers=_HEADERS)
            if r.status_code == 404:
                logger.warning("Greenhouse board not found: %s", token)
                return []
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            logger.warning("Greenhouse fetch failed (%s): %s", token, exc)
            return []

    kw_lower = [k.lower() for k in keywords] if keywords else []
    results: list[dict] = []

    for job in data.get("jobs", []):
        if not isinstance(job, dict):
            continue
        if kw_lower:
            title = (job.get("title") or "").lower()
            desc = _strip_html(job.get("content") or "").lower()
            if not any(kw in title or kw in desc for kw in kw_lower):
                continue
        results.append(_map_job(job, company, token))

    return results


async def fetch_greenhouse(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """Fetch jobs from all Greenhouse boards in the source registry plus supplemental boards."""
    sources = get_by_ats("greenhouse")
    # Merge supplemental boards as synthetic source dicts
    all_sources = list(sources)
    for sid, info in _SUPPLEMENTAL_BOARDS.items():
        all_sources.append({
            "id": sid,
            "name": info["company"],
            "api": {"board_token": info["board_token"]},
        })
    sources = all_sources
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
            logger.error("Greenhouse board batch error: %s", batch)
            continue
        results.extend(batch)

    logger.info(
        "Greenhouse: %d jobs across %d boards (capped at %d)",
        len(results), len(sources), results_wanted,
    )
    return results[:results_wanted]
