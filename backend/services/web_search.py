"""
JumpShip — Best-effort company web search via DuckDuckGo Lite.
No API key required. Used to enrich LLM assessment prompts.
"""
from __future__ import annotations

import logging
import re

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


async def _ddg_instant(query: str) -> list[str]:
    """DDG Instant Answer API — returns abstract + related topics."""
    snippets: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as c:
            r = await c.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                headers=_HEADERS,
            )
            data = r.json()
            if data.get("Abstract"):
                snippets.append(data["Abstract"].strip())
            for topic in data.get("RelatedTopics", [])[:3]:
                if isinstance(topic, dict) and topic.get("Text"):
                    snippets.append(topic["Text"].strip())
    except httpx.TimeoutException as exc:
        logger.warning("DDG instant timed out for query %r: %s", query, exc)
    except httpx.HTTPError as exc:
        logger.warning("DDG instant HTTP error for query %r: %s", query, exc)
    except (ValueError, KeyError, TypeError) as exc:
        # ValueError covers JSON decode errors; KeyError/TypeError covers payload shape drift
        logger.warning("DDG instant payload parse error for query %r: %s", query, exc)
    except Exception as exc:  # noqa: BLE001 — surface unexpected failures, still degrade gracefully
        logger.error("DDG instant unexpected error for query %r: %s", query, exc, exc_info=True)
    return snippets


async def _ddg_lite(query: str) -> list[str]:
    """DDG Lite HTML — parse result snippets from the table layout."""
    snippets: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=6, follow_redirects=True) as c:
            r = await c.get(
                "https://lite.duckduckgo.com/lite/",
                params={"q": query},
                headers=_HEADERS,
            )
            # Result snippets live in <td class="result-snippet"> or <td> after the title row
            raw = re.findall(
                r'class=["\']result-snippet["\'][^>]*>(.*?)</td>',
                r.text,
                re.DOTALL | re.IGNORECASE,
            )
            if not raw:
                # Fallback: grab all <td> blocks and pick text-heavy ones
                raw = re.findall(r'<td[^>]*>(.*?)</td>', r.text, re.DOTALL)
            for chunk in raw[:6]:
                text = re.sub(r'<[^>]+>', '', chunk).strip()
                text = re.sub(r'\s+', ' ', text)
                if len(text) > 40:
                    snippets.append(text)
    except httpx.TimeoutException as exc:
        logger.warning("DDG lite timed out for query %r: %s", query, exc)
    except httpx.HTTPError as exc:
        logger.warning("DDG lite HTTP error for query %r: %s", query, exc)
    except (ValueError, KeyError) as exc:
        logger.warning("DDG lite parse error for query %r: %s", query, exc)
    except Exception as exc:  # noqa: BLE001 — surface unexpected failures, still degrade gracefully
        logger.error("DDG lite unexpected error for query %r: %s", query, exc, exc_info=True)
    return snippets


async def search_company_info(company: str, job_title: str = "") -> str:
    """
    Return a best-effort text summary of a company scraped from DDG.
    Returns empty string if nothing useful is found.
    """
    queries = [
        f"{company} company employee reviews work culture glassdoor",
        f"{company} {job_title} average salary compensation".strip(),
    ]

    all_snippets: list[str] = []
    for q in queries:
        snippets = await _ddg_instant(q)
        if not snippets:
            snippets = await _ddg_lite(q)
        all_snippets.extend(snippets)
        if len(all_snippets) >= 4:
            break

    # Deduplicate and join
    seen: set[str] = set()
    unique: list[str] = []
    for s in all_snippets:
        if s not in seen:
            seen.add(s)
            unique.append(s)

    return "\n".join(unique[:5]) if unique else ""


async def search_interview_process(company: str, job_title: str = "") -> str:
    """Search for interview process info for a company + role."""
    queries = [
        f"{company} {job_title} interview process questions glassdoor".strip(),
        f"{company} technical interview coding assessment hiring",
    ]
    all_snippets: list[str] = []
    for q in queries:
        snippets = await _ddg_instant(q)
        if not snippets:
            snippets = await _ddg_lite(q)
        all_snippets.extend(snippets)
        if len(all_snippets) >= 4:
            break
    seen: set[str] = set()
    unique: list[str] = []
    for s in all_snippets:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return "\n".join(unique[:5]) if unique else ""
