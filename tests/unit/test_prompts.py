"""
Prompt regression test.

Drives every real LLM call site with a stub client and compares the exact
(system, user) strings it sends against SHA-256 hashes captured from the
pre-refactor inline prompts (before they moved to backend/prompts/*.txt).

If you edit a prompt on purpose: run
    JUMPSHIP_PRINT_PROMPT_HASHES=1 pytest tests/unit/test_prompts.py -s
and paste the printed dict into EXPECTED.
"""
from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.models.schemas import JobResult, ResumeProfile
from backend.services.llm_client import LLMClient

_ASSESS_REPLY = json.dumps({"match_score": 50, "summary": "ok"})


class _Stub:
    """Records every (system, user) pair; mimics the parts of LLMClient the call sites use."""

    provider = "openai"
    model = ""

    def __init__(self, reply: str = _ASSESS_REPLY):
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    def _resolve_model(self) -> str:
        return "stub-model"

    def complete(self, system, user, json_schema=None):
        self.calls.append((system, user))
        return self.reply

    def complete_json(self, system, user, schema=None):
        self.calls.append((system, user))
        return {"score": 50}


def _h(calls: list[tuple[str, str]]) -> str:
    assert calls, "call site never reached the LLM"
    return hashlib.sha256(json.dumps(calls, ensure_ascii=False).encode("utf-8")).hexdigest()


_PROFILE_FULL = ResumeProfile(
    name="Ada {Lovelace}", title="Senior ML Engineer", experience_years=5,
    skills=[f"skill{i}" for i in range(25)], domains=["MLOps", "Data {Eng}"],
    raw_text="Résumé text with {braces} and ünïcode. " * 60,
)
_PROFILE_SPARSE = ResumeProfile()
_JOB_FULL = JobResult(
    id="1", title="ML Engineer", company="Acme {Corp}", location="Remote", salary_range="USD 100k",
    site="linkedin", description="Build {things}.\nSecond line " * 300,
)
_JOB_SPARSE = JobResult(id="2", title="Dev")


@pytest.fixture()
def stub(monkeypatch):
    s = _Stub()
    monkeypatch.setattr(LLMClient, "from_override", classmethod(lambda cls, o=None, fallback=None: s))
    monkeypatch.setattr(LLMClient, "from_settings", classmethod(lambda cls: s))
    return s


async def _capture(monkeypatch) -> dict[str, str]:
    from backend.routers import interview, jobs_v2
    from backend.services import ai_evaluator, resume_parser_v2
    import backend.main as main_mod

    out: dict[str, str] = {}

    # ── jobs_v2: assessment / keywords ───────────────────────────────────────
    monkeypatch.setattr(jobs_v2, "search_company_info", AsyncMock(return_value="Acme builds {widgets}."))
    for name, profile, job, research in [
        ("assess_full_research", _PROFILE_FULL, _JOB_FULL, True),
        ("assess_full_noresearch", _PROFILE_FULL, _JOB_FULL, False),
        ("assess_sparse_research", _PROFILE_SPARSE, _JOB_SPARSE, True),
    ]:
        s = _Stub()
        await jobs_v2._run_assessment(s, profile, job, research)
        out[name] = _h(s.calls)

    s = _Stub(reply='["x"]')
    monkeypatch.setattr(LLMClient, "from_override", classmethod(lambda cls, o=None, fallback=None: s))
    await jobs_v2.suggest_keywords(jobs_v2.SynonymRequest(keywords=["python", "FastAPI {x}"]))
    out["suggest_keywords"] = _h(s.calls)
    for lang in ("pt", "xx"):
        s.calls.clear()
        await jobs_v2.translate_keywords(jobs_v2.TranslateRequest(keywords=["data engineer", "{x}"], target_language=lang))
        out[f"translate_keywords_{lang}"] = _h(s.calls)

    # ── interview ────────────────────────────────────────────────────────────
    monkeypatch.setattr(interview, "search_company_info", AsyncMock(return_value="Company {intel}"))
    monkeypatch.setattr(interview, "search_interview_process", AsyncMock(return_value="Process {intel}"))
    monkeypatch.setattr(interview, "_pick_name", lambda company: "Alex")  # builtin hash() is per-process random
    for name, title, desc, company, prof in [
        ("init_behavioral_full", "Product Manager", "Run {roadmaps}", "Acme", "  Built X  "),
        ("init_system_design", "Staff Engineer", "distributed systems", "Acme", ""),
        ("init_coding", "Backend Engineer", "python", "", ""),
    ]:
        resp = await interview.interview_init(
            interview.InterviewInitRequest(
                job_title=title, job_description=desc, company_name=company,
                resume_text="My {resume}", user_profile=prof,
            ),
            db=None,
        )
        out[name] = _h([(resp.session_context, resp.persona_bio)])

    s = _Stub(reply="<fala_do_entrevistador>Hi</fala_do_entrevistador>")
    monkeypatch.setattr(LLMClient, "from_override", classmethod(lambda cls, o=None, fallback=None: s))
    await interview.interview_chat(
        interview.InterviewChatRequest(session_context="CTX {x}", persona_name="Alex"), db=None)
    out["chat_empty"] = _h(s.calls)
    s.calls.clear()
    await interview.interview_chat(
        interview.InterviewChatRequest(
            session_context="CTX", persona_name="Alex", message=" hello ",
            messages=[interview.ChatMessage(role="assistant", content="Q1"),
                      interview.ChatMessage(role="user", content="A1")]),
        db=None)
    out["chat_history"] = _h(s.calls)

    s = _Stub(reply='{"score": 70}')
    monkeypatch.setattr(LLMClient, "from_override", classmethod(lambda cls, o=None, fallback=None: s))
    row = SimpleNamespace(
        report=None, interview_track="coding", persona_name="Alex", completed=False,
        messages=[{"role": "assistant", "content": "Q {1}"}, {"role": "user", "content": "A1"},
                  {"role": "assistant", "content": "Q2"}, {"role": "user", "content": "A2"}],
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = row
    await interview.interview_report(interview.InterviewReportRequest(session_id="s1"), db=db)
    out["report"] = _h(s.calls)

    # ── ai_evaluator / resume generator ──────────────────────────────────────
    s = _Stub()
    ai_evaluator.assess_job("resume {x}", "job {y}", "Dev", "Acme", client=s)
    out["assess_job"] = _h(s.calls)

    s = _Stub(reply="<curriculo_otimizado><div>x</div></curriculo_otimizado>")
    ai_evaluator.generate_tailored_resume_html(
        "resume {x}", "job {y}", "Dev", "Acme",
        assessment={"match_score": 61, "gaps": ["a", "b"], "keywords_missing": ["k1", "k2"]},
        client=s, user_profile={"full_name": "Ada", "email": "a@b.c"},
        custom_instructions=" be bold ", extra_context=" side project {z} ")
    out["tailored_full"] = _h(s.calls)
    s.calls.clear()
    ai_evaluator.generate_tailored_resume_html("resume", "", "", "", client=s)
    out["tailored_minimal"] = _h(s.calls)
    s.calls.clear()
    ai_evaluator.compact_tailored_resume_html('<div id="resume-root">{x}</div>', client=s)
    out["compact"] = _h(s.calls)

    # ── resume parser ────────────────────────────────────────────────────────
    s = _Stub(reply="{}")
    await resume_parser_v2.parse_profile("Résumé {braces} " * 500, s)
    out["resume_parse"] = _h(s.calls)

    # ── llm_client JSON repair ───────────────────────────────────────────────
    client = LLMClient(provider="openai")
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(client, "complete", lambda system, user, json_schema=None: (calls.append((system, user)), "not json {")[1])
    with pytest.raises(ValueError):
        client.complete_json("sys", "usr")
    out["json_repair"] = _h(calls[1:])

    # ── health probe ─────────────────────────────────────────────────────────
    svc = MagicMock()
    svc.is_available = AsyncMock(return_value=True)
    seen: list[tuple[str, str]] = []

    async def _complete(system, user):
        seen.append((system, user))
        return "OK"

    svc.complete = _complete
    monkeypatch.setattr(main_mod, "get_llm_service", lambda: svc)
    await main_mod.health_llm()
    out["health"] = _h(seen)
    return out


EXPECTED: dict[str, str] = {
    "assess_full_research": "cd50ffe0896fd3c6a1e6bb828175d6515730d5ee6fd27ff4800d832e0c1f34f9",
    "assess_full_noresearch": "9ddcd295a7a49f080498b461b16e55e2f71af8b5734caef4d2d5b1126f93cc0f",
    "assess_sparse_research": "d4f8b00832bbc81a15b6b68235806f24df11f63298861167e46f7fcc25d8210c",
    "suggest_keywords": "af64ffc5b82368380bf504642468b81ea9f71f1328314eb3eaea9b7122a449ad",
    "translate_keywords_pt": "757686d22b3c6949988552885d058cff78b3319ef01b9bbdd66c516256a85fae",
    "translate_keywords_xx": "05c6238182f38ec60d51a50e47516b23b84643a75df1d493526d3110a48adea6",
    "init_behavioral_full": "e0abfc90d67255a7982001b633d2d6b9872dc7598f57ef683eeaafe479a7a121",
    "init_system_design": "039e80d987c12319958dfd481ac5e0705041ac8bc58f450bc97f791c204a6c70",
    "init_coding": "05e3a997af38a0b70f5ea436d12913c2f4b82c6571fae22f048ff0fdd80b9d6f",
    "chat_empty": "ce37a3c4261a9a7250b303290760d8fa512d2f09ed5f0a6c037efa5d882e7f7d",
    "chat_history": "cab0c8eecd19bfbd57302ab73e57becca84e9dbeb3884070678ada81abfcd56e",
    "report": "9fa7664659dd46370499f88ac29b3ccce83e2d038d7279d49cf5b3ac9f8b4e95",
    "assess_job": "5719b71714dde142058884fc55069f6023dcb04bb937aec74712127dbac31ba6",
    "tailored_full": "f9b6ab3ac3c09d447d23f228e0b2c064dfdf796bed893492573bec07ca4455b9",
    "tailored_minimal": "be6855fd96513c7c77c0803a4e71babfb8791743021127b44b793df120866dc2",
    "compact": "2962aeac4aef842d4fe50f84aab79a8918e9d89cefe7cef54fa245626980b710",
    "resume_parse": "2a5bf86fec9683b1cf0d9b2acb70f0d7e1a899dbf85bdb09f3c0efbba00b802a",
    "json_repair": "15dd7b2de56c426db50fbe75dfbd99332057aa43074aab464617909f27df6ddb",
    "health": "1042514503e26b39dce60ca7e9eb81ccaca27db902f04af44af33d4ddf08cd9e"
}


async def test_prompts_unchanged(monkeypatch):
    got = await _capture(monkeypatch)
    if os.getenv("JUMPSHIP_PRINT_PROMPT_HASHES"):
        print("EXPECTED = " + json.dumps(got, indent=4))
    assert got == EXPECTED


def test_loader_roundtrip():
    from backend.prompts import load, render

    assert render("compact_resume_user") == load("compact_resume_user")
    with pytest.raises(FileNotFoundError):
        load("does_not_exist")


def test_every_prompt_file_is_documented():
    from pathlib import Path

    import backend.prompts as prompts

    readme = (Path(prompts.__file__).parent / "README.md").read_text(encoding="utf-8")
    missing = [p.stem for p in Path(prompts.__file__).parent.glob("*.txt") if p.stem not in readme]
    assert not missing, f"undocumented prompt files: {missing}"
