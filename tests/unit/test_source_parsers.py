"""
Offline golden tests for the non-JobSpy source parsers.

Each entry of tests/fixtures/sources/cases.json is {site, case, raw, expected, keywords, ctx}:
`raw` is a recorded response (path or list of paths, relative to the manifest), `expected` the normalized
output. The Rust port runs the same manifest. Payload per site: JSON-decoded body (remoteok, arbeitnow,
trampos, greenhouse, lever, workday), HTML text (programathor) or the Gupy __NEXT_DATA__ pageProps dict.
A list of raw files means several responses of one search (Gupy/Trampos/Workday: one per keyword;
Programathor: one per page).
"""
import json
import pathlib
import sys

import pytest

from backend.services.br_sources import extract_gupy_next_data, parse_gupy, parse_programathor, parse_trampos
from backend.services.extra_sources import parse_arbeitnow, parse_remoteok
from backend.services.greenhouse_scraper import parse_greenhouse
from backend.services.lever_scraper import parse_lever
from backend.services.workday_scraper import parse_workday

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures" / "sources"
CASES = json.loads((FIXTURES / "cases.json").read_text(encoding="utf-8"))

_PARSERS = {
    "remoteok": parse_remoteok,
    "arbeitnow": parse_arbeitnow,
    "gupy": parse_gupy,
    "programathor": parse_programathor,
    "trampos": parse_trampos,
    "greenhouse": parse_greenhouse,
    "lever": parse_lever,
    "workday": parse_workday,
}
_LOADERS = {
    "gupy": lambda text: extract_gupy_next_data(text),
    "programathor": lambda text: text,
}


def _load(site, raw):
    paths = raw if isinstance(raw, list) else [raw]
    load = _LOADERS.get(site, json.loads)
    payloads = [load((FIXTURES / p).read_text(encoding="utf-8")) for p in paths]
    return payloads if isinstance(raw, list) else payloads[0]


def run_case(case: dict) -> list[dict]:
    payload = _load(case["site"], case["raw"])
    return _PARSERS[case["site"]](payload, case["keywords"], **case.get("ctx", {}))


@pytest.mark.parametrize("case", CASES, ids=[f"{c['site']}/{c['case']}" for c in CASES])
def test_golden(case):
    expected = json.loads((FIXTURES / case["expected"]).read_text(encoding="utf-8"))
    assert run_case(case) == expected


def test_manifest_covers_every_parser():
    assert {c["site"] for c in CASES} == set(_PARSERS)


# ── JobSpy boards (linkedin, indeed, glassdoor): replay recorded HTTP through the vendored jobspy ────────────

JOBSPY_BOARDS = ("linkedin", "indeed", "glassdoor")


class _FakeResponse:
    def __init__(self, url: str, status: int, text: str):
        self.url, self.status_code, self.text = url, status, text
        self.headers = {}
        self.content = text.encode("utf-8")

    def json(self):
        return json.loads(self.text)


def replay_jobspy(board: str) -> list[dict]:
    """Run job_scraper_v2._search_jobspy for `board` with every HTTP exchange served from <board>/request.json."""
    import asyncio
    import datetime as dt
    from unittest.mock import patch

    from backend.services.job_scraper_v2 import _search_jobspy

    spec = json.loads((FIXTURES / board / "request.json").read_text(encoding="utf-8"))
    served = {
        (r["method"], r["url"]): (r["status"], (FIXTURES / board / r["response_file"]).read_text(encoding="utf-8"))
        for r in spec["requests"]
    }

    def fake_request(self, method, url, **kwargs):
        status, text = served[(method.upper(), url)]
        return _FakeResponse(url, status, text)

    class FrozenDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime.fromisoformat(spec["frozen_now"])

    call = spec["call"]
    # tests/conftest.py may stub `jobspy` in sys.modules; swap in the real vendored package for the replay
    # (only jobspy*: unloading numpy/pandas would break a later re-import).
    is_jobspy = lambda n: n == "jobspy" or n.startswith("jobspy.")  # noqa: E731
    saved = {n: m for n, m in sys.modules.items() if is_jobspy(n)}
    for n in saved:
        del sys.modules[n]
    try:
        from jobspy import glassdoor as jobspy_glassdoor
        from jobspy import util as jobspy_util

        with patch.object(jobspy_util.RequestsRotating, "request", fake_request),              patch.object(jobspy_util.TLSRotating, "request", fake_request),              patch.object(jobspy_glassdoor, "datetime", FrozenDatetime):
            return asyncio.run(_search_jobspy(
                call["keywords"], call["location"], call["job_type"], [board], call["results_wanted"],
                country_indeed=call["country_indeed"], is_remote=call["is_remote"], hours_old=call["hours_old"],
            ))
    finally:
        for n in [n for n in sys.modules if is_jobspy(n)]:
            del sys.modules[n]
        sys.modules.update(saved)


@pytest.mark.parametrize("board", JOBSPY_BOARDS)
def test_jobspy_replay(board):
    expected = json.loads((FIXTURES / board / "expected.json").read_text(encoding="utf-8"))
    assert replay_jobspy(board) == expected
