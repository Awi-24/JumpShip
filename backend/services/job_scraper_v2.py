"""
JumpShip — Job scraper wrapping the jobspy library.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

logger = logging.getLogger(__name__)


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
        )

        results = []
        for _, row in df.iterrows():
            job_id = hashlib.md5(
                f"{row.get('title', '')}-{row.get('company', '')}-{row.get('job_url', '')}".encode()
            ).hexdigest()[:12]

            results.append({
                "id": job_id,
                "title": str(row.get("title", "")),
                "company": str(row.get("company", "")),
                "location": str(row.get("location", "")),
                "job_type": str(row.get("job_type", "")),
                "salary_range": _format_salary(row),
                "posted_date": str(row.get("date_posted", "")),
                "description": str(row.get("description", "")),
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

    if min_sal and max_sal:
        return f"{currency} {min_sal:,.0f} - {max_sal:,.0f}"
    elif min_sal:
        return f"{currency} {min_sal:,.0f}+"
    elif max_sal:
        return f"Up to {currency} {max_sal:,.0f}"
    return ""
