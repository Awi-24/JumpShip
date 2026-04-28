"""
JumpShip — Playwright-based scraper for custom career portals.

Uses Chromium (headless) with generic job-card extraction heuristics.
Covers sources where no public REST API exists.

Priority source list: high-value sites validated to work with this scraper.
Run with `sites: ["playwright"]` in /api/jobs/search.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from urllib.parse import urlparse

from backend.services.career_sources import load_sources

logger = logging.getLogger(__name__)

# Sites for generic extraction.
# Excluded: nubank (HTTP2 block), rappi (bot detection), quintoandar (SPA blocked),
#           vivo (form-driven), raizen (Gupy → genteraizen.gupy.io, covered by gupy scraper),
#           globo (DNS dead), inter/anthropic (handled by greenhouse_scraper).
_PRIORITY_SOURCE_IDS: set[str] = {
    # Fintech / banking
    "stone_jornada",            # /vagas-abertas override
    "picpay_central_vagas",     # Oracle HCM links
    "itau_carreiras",
    "bradesco_carreiras",
    # Retail
    "magalu_carreiras",
    # Markets / infrastructure
    "b3_vagas",                 # /go/todas-vagas override
    # Mobility / tech
    "uber_careers_list",
    # Big tech / enterprise software
    "openai_jobs",
    "ibm_careers_brazil_search",
    "meta_careers_jobs_brazil",
    "apple_jobs_brazil_search",
    "google_careers_brazil",
    "amazon_jobs_brazil_hub",
    "microsoft_careers_sao_paulo",
    "sap_jobs_brazil",
    # Eightfold
    "vale_eightfold",
    "mercadolibre_eightfold",
    # Energy / oil & gas
    "shell_jobs_global",
    "petrobras_jobs2web",
    "totalenergies_jobs_search_br",
    "siemens_energy_jobs_brazil",
    # Beverages / FMCG
    "heineken_brazil_careers_portal",
    "unilever_brasil_busca_vagas",
    "nestle_brasil_jobs_search",
    "coca_cola_brasil_carreiras",
    # Automotive / industrial
    "stellantis_empregare_br",
    "vw_group_jobs_portal",
    "toyota_empregos_portal",
    "volvo_group_brasil_job_openings",
    # Agribusiness / paper
    "jbs_carreiras",
    "klabin_carreiras",
}

# Direct URL overrides: use these instead of listing_url when we know the real listing page.
_URL_OVERRIDES: dict[str, str] = {
    "stone_jornada": "https://jornada.stone.com.br/vagas-abertas",
    "b3_vagas": "https://vagas.b3.com.br/go/todas-vagas/4559419/",
}

# Ordered CSS selectors — first match wins.
_JOB_LINK_SELECTORS = [
    # Direct job-page links
    'a[href*="/jobs/"]',
    'a[href*="/job/"]',
    'a[href*="/vagas/"]',
    'a[href*="/vaga/"]',
    'a[href*="/oportunidades/"]',
    'a[href*="/careers/"]',
    'a[href*="/career/"]',
    'a[href*="/position/"]',
    'a[href*="/open-positions/"]',
    'a[href*="/openings/"]',
    'a[href*="/search-jobs/"]',
    'a[href*="/searchJobs"]',
    # External ATS embeds visible on the career page
    'a[href*="greenhouse.io/"]',
    'a[href*="boards.greenhouse.io/"]',
    'a[href*="lever.co/"]',
    'a[href*="jobs2web.com/"]',
    'a[href*="empregare.com/"]',
    'a[href*="myworkdayjobs.com/"]',
    'a[href*="successfactors.com/"]',
    'a[href*="icims.com/"]',
]

# Regex fallback: scan raw HTML for job-like paths
_JOB_PATH_RE = re.compile(
    r'href=["\']([^"\']*(?:/jobs?/|/vagas?/|/oportunidades?/|/careers?/|/positions?/|/openings?/)[^"\']{3,})["\']',
    re.I,
)

# Links to skip (navigation, social, etc.)
_SKIP_TEXT_RE = re.compile(
    r"^\s*(apply|candidatar|login|entrar|cadastr|criar conta|sign[- ]?in|home|início|"
    r"about|sobre|contact|contato|privacy|cookies|terms|blog|news|press|instagram|"
    r"linkedin|twitter|youtube|facebook|ver todas as vagas|ver mais|load more)\s*$",
    re.I,
)

# Listing-page links: after loading the home page, follow these to reach the actual job list.
_LISTING_PAGE_PATTERNS = [
    re.compile(r"/vagas-abertas", re.I),
    re.compile(r"/todas-vagas", re.I),
    re.compile(r"/open-positions$", re.I),
    re.compile(r"/vagas$", re.I),
    re.compile(r"/jobs$", re.I),
    re.compile(r"/carreiras$", re.I),
    re.compile(r"/careers$", re.I),
    re.compile(r"/oportunidades$", re.I),
]

_COOKIE_BTN_RE = re.compile(r"aceitar|concordo|continuar|ok|accept|allow|I agree", re.I)
_TIMEOUT_MS = 25_000
_SEMAPHORE_LIMIT = 3


def _norm_url(href: str, base_url: str) -> str:
    if href.startswith("http"):
        return href
    if href.startswith("//"):
        return f"{base_url.split(':')[0]}:{href}"
    if href.startswith("/"):
        p = urlparse(base_url)
        return f"{p.scheme}://{p.netloc}{href}"
    return href


async def _dismiss_cookies(page) -> None:
    try:
        for btn in await page.query_selector_all("button, a"):
            text = (await btn.inner_text()).strip()
            if _COOKIE_BTN_RE.search(text):
                await btn.click(timeout=3000)
                await page.wait_for_timeout(500)
                return
    except Exception:
        pass


async def _navigate_to_listing(page, base_url: str) -> bool:
    """If we're on a landing page, follow the first link that leads to a job listing page."""
    try:
        all_links = await page.query_selector_all("a[href]")
        for a in all_links:
            href = await a.get_attribute("href") or ""
            for pat in _LISTING_PAGE_PATTERNS:
                if pat.search(href):
                    full = _norm_url(href, base_url)
                    logger.debug("Playwright: following listing link %s", full)
                    await page.goto(full, timeout=_TIMEOUT_MS, wait_until="domcontentloaded")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10_000)
                    except Exception:
                        pass
                    await page.wait_for_timeout(2000)
                    return True
    except Exception:
        pass
    return False


async def _extract_jobs(page, source: dict, keywords: list[str]) -> list[dict]:
    company = source.get("name", "")
    base_url = source.get("_effective_url") or source["listing_url"]
    kw_lower = [k.lower() for k in keywords] if keywords else []

    links: list[dict] = []

    for sel in _JOB_LINK_SELECTORS:
        try:
            elements = await page.query_selector_all(sel)
            if not elements:
                continue
            for el in elements:
                href = await el.get_attribute("href") or ""
                title = (await el.inner_text()).strip()
                if not href:
                    continue
                title = re.sub(r"\s+", " ", title)
                if len(title) < 6 or len(title) > 250:
                    continue
                if _SKIP_TEXT_RE.match(title):
                    continue
                url = _norm_url(href, base_url)
                links.append({"title": title, "url": url})
            if links:
                break
        except Exception:
            continue

    # Regex fallback on raw HTML
    if not links:
        try:
            html = await page.content()
            p = urlparse(base_url)
            site_root = f"{p.scheme}://{p.netloc}"
            for m in _JOB_PATH_RE.finditer(html):
                href = m.group(1)
                url = _norm_url(href, base_url)
                if not url.startswith("http"):
                    url = site_root + href
                links.append({"title": "", "url": url})
        except Exception:
            pass

    results: list[dict] = []
    seen: set[str] = set()
    src_id = source.get("id", "custom")

    for link in links:
        url = link["url"]
        title = link["title"]
        if url in seen:
            continue
        seen.add(url)

        if kw_lower and title:
            if not any(kw in title.lower() for kw in kw_lower):
                continue

        uid = hashlib.md5(url.encode()).hexdigest()[:8]
        results.append(
            {
                "id": f"pw_{src_id[:8]}_{uid}",
                "title": title or url.split("/")[-1].replace("-", " ").replace("_", " ").title(),
                "company": company,
                "company_url": "",
                "location": "Brasil",
                "job_type": "fulltime",
                "salary_range": "",
                "posted_date": "",
                "description": "",
                "url": url,
                "site": "playwright",
                "match_score": None,
            }
        )

    return results


async def _scrape_source(browser, sem: asyncio.Semaphore, source: dict, keywords: list[str]) -> list[dict]:
    src_id = source.get("id", "?")
    effective_url = _URL_OVERRIDES.get(src_id) or source["listing_url"]
    source = dict(source, _effective_url=effective_url)

    async with sem:
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="pt-BR",
            viewport={"width": 1280, "height": 800},
        )
        page = await ctx.new_page()
        try:
            await page.goto(effective_url, timeout=_TIMEOUT_MS, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass

            await _dismiss_cookies(page)
            await page.wait_for_timeout(2000)

            jobs = await _extract_jobs(page, source, keywords)

            # If nothing found on the landing page, try following a listing link
            if not jobs:
                navigated = await _navigate_to_listing(page, effective_url)
                if navigated:
                    jobs = await _extract_jobs(page, source, keywords)

            logger.info("Playwright (%s): %d jobs", src_id, len(jobs))
            return jobs
        except Exception as exc:
            logger.warning("Playwright scrape failed (%s): %s", src_id, exc)
            return []
        finally:
            await ctx.close()


async def fetch_playwright(
    keywords: list[str],
    results_wanted: int = 20,
    source_ids: set[str] | None = None,
) -> list[dict]:
    """
    Scrape custom career portals using headless Chromium.

    Args:
        keywords: Filter job titles by these terms.
        results_wanted: Max total results.
        source_ids: Source IDs to scrape. Defaults to _PRIORITY_SOURCE_IDS.
    """
    from playwright.async_api import async_playwright

    target_ids = source_ids if source_ids is not None else _PRIORITY_SOURCE_IDS
    sources = [
        s for s in load_sources()
        if s.get("id") in target_ids
        and s.get("ats") in ("custom", "eightfold", "oracle_jobs2web", "empregare")
    ]

    if not sources:
        return []

    sem = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    results: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            batches = await asyncio.gather(
                *[_scrape_source(browser, sem, src, keywords) for src in sources],
                return_exceptions=True,
            )
        finally:
            await browser.close()

    for batch in batches:
        if isinstance(batch, Exception):
            logger.error("Playwright batch error: %s", batch)
            continue
        results.extend(batch)

    logger.info("Playwright: %d jobs from %d sources", len(results), len(sources))
    return results[:results_wanted]
