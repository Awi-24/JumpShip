"""
Unit tests for location resolution, keyword matching and result post-filters.
"""
import pytest
from unittest.mock import AsyncMock, patch

from backend.services import job_scraper_v2 as js
from backend.services.job_scraper_v2 import (
    _dedup_jobs, _location_matches, _within_hours, _work_mode_ok, resolve_location, search_jobs,
)
from backend.services.text_match import matches_any


class TestResolveLocation:
    @pytest.mark.parametrize("label, board, indeed, remote, hybrid, key", [
        ("Brasil (todo o país)", "Brazil", "brazil", False, False, "brazil"),
        ("Brasil (Remoto)", "Brazil", "brazil", True, False, "brazil"),
        ("São Paulo", "São Paulo, Brazil", "brazil", False, False, "brazil"),
        ("United States (Remote)", "United States", "usa", True, False, "usa"),
        ("Canada (country-wide)", "Canada", "canada", False, False, "canada"),
        ("UK (Remote)", "United Kingdom", "uk", True, False, "uk"),
        ("London", "London, United Kingdom", "uk", False, False, "uk"),
        ("Kraków", "Kraków, Poland", "poland", False, False, "poland"),
        ("New York, NY", "New York, NY", "usa", False, False, "usa"),
        ("Remote", "Remote", "usa", True, False, ""),
        ("Hybrid", "", "usa", False, True, ""),
        ("Cambridge", "Cambridge", "usa", False, False, ""),
    ])
    def test_labels(self, label, board, indeed, remote, hybrid, key):
        r = resolve_location(label)
        assert tuple(r)[:5] == (board, indeed, remote, hybrid, key)
        if label == "São Paulo":
            assert r.plain_location == "São Paulo"  # Glassdoor rejects "City, Country"


class TestKeywordMatcher:
    def test_word_boundary(self):
        assert not matches_any(["java"], "Senior JavaScript developer")
        assert matches_any(["java"], "Senior Java developer")
        assert not matches_any(["go"], "mongo and django")
        assert matches_any(["go"], "Backend in Go, Python")

    def test_symbols_and_phrases(self):
        assert matches_any(["c++"], "Embedded C++ engineer")
        assert matches_any(["c#"], "Senior C# developer")
        assert matches_any([".net"], "ASP.NET developer")
        assert matches_any(["machine learning"], "Applied  Machine\nLearning engineer")

    def test_accents_and_empty(self):
        assert matches_any(["senior"], "Desenvolvedor Sênior")
        assert matches_any(["desenvolvedor sênior"], "DESENVOLVEDOR SENIOR")
        assert matches_any([], "anything")


class TestLocationMatches:
    def test_cambridge_is_not_brazil(self):
        assert _location_matches("London, UK", "Cambridge")
        assert _location_matches("London, UK", resolve_location("Cambridge"))

    def test_brazil_search(self):
        s = resolve_location("Brasil (todo o país)")
        assert _location_matches("Rio de Janeiro, RJ", s)
        assert _location_matches("Salvador, Bahia, Brazil", s)
        assert _location_matches("Remote", s)
        assert _location_matches("", s)
        assert not _location_matches("New York, NY", s)
        assert not _location_matches("San Francisco, CA", s)
        assert not _location_matches("El Salvador", s)
        assert not _location_matches("Las Palmas, Spain", s)
        assert not _location_matches("Indianapolis, IN", s)

    def test_remote_search_uses_is_remote(self):
        s = resolve_location("Remote")
        assert _location_matches("São Paulo", s, job_is_remote=True)
        assert not _location_matches("São Paulo", s, job_is_remote=False)
        assert _location_matches("Remote - Worldwide", s)

    def test_city_search_is_country_level(self):
        assert _location_matches("Campinas, SP", "São Paulo")
        assert not _location_matches("Dublin, Ireland", "London")


class TestDedupAndModes:
    def test_accented_title_dedup(self):
        jobs = [{"title": "Desenvolvedor Sênior", "company": "Acme"},
                {"title": "Desenvolvedor Senior", "company": "ACME"}]
        assert len(_dedup_jobs(jobs)) == 1

    def test_cjk_titles_not_collapsed(self):
        jobs = [{"title": "软件工程师", "company": "A"}, {"title": "数据工程师", "company": "A"}]
        assert len(_dedup_jobs(jobs)) == 2

    def test_work_mode(self):
        remote = {"is_remote": True, "tags": ["remote"]}
        hybrid = {"is_remote": None, "tags": ["hybrid"]}
        onsite = {"is_remote": False, "tags": ["on-site"]}
        assert [_work_mode_ok(j, "remote") for j in (remote, hybrid, onsite)] == [True, False, False]
        assert [_work_mode_ok(j, "hybrid") for j in (remote, hybrid, onsite)] == [False, True, False]
        assert [_work_mode_ok(j, "onsite") for j in (remote, hybrid, onsite)] == [False, False, True]

    def test_hours_old(self):
        assert _within_hours("", 24)
        assert _within_hours("not a date", 24)
        assert not _within_hours("2020-01-01", 24)


class TestSearchStatus:
    @pytest.mark.asyncio
    async def test_status_and_no_cache_on_error(self):
        job = {"id": "1", "title": "Dev", "company": "Acme", "location": "São Paulo, Brazil",
               "site": "linkedin", "is_remote": False, "tags": []}

        async def fake(keywords, location, job_type, sites, n, **kw):
            if sites == ["indeed"]:
                raise RuntimeError("boom")
            return [job]

        js._search_cache.clear()
        status = {}
        with patch.object(js, "_search_jobspy", side_effect=fake) as m:
            res = await search_jobs(["zzz-status"], "São Paulo", "all", ["linkedin", "indeed"], 5, status_out=status)
        assert [j["id"] for j in res] == ["1"]
        assert status["linkedin"] == {"count": 1, "error": None}
        assert status["indeed"]["count"] == 0 and "boom" in status["indeed"]["error"]
        kw = m.call_args_list[0].kwargs
        assert kw["country_indeed"] == "brazil" and m.call_args_list[0].args[2] is None  # "all" -> no job type
        assert not js._search_cache  # errored search is not cached
