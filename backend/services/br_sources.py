"""
JumpShip — Brazilian job board scrapers (no API key required).

Sources:
  - Gupy         — https://portal.api.gupy.io (public job search; `name` query param)
  - Programathor — HTML listing at /jobs (legacy /jobs-json no longer returns JSON for API clients)
  - Trampos      — https://www.trampos.co/api/oportunidades (paginated JSON)
"""
from __future__ import annotations

import hashlib
import logging
import re

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_JSON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}

_HTML_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

_GUPY_NAME_MAX = 200


def _gupy_city_param(location: str) -> str:
    """Gupy is Brazil-focused; avoid sending non-BR place strings as `city`."""
    loc = (location or "").strip()
    if not loc:
        return ""
    low = loc.lower()
    if any(x in low for x in ("remote", "remoto", "worldwide", "mundial", "hybrid", "híbrido", "hibrido")):
        return ""
    if re.search(
        r"\b(united states|usa\b|\buk\b|canada|germany|france|spain|india|japan|australia|"
        r"mexico|ireland|netherlands|poland|sweden|norway|austria|switzerland|italy|singapore)\b",
        loc,
        re.I,
    ):
        return ""
    if "—" in loc and "brasil" in low and "remoto" not in low:
        return ""
    return loc[:100]


# ── Gupy ──────────────────────────────────────────────────────────────────────


async def fetch_gupy(
    keywords: list[str],
    location: str = "",
    results_wanted: int = 20,
) -> list[dict]:
    """
    Fetch jobs from Gupy's public API.
    Requires query param `name` (not legacy `jobName`).
    """
    results: list[dict] = []
    search_term = " ".join(keywords[:6]).strip() or "desenvolvedor"
    search_term = search_term[:_GUPY_NAME_MAX]

    city = _gupy_city_param(location)

    base_params: dict = {
        "name": search_term,
        "limit": min(max(results_wanted, 1), 50),
        "offset": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
            params = dict(base_params)
            if city:
                params["city"] = city
            r = await client.get(
                "https://portal.api.gupy.io/api/job",
                params=params,
                headers=_JSON_HEADERS,
            )
            r.raise_for_status()
            data = r.json()
            # Gupy often returns [] when `city` does not match their internal spelling.
            if city and not (data.get("data") if isinstance(data, dict) else None):
                r2 = await client.get(
                    "https://portal.api.gupy.io/api/job",
                    params=base_params,
                    headers=_JSON_HEADERS,
                )
                r2.raise_for_status()
                data = r2.json()
    except Exception as exc:
        logger.warning("Gupy fetch failed: %s", exc)
        return results

    kw_lower = [k.lower() for k in keywords] if keywords else []

    for job in data.get("data", []):
        if not isinstance(job, dict):
            continue
        title = (job.get("name") or "").lower()
        desc = (job.get("description") or "").lower()
        text = f"{title} {desc}"
        if kw_lower and not any(kw in text for kw in kw_lower):
            continue

        company = job.get("careerPageName") or ""
        company_url = job.get("careerPageUrl") or ""
        logo_url = job.get("careerPageLogo") or ""

        if job.get("isRemoteWork"):
            country = (job.get("country") or "").strip()
            loc = f"Remoto ({country})" if country else "Remoto, Brasil"
        else:
            city_name = job.get("city") or ""
            state = job.get("state") or ""
            loc = f"{city_name}, {state}".strip(", ") if city_name or state else "Brasil"

        job_type_raw = (job.get("type") or "").lower()
        job_type_map = {
            "full_time": "fulltime",
            "part_time": "parttime",
            "internship": "internship",
            "temporary": "contract",
            "freelancer": "contract",
            "apprenticeship": "parttime",
        }
        job_type = job_type_map.get(job_type_raw, "fulltime")

        uid = hashlib.md5(str(job.get("id", "") or "").encode()).hexdigest()[:8]

        results.append(
            {
                "id": f"gupy_{uid}",
                "title": job.get("name") or "",
                "company": company,
                "company_url": company_url or logo_url,
                "location": loc,
                "job_type": job_type,
                "salary_range": "",
                "posted_date": (job.get("publishedDate") or "")[:10],
                "description": job.get("description") or "",
                "url": job.get("jobUrl") or "",
                "site": "gupy",
                "match_score": None,
            }
        )

        if len(results) >= results_wanted:
            break

    logger.info("Gupy: fetched %d jobs for '%s'", len(results), search_term)
    return results


# ── Programathor ──────────────────────────────────────────────────────────────


def _parse_programathor_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    seen: set[str] = set()
    out: list[dict] = []

    for a in soup.select('a[href^="/jobs/"]'):
        href = (a.get("href") or "").strip()
        m = re.match(r"/jobs/(\d+)-", href)
        if not m or href in seen:
            continue
        seen.add(href)

        h3 = a.select_one("h3")
        title = h3.get_text(" ", strip=True) if h3 else ""
        title = re.sub(r"\s*NOVA\s*$", "", title, flags=re.I).strip()

        company = ""
        location = ""
        skills: list[str] = []
        for span in a.select(".cell-list-content-icon span, .cell-list-content span"):
            raw = span.get_text(" ", strip=True)
            ic = str(span.select_one("i") or "")
            if "briefcase" in ic and not company:
                company = raw
            elif "map-marker" in ic and not location:
                location = raw
        for tag in a.select(".tag-list"):
            t = tag.get_text(strip=True)
            if t:
                skills.append(t)

        url = f"https://programathor.com.br{href}"
        desc_bits = " ".join(skills)
        out.append(
            {
                "title": title,
                "company": company,
                "location": location or "Brasil",
                "description": desc_bits,
                "url": url,
                "href": href,
            }
        )
    return out


async def fetch_programathor(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """Scrape Programathor /jobs listings (paginated)."""
    results: list[dict] = []
    kw_lower = [k.lower() for k in keywords] if keywords else []
    max_pages = min(15, max(3, results_wanted // 8 + 3))
    collected: list[dict] = []

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for page in range(1, max_pages + 1):
                url = "https://programathor.com.br/jobs"
                params = {"page": page} if page > 1 else {}
                r = await client.get(url, params=params, headers=_HTML_HEADERS)
                r.raise_for_status()
                batch = _parse_programathor_page(r.text)
                if not batch:
                    break
                collected.extend(batch)
                if len(batch) < 5:
                    break
    except Exception as exc:
        logger.warning("Programathor fetch failed: %s", exc)
        return results

    for job in collected:
        title = (job.get("title") or "").lower()
        desc = (job.get("description") or "").lower()
        company = (job.get("company") or "").lower()
        text = f"{title} {desc} {company}"
        if kw_lower and not any(kw in text for kw in kw_lower):
            continue

        uid = hashlib.md5((job.get("href") or job.get("url") or title).encode()).hexdigest()[:8]

        results.append(
            {
                "id": f"pt_{uid}",
                "title": job.get("title") or "",
                "company": job.get("company") or "",
                "company_url": "",
                "location": job.get("location") or "Brasil",
                "job_type": "fulltime",
                "salary_range": "",
                "posted_date": "",
                "description": job.get("description") or "",
                "url": job.get("url") or "",
                "site": "programathor",
                "match_score": None,
            }
        )

        if len(results) >= results_wanted:
            break

    logger.info("Programathor: fetched %d jobs (from %d listings)", len(results), len(collected))
    return results


# ── Trampos ───────────────────────────────────────────────────────────────────

_TRAMPOS_API = "https://www.trampos.co/api/oportunidades"


async def fetch_trampos(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """
    Fetch jobs from Trampos paginated API (trampos.co/oportunidades.json returns 500 as of 2026).
    """
    results: list[dict] = []
    kw_lower = [k.lower() for k in keywords] if keywords else []
    raw_rows: list[dict] = []

    try:
        async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
            page = 1
            empty_streak = 0
            while len(raw_rows) < max(results_wanted * 8, 80) and page <= 40:
                r = await client.get(_TRAMPOS_API, params={"page": page}, headers=_JSON_HEADERS)
                r.raise_for_status()
                batch = r.json()
                if not isinstance(batch, list) or not batch:
                    empty_streak += 1
                    if empty_streak >= 2:
                        break
                    page += 1
                    continue
                empty_streak = 0
                for item in batch:
                    if isinstance(item, dict) and "opportunity" in item:
                        raw_rows.append(item["opportunity"])
                    elif isinstance(item, dict):
                        raw_rows.append(item)
                page += 1
    except Exception as exc:
        logger.warning("Trampos fetch failed: %s", exc)
        return results

    for job in raw_rows:
        if not isinstance(job, dict):
            continue
        title = (job.get("name") or "").lower()
        company = (job.get("company_name") or "").lower()
        text = f"{title} {company}"
        if kw_lower and not any(kw in text for kw in kw_lower):
            continue

        jid = job.get("id") or job.get("name") or ""
        uid = hashlib.md5(str(jid).encode()).hexdigest()[:8]
        permalink = job.get("permalink") or ""
        if not permalink and jid:
            slug = re.sub(r"\s+", "-", (job.get("name") or "vaga").lower())
            permalink = f"https://www.trampos.co/oportunidades/{jid}-{slug}"

        pub = (job.get("published_at") or "")[:10]

        results.append(
            {
                "id": f"trampos_{uid}",
                "title": job.get("name") or "",
                "company": job.get("company_name") or "",
                "company_url": "",
                "location": "Brasil",
                "job_type": "fulltime",
                "salary_range": "",
                "posted_date": pub,
                "description": "",
                "url": permalink,
                "site": "trampos",
                "match_score": None,
            }
        )

        if len(results) >= results_wanted:
            break

    logger.info("Trampos: fetched %d jobs (scanned %d rows)", len(results), len(raw_rows))
    return results
