"""
JumpShip — Additional free job board sources beyond JobSpy.
  - RemoteOK  (https://remoteok.com/api)
  - Arbeitnow (https://www.arbeitnow.com/api/job-board-api)
No API keys required.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

import httpx

from backend.services.text_match import matches_any

logger = logging.getLogger(__name__)


def _iso_date_prefix(val) -> str:
    """Arbeitnow uses unix seconds for created_at; older payloads may use ISO strings."""
    if val is None:
        return ""
    if isinstance(val, (int, float)):
        try:
            return datetime.fromtimestamp(int(val), tz=timezone.utc).strftime("%Y-%m-%d")
        except (OSError, ValueError, OverflowError):
            return ""
    s = str(val)
    return s[:10] if s else ""

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 JumpShip/1.0"
    ),
    "Accept": "application/json, text/plain, */*",
}


async def fetch_remoteok(keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Fetch remote-only jobs from RemoteOK's public API."""
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            r = await client.get("https://remoteok.com/api", headers=_HEADERS, follow_redirects=True)
            r.raise_for_status()
            jobs = r.json()
    except Exception as exc:
        logger.warning("RemoteOK fetch failed: %s", exc)
        raise
    return parse_remoteok(jobs, keywords, results_wanted)


def parse_remoteok(jobs: list, keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Normalize RemoteOK's decoded /api JSON (list; element 0 is a legal notice) into job dicts."""
    results: list[dict] = []
    for job in jobs:
        if not isinstance(job, dict) or not job.get("id"):
            continue

        tags = " ".join(job.get("tags") or [])
        if not matches_any(keywords, job.get("position") or "", tags, job.get("description") or ""):
            continue

        sal_min = job.get("salary_min") or 0
        sal_max = job.get("salary_max") or 0
        if sal_min and sal_max:
            salary = f"USD {int(sal_min):,} – {int(sal_max):,}"
        elif sal_min:
            salary = f"USD {int(sal_min):,}+"
        else:
            salary = ""

        results.append(
            {
                "id": f"rok_{job['id']}",
                "title": job.get("position") or "",
                "company": job.get("company") or "",
                "company_url": job.get("company_logo") or "",
                "location": "Remote",
                "job_type": "fulltime",
                "salary_range": salary,
                "posted_date": (job.get("date") or "")[:10],
                "description": (job.get("description") or ""),
                "url": job.get("url") or f"https://remoteok.com/l/{job.get('slug', '')}",
                "site": "remoteok",
                "match_score": None,
            }
        )

        if len(results) >= results_wanted:
            break

    logger.info("RemoteOK: parsed %d jobs matching %s", len(results), keywords)
    return results


async def fetch_arbeitnow(keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Fetch jobs from Arbeitnow's public API (EU-focused, remote-friendly)."""
    search_term = (" ".join(keywords[:4])).strip()

    try:
        async with httpx.AsyncClient(timeout=22, follow_redirects=True) as client:
            params: dict = {"page": 1}
            if search_term:
                params["search"] = search_term
            r = await client.get(
                "https://www.arbeitnow.com/api/job-board-api",
                params=params,
                headers=_HEADERS,
            )
            r.raise_for_status()
            data = r.json()
            rows = data.get("data") or []
            # If search returns nothing, fall back to unfiltered feed (still keyword-filtered below).
            if search_term and len(rows) == 0:
                r2 = await client.get(
                    "https://www.arbeitnow.com/api/job-board-api",
                    params={"page": 1},
                    headers=_HEADERS,
                )
                r2.raise_for_status()
                data = r2.json()
    except Exception as exc:
        logger.warning("Arbeitnow fetch failed: %s", exc)
        raise
    return parse_arbeitnow(data, keywords, results_wanted)


def parse_arbeitnow(data: dict, keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Normalize Arbeitnow's decoded job-board-api JSON ({"data": [...]}) into job dicts."""
    results: list[dict] = []
    for job in data.get("data", []):
        tags = " ".join(job.get("tags") or [])
        if not matches_any(keywords, job.get("title") or "", tags, job.get("description") or ""):
            continue

        sal_from = job.get("salary_from") or 0
        sal_to = job.get("salary_to") or 0
        if sal_from and sal_to:
            salary = f"EUR {int(sal_from):,} – {int(sal_to):,}"
        elif sal_from:
            salary = f"EUR {int(sal_from):,}+"
        else:
            salary = ""

        slug = str(job.get("slug") or "")
        uid = hashlib.md5(slug.encode()).hexdigest()[:8]

        results.append(
            {
                "id": f"an_{uid}",
                "title": job.get("title") or "",
                "company": job.get("company_name") or "",
                "company_url": "",
                "location": job.get("location") or ("Remote" if job.get("remote") else ""),
                "job_type": "fulltime",
                "salary_range": salary,
                "posted_date": _iso_date_prefix(job.get("created_at")),
                "description": job.get("description") or "",
                "url": job.get("url") or "",
                "site": "arbeitnow",
                "match_score": None,
            }
        )

        if len(results) >= results_wanted:
            break

    logger.info("Arbeitnow: parsed %d jobs matching %s", len(results), keywords)
    return results
