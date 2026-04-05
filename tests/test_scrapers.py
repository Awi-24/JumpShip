"""
JumpShip — Scraper health check script.

Tests each job source individually and reports what's working/broken.
Run from project root:
    python -m pytest tests/test_scrapers.py -v -s --timeout=60
or as a standalone script:
    python tests/test_scrapers.py
"""
from __future__ import annotations

import asyncio
import sys
import time
from typing import NamedTuple

# ─────────────────────────────────────────────────────────────────────────────
KEYWORDS = ["python", "software engineer"]
LOCATION = "Remote"
RESULTS  = 5
# ─────────────────────────────────────────────────────────────────────────────


class Result(NamedTuple):
    source: str
    ok: bool
    count: int
    latency: float
    error: str


async def _check_extra(source: str) -> Result:
    from backend.services.job_scraper_v2 import _search_extra
    t0 = time.perf_counter()
    try:
        jobs = await _search_extra(source, KEYWORDS, LOCATION, RESULTS)
        latency = time.perf_counter() - t0
        return Result(source, True, len(jobs), latency, "")
    except Exception as exc:
        return Result(source, False, 0, time.perf_counter() - t0, str(exc)[:120])


async def _check_jobspy(site: str) -> Result:
    from backend.services.job_scraper_v2 import _search_jobspy
    t0 = time.perf_counter()
    try:
        jobs = await _search_jobspy(KEYWORDS, LOCATION, "fulltime", [site], RESULTS)
        latency = time.perf_counter() - t0
        return Result(site, True, len(jobs), latency, "")
    except Exception as exc:
        return Result(site, False, 0, time.perf_counter() - t0, str(exc)[:120])


async def run_all() -> list[Result]:
    jobspy_sites  = ["linkedin", "indeed", "glassdoor", "zip_recruiter"]
    extra_sources = ["remoteok", "arbeitnow", "gupy", "programathor", "trampos"]

    tasks = (
        [_check_jobspy(s)  for s in jobspy_sites] +
        [_check_extra(s)   for s in extra_sources]
    )
    return await asyncio.gather(*tasks)


def _print_table(results: list[Result]) -> int:
    """Print a formatted table and return number of failures."""
    COL = 18
    sep = "-" * 80

    print(f"\n{'SOURCE':<{COL}}  {'STATUS':<8}  {'JOBS':<6}  {'TIME':>7}  ERROR")
    print(sep)
    failures = 0
    for r in sorted(results, key=lambda x: (not x.ok, x.source)):
        status  = "[OK]  " if r.ok else "[FAIL]"
        count   = str(r.count) if r.ok else "-"
        latency = f"{r.latency:.1f}s"
        err     = r.error if not r.ok else ""
        print(f"{r.source:<{COL}}  {status:<8}  {count:<6}  {latency:>7}  {err}")
        if not r.ok:
            failures += 1
    print(sep)
    total = len(results)
    print(f"\n{total - failures}/{total} sources OK")
    print("Notes:")
    print("  - Glassdoor: may return 0 results due to anti-scraping measures (API error is normal)")
    print("  - Gupy/Trampos: Brazil-focused; use PT-BR keywords (e.g. 'desenvolvedor', 'python')")
    print("  - ZipRecruiter: US-focused; use a US city (e.g. 'New York') instead of 'Remote'\n")
    return failures


# ── pytest-compatible test functions ─────────────────────────────────────────

def test_remoteok():
    result = asyncio.run(_check_extra("remoteok"))
    assert result.ok, f"RemoteOK failed: {result.error}"
    assert result.count > 0, "RemoteOK returned 0 jobs"


def test_arbeitnow():
    result = asyncio.run(_check_extra("arbeitnow"))
    assert result.ok, f"Arbeitnow failed: {result.error}"


def test_gupy():
    result = asyncio.run(_check_extra("gupy"))
    assert result.ok, f"Gupy failed: {result.error}"


def test_programathor():
    result = asyncio.run(_check_extra("programathor"))
    assert result.ok, f"Programathor failed: {result.error}"


def test_trampos():
    result = asyncio.run(_check_extra("trampos"))
    assert result.ok, f"Trampos failed: {result.error}"


def test_indeed():
    result = asyncio.run(_check_jobspy("indeed"))
    assert result.ok, f"Indeed failed: {result.error}"


def test_linkedin():
    result = asyncio.run(_check_jobspy("linkedin"))
    assert result.ok, f"LinkedIn failed: {result.error}"


def test_glassdoor():
    result = asyncio.run(_check_jobspy("glassdoor"))
    assert result.ok, f"Glassdoor failed: {result.error}"


def test_zip_recruiter():
    result = asyncio.run(_check_jobspy("zip_recruiter"))
    assert result.ok, f"ZipRecruiter failed: {result.error}"


# ── Standalone runner ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("JumpShip - Scraper health check")
    print(f"Keywords: {KEYWORDS}  |  Location: {LOCATION}  |  Results wanted: {RESULTS}")
    results = asyncio.run(run_all())
    failures = _print_table(results)
    sys.exit(failures)
