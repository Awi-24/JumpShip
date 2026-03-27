"""
JumpShip — Job scraper wrapping the jobspy library.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _extract_domain(url: str) -> str:
    """Return scheme+host from a URL, e.g. 'https://stripe.com'."""
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
    """Search for jobs using python-jobspy and return a list of dicts."""
    if sites is None:
        sites = ["indeed", "linkedin", "glassdoor"]

    search_term = " ".join(keywords)

    try:
        from jobspy import scrape_jobs

        df = scrape_jobs(
            site_name=sites,
            search_term=search_term,
            location=location,
            results_wanted=results_wanted,
            job_type=job_type,
            linkedin_fetch_description=True,  # fetch full description for LinkedIn jobs
            description_format="markdown",    # return descriptions as markdown
        )

        results = []
        for _, row in df.iterrows():
            job_id = hashlib.md5(
                f"{row.get('title', '')}-{row.get('company', '')}-{row.get('job_url', '')}".encode()
            ).hexdigest()[:12]

            # Resolve company URL: prefer direct URL, fall back to jobspy company_url
            raw_company_url = (
                row.get("company_url_direct")
                or row.get("company_url")
                or ""
            )
            company_url = str(raw_company_url) if raw_company_url and str(raw_company_url) != "nan" else ""

            # If we only have a relative path, try to build a full URL from the job URL
            if company_url and not company_url.startswith("http"):
                base = _extract_domain(str(row.get("job_url", "")))
                company_url = base + company_url if base else ""

            description = str(row.get("description", "") or "")
            if description == "nan":
                description = ""

            results.append({
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
            })

        return results

    except Exception as e:
        logger.error(f"Job scraping failed: {e}")
        raise


def _format_salary(row) -> str:
    """Format salary range from DataFrame row."""
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
