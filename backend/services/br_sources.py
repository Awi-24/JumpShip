"""
JumpShip — Brazilian job board scrapers (no API key required).

Sources:
  - Gupy         — https://portal.gupy.io/job-search/term=<term> (__NEXT_DATA__ JSON; the old
                   portal.api.gupy.io/api/job endpoint returns 404 for every query)
  - Programathor — HTML listing at /jobs (legacy /jobs-json no longer returns JSON for API clients)
  - Trampos      — https://trampos.co/api/v2/opportunities?tr=<term> (JSON search)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup

from backend.services.text_match import matches_any

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

_GUPY_SEARCH_URL = "https://portal.gupy.io/job-search/term={term}"
_GUPY_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
_MAX_TERMS = 4  # one request per keyword; keep it polite
_GUPY_SPACING = 1.0  # Gupy resets connections after a quick burst


def _terms(keywords: list[str], fallback: str = "") -> list[str]:
    seen: list[str] = []
    for kw in keywords or []:
        kw = (kw or "").strip()
        if kw and kw.lower() not in (t.lower() for t in seen):
            seen.append(kw)
    return seen[:_MAX_TERMS] or ([fallback] if fallback else [])


# ── Gupy ──────────────────────────────────────────────────────────────────────


def extract_gupy_next_data(html: str) -> dict:
    """Return props.pageProps of the __NEXT_DATA__ JSON embedded in a portal.gupy.io search page."""
    m = _GUPY_NEXT_DATA.search(html)
    return json.loads(m.group(1))["props"]["pageProps"]


def _gupy_rows(page_props: dict) -> list:
    return page_props["initialJobList"]["data"] or []


async def _gupy_query(client: httpx.AsyncClient, term: str, remote: bool) -> dict:
    """One portal.gupy.io search page (12 items; the page has no working pagination param) -> pageProps."""
    url = _GUPY_SEARCH_URL.format(term=quote(term[:200], safe=""))
    if remote:
        url += "&workplaceTypes[]=remote"
    for attempt in (1, 2):
        try:
            r = await client.get(url, headers=_HTML_HEADERS)
            r.raise_for_status()
            page_props = extract_gupy_next_data(r.text)
            _gupy_rows(page_props)  # shape check: retry when the page came back without a job list
            return page_props
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(1.5)
    return {}


async def fetch_gupy(
    keywords: list[str],
    location: str = "",
    results_wanted: int = 20,
    remote: bool = False,
) -> list[dict]:
    """Fetch jobs from the Gupy job portal: one sequential query per keyword, deduped by id."""
    pages: list[dict] = []
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
        for i, term in enumerate(_terms(keywords, "desenvolvedor")):
            if i:
                await asyncio.sleep(_GUPY_SPACING)
            try:
                pages.append(await _gupy_query(client, term, remote))
            except Exception as exc:
                logger.warning("Gupy query '%s' failed: %s", term, exc)
                last_exc = exc
    if last_exc and not any(_gupy_rows(pp) for pp in pages):
        raise last_exc
    return parse_gupy(pages, keywords, results_wanted)


def parse_gupy(page_props: dict | list[dict], keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Normalize Gupy pageProps (one page, or the pages of several keyword queries) into job dicts."""
    rows: dict[str, dict] = {}
    for pp in [page_props] if isinstance(page_props, dict) else page_props:
        for job in _gupy_rows(pp):
            if isinstance(job, dict) and job.get("id") is not None:
                rows.setdefault(str(job["id"]), job)

    results: list[dict] = []
    for jid, job in rows.items():
        if not matches_any(keywords, job.get("name") or "", job.get("description") or ""):
            continue

        wp = (job.get("workplaceType") or "").lower()
        if wp == "remote":
            loc = "Remoto, Brasil"
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

        uid = hashlib.md5(jid.encode()).hexdigest()[:8]
        item = {
            "id": f"gupy_{uid}",
            "title": job.get("name") or "",
            "company": job.get("careerPageName") or "",
            "company_url": job.get("careerPageUrl") or job.get("careerPageLogo") or "",
            "location": loc,
            "job_type": job_type,
            "salary_range": "",
            "posted_date": (job.get("publishedDate") or "")[:10],
            "description": job.get("description") or "",
            "url": job.get("jobUrl") or "",
            "site": "gupy",
            "match_score": None,
        }
        if wp == "remote":
            item["is_remote"] = True
        elif wp == "hybrid":
            item["is_remote"] = None
            item["tags"] = ["hybrid"]
        elif wp:
            item["is_remote"] = False
        results.append(item)

        if len(results) >= results_wanted:
            break

    logger.info("Gupy: parsed %d jobs for %s", len(results), keywords)
    return results


# ── Programathor ──────────────────────────────────────────────────────────────


def parse_programathor_listing(html: str) -> list[dict]:
    """Raw cards of one /jobs listing page (unfiltered)."""
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
    max_pages = min(15, max(3, results_wanted // 8 + 3))
    pages: list[str] = []

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for page in range(1, max_pages + 1):
                url = "https://programathor.com.br/jobs"
                params = {"page": page} if page > 1 else {}
                r = await client.get(url, params=params, headers=_HTML_HEADERS)
                r.raise_for_status()
                batch = parse_programathor_listing(r.text)
                if not batch:
                    break
                pages.append(r.text)
                if len(batch) < 5:
                    break
    except Exception as exc:
        logger.warning("Programathor fetch failed: %s", exc)
        raise
    return parse_programathor(pages, keywords, results_wanted)


def parse_programathor(html: str | list[str], keywords: list[str], results_wanted: int = 20) -> list[dict]:
    """Normalize Programathor listing HTML (one page, or several concatenated in order) into job dicts."""
    results: list[dict] = []
    collected: list[dict] = []
    for page_html in [html] if isinstance(html, str) else html:
        collected.extend(parse_programathor_listing(page_html))

    for job in collected:
        title = job.get("title") or ""
        if not matches_any(keywords, title, job.get("description") or "", job.get("company") or ""):
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

    logger.info("Programathor: parsed %d jobs (from %d listings)", len(results), len(collected))
    return results


# ── Trampos ───────────────────────────────────────────────────────────────────

_TRAMPOS_API = "https://trampos.co/api/v2/opportunities"
_TRAMPOS_TYPES = {"estagio": "internship", "freelance": "contract", "trainee": "internship"}


async def fetch_trampos(
    keywords: list[str],
    results_wanted: int = 20,
) -> list[dict]:
    """Fetch jobs from Trampos' v2 search endpoint: one query per keyword, deduped by id."""
    payloads: list[dict] = []
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
        for term in _terms(keywords, "desenvolvedor"):
            try:
                r = await client.get(_TRAMPOS_API, params={"tr": term}, headers=_JSON_HEADERS)
                r.raise_for_status()
                payloads.append(r.json())
            except Exception as exc:
                logger.warning("Trampos query '%s' failed: %s", term, exc)
                last_exc = exc
    if last_exc and not any(d.get("opportunities") for d in payloads):
        raise last_exc
    return parse_trampos(payloads, keywords, results_wanted)


def parse_trampos(payload: dict | list[dict], keywords: list[str] | None = None, results_wanted: int = 20) -> list[dict]:
    """Normalize Trampos v2 search JSON ({"opportunities": [...]}; one or several responses) into job dicts."""
    rows: dict[str, dict] = {}
    for data in [payload] if isinstance(payload, dict) else payload:
        for job in data.get("opportunities") or []:
            if isinstance(job, dict) and job.get("id") is not None:
                rows.setdefault(str(job["id"]), job)

    results: list[dict] = []
    for jid, job in rows.items():
        # No local keyword filter: the server matches the term against descriptions too.
        company = job.get("custom_company_name") or (job.get("company") or {}).get("name") or ""

        city, state = job.get("city") or "", job.get("state") or ""
        home_office = bool(job.get("home_office"))
        if city or state:
            loc = f"{city}, {state}".strip(", ")
        else:
            loc = "Remoto, Brasil" if home_office else "Brasil"

        item = {
            "id": f"trampos_{hashlib.md5(jid.encode()).hexdigest()[:8]}",
            "title": job.get("name") or "",
            "company": company,
            "company_url": (job.get("company") or {}).get("url") or "",
            "location": loc,
            "job_type": _TRAMPOS_TYPES.get(job.get("type_slug") or "", "fulltime"),
            "salary_range": job.get("salary") or "",
            "posted_date": (job.get("published_at") or "")[:10],
            "description": job.get("category_name") or "",
            "url": f"https://trampos.co/oportunidades/{jid}",
            "site": "trampos",
            "match_score": None,
        }
        if home_office:
            item["is_remote"] = True
        elif job.get("hybrid"):
            item["is_remote"] = None
            item["tags"] = ["hybrid"]
        results.append(item)
        if len(results) >= results_wanted:
            break

    logger.info("Trampos: parsed %d jobs for %s", len(results), keywords)
    return results
