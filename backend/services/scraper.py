"""
Wrapper around python-jobspy's scrape_jobs() function.
Converts the returned DataFrame to a list of dicts for API consumption.
"""
from __future__ import annotations

import sys
import os

# Make sure the parent directory (which contains jobspy package) is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import math
from typing import Optional
import pandas as pd

from jobspy import scrape_jobs


def _safe(val):
    """Convert NaN / NaT / None to None for JSON serialisation."""
    if val is None:
        return None
    try:
        if isinstance(val, float) and math.isnan(val):
            return None
    except Exception:
        pass
    return val


def search_jobs(
    sites: list[str],
    search_term: str,
    location: str = "",
    distance: int = 50,
    is_remote: bool = False,
    job_type: Optional[str] = None,
    easy_apply: Optional[bool] = None,
    results_wanted: int = 20,
    country_indeed: str = "usa",
    hours_old: Optional[int] = None,
    proxies: Optional[list[str]] = None,
) -> list[dict]:
    """
    Call scrape_jobs and return a clean list of job dicts.
    """
    kwargs: dict = dict(
        site_name=sites,
        search_term=search_term,
        location=location,
        distance=distance,
        is_remote=is_remote,
        results_wanted=results_wanted,
        country_indeed=country_indeed,
        description_format="markdown",
        verbose=0,
    )

    if job_type:
        kwargs["job_type"] = job_type
    if easy_apply is not None:
        kwargs["easy_apply"] = easy_apply
    if hours_old is not None:
        kwargs["hours_old"] = hours_old
    if proxies:
        kwargs["proxies"] = proxies

    df: pd.DataFrame = scrape_jobs(**kwargs)

    if df is None or df.empty:
        return []

    jobs = []
    for _, row in df.iterrows():
        job: dict = {}
        for col in df.columns:
            val = row[col]
            # Convert pandas Timestamp / date to ISO string
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            elif isinstance(val, pd.Timestamp):
                val = val.isoformat()
            else:
                val = _safe(val)
            job[col] = val
        jobs.append(job)

    return jobs
