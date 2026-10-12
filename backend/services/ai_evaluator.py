"""
JumpShip — Job evaluator and resume tailoring.

Uses LLMClient for all provider calls — provider-agnostic.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from backend.prompts import load, render
from backend.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


def _extract_xml(text: str, tag: str) -> str:
    """Extract content between <tag>…</tag>. Returns '' if not found."""
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return m.group(1).strip() if m else ""


# ── JSON schema for job assessment ────────────────────────────────────────────

ASSESSMENT_SCHEMA = {
    "type": "object",
    "required": ["score", "summary", "strengths", "gaps", "suggestions",
                 "keywords_matched", "keywords_missing"],
    "properties": {
        "score":             {"type": "integer", "minimum": 0, "maximum": 100},
        "summary":           {"type": "string"},
        "strengths":         {"type": "array", "items": {"type": "string"}},
        "gaps":              {"type": "array", "items": {"type": "string"}},
        "suggestions":       {"type": "array", "items": {"type": "string"}},
        "keywords_matched":  {"type": "array", "items": {"type": "string"}},
        "keywords_missing":  {"type": "array", "items": {"type": "string"}},
    },
}

# ── Prompts ────────────────────────────────────────────────────────────────────

_ASSESSMENT_SYSTEM = load("assessment_system")

_ASSESSMENT_USER = load("assessment_user")

# HTML fragment the LLM must follow (ATS-friendly, two-column bottom for space efficiency).
_RESUME_HTML_SKELETON = load("resume_html_skeleton")

_TAILORED_RESUME_SYSTEM_HTML = load("tailored_resume_system_html")


_COMPACT_RESUME_SYSTEM_HTML = load("compact_resume_system")

_COMPACT_RESUME_USER_HTML = load("compact_resume_user")


def _build_tailored_resume_user_html(
    resume: str,
    job_description: str,
    job_title: str,
    company_name: str,
    candidate_context: str,
    score: object,
    gaps: str,
    missing_keywords: str,
    custom_instructions: Optional[str] = None,
    extra_context: Optional[str] = None,
) -> str:
    # str.format only parses the template, never the substituted values, so job descriptions
    # may contain "{" or "}".
    job_title_line = f"Title: {job_title} at {company_name}" if job_title or company_name else ""
    body = render(
        "tailored_resume_user_html",
        job_title_line=job_title_line,
        job_description=job_description or "",
        resume=resume,
        candidate_context=candidate_context or "",
        score=score,
        gaps=gaps or "N/A",
        missing_kw=missing_keywords or "N/A",
        skeleton=_RESUME_HTML_SKELETON,
    )
    if extra_context and extra_context.strip():
        body += "\n\n" + render("tailored_resume_extra_info", extra_context=extra_context.strip())
    if custom_instructions and custom_instructions.strip():
        body += "\n\n" + render("tailored_resume_custom_instructions", custom_instructions=custom_instructions.strip())
    return body


def generate_tailored_resume_html(
    resume_text: str,
    job_description: str,
    job_title: str,
    company_name: str,
    assessment: Optional[dict] = None,
    client: Optional[LLMClient] = None,
    user_profile: Optional[dict] = None,
    custom_instructions: Optional[str] = None,
    extra_context: Optional[str] = None,
) -> str:
    """
    Generate tailored resume HTML for a specific job (fragment inside #resume-root).
    Stored in DB column `markdown` for historical reasons.
    """
    llm = client or LLMClient.from_settings()

    a = assessment or {}
    gaps_list = list(a.get("gaps") or [])
    gaps = ", ".join(gaps_list[:5]) or "N/A"
    missing_kw = ", ".join((a.get("keywords_missing") or [])[:10]) or "N/A"
    score = a.get("match_score", a.get("score", "N/A"))

    candidate_context = _build_candidate_context(user_profile or {})

    user_prompt = _build_tailored_resume_user_html(
        resume=(resume_text or "")[:8000],
        job_description=(job_description or "")[:5000],
        job_title=job_title,
        company_name=company_name,
        candidate_context=candidate_context,
        score=score,
        gaps=gaps,
        missing_keywords=missing_kw,
        custom_instructions=custom_instructions,
        extra_context=extra_context,
    )

    raw = llm.complete(_TAILORED_RESUME_SYSTEM_HTML, user_prompt)

    # Log changes_summary for diagnostic visibility (does not block flow)
    summary = _extract_xml(raw, "changes_summary")
    if summary:
        logger.info("Tailoring changes for %s @ %s:\n%s", job_title, company_name, summary.strip())

    # Extract the HTML from <curriculo_otimizado>; discard reasoning tags
    html_fragment = _extract_xml(raw, "curriculo_otimizado")
    return html_fragment if html_fragment else raw  # fallback: return raw if no tag found


def compact_tailored_resume_html(fragment: str, client: Optional[LLMClient] = None) -> str:
    """Second-pass HTML compression when PDF layout exceeds one page."""
    llm = client or LLMClient.from_settings()
    body = (fragment or "").strip()
    user = _COMPACT_RESUME_USER_HTML + body
    return llm.complete(_COMPACT_RESUME_SYSTEM_HTML, user)


def compact_tailored_resume_markdown(markdown: str, client: Optional[LLMClient] = None) -> str:
    """Legacy name — input/output are HTML resume fragments."""
    return compact_tailored_resume_html(markdown, client=client)


# ── Public API ─────────────────────────────────────────────────────────────────

_ASSESSMENT_DEFAULTS = {
    "score": 0,
    "summary": "",
    "strengths": [],
    "gaps": [],
    "suggestions": [],
    "keywords_matched": [],
    "keywords_missing": [],
}


def assess_job(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company_name: str = "",
    client: Optional[LLMClient] = None,
) -> dict:
    """
    Assess resume against job description.
    Returns dict: score, summary, strengths, gaps, suggestions, keywords_*.
    """
    llm = client or LLMClient.from_settings()

    user_prompt = _ASSESSMENT_USER.format(
        resume=resume_text[:8000],
        job_description=job_description[:6000],
        job_title=job_title,
        company_name=company_name,
    )

    result = llm.complete_json(_ASSESSMENT_SYSTEM, user_prompt, schema=ASSESSMENT_SCHEMA)

    for key, default in _ASSESSMENT_DEFAULTS.items():
        result.setdefault(key, default)

    try:
        result["score"] = max(0, min(100, int(result["score"])))
    except (TypeError, ValueError):
        result["score"] = 0

    return result


def analyse_resume(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company_name: str = "",
    provider: str = "",
    api_key: str = "",
) -> dict:
    """Legacy compat shim → assess_job."""
    return assess_job(
        resume_text=resume_text,
        job_description=job_description,
        job_title=job_title,
        company_name=company_name,
    )


def generate_tailored_resume(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company_name: str = "",
    analysis: Optional[dict] = None,
    provider: str = "",
    api_key: str = "",
) -> str:
    """Legacy compat shim → generate_tailored_resume_markdown."""
    return generate_tailored_resume_markdown(
        resume_text=resume_text,
        job_description=job_description,
        job_title=job_title,
        company_name=company_name,
        assessment=analysis,
    )


def generate_tailored_resume_markdown(
    resume_text: str,
    job_description: str,
    job_title: str,
    company_name: str,
    assessment: Optional[dict] = None,
    client: Optional[LLMClient] = None,
    user_profile: Optional[dict] = None,
) -> str:
    """
    Legacy name — returns an HTML fragment (stored in DB column `markdown`).
    """
    return generate_tailored_resume_html(
        resume_text=resume_text,
        job_description=job_description,
        job_title=job_title,
        company_name=company_name,
        assessment=assessment,
        client=client,
        user_profile=user_profile,
    )


def _build_candidate_context(p: dict) -> str:
    """Format UserProfile fields into a compact context block for the LLM."""
    lines = []
    if p.get("full_name"):
        lines.append(f"Name: {p['full_name']}")
    if p.get("email"):
        lines.append(f"Email: {p['email']}")
    if p.get("phone"):
        lines.append(f"Phone: {p['phone']}")
    if p.get("linkedin_url"):
        lines.append(f"LinkedIn: {p['linkedin_url']}")
    if p.get("github_url"):
        lines.append(f"GitHub: {p['github_url']}")
    if p.get("portfolio_url"):
        lines.append(f"Portfolio: {p['portfolio_url']}")
    location_parts = [p.get("location_city"), p.get("location_state"), p.get("location_country")]
    location = ", ".join(x for x in location_parts if x)
    if location:
        lines.append(f"Location: {location}")
    if p.get("preferred_work_mode") and p["preferred_work_mode"] != "any":
        lines.append(f"Preferred work mode: {p['preferred_work_mode']}")
    if p.get("willing_to_relocate"):
        lines.append("Willing to relocate: Yes")
    if p.get("salary_min") or p.get("salary_max"):
        currency = p.get("salary_currency", "BRL")
        lo = p.get("salary_min", "")
        hi = p.get("salary_max", "")
        sal = f"{currency} {lo}-{hi}" if lo and hi else f"{currency} {lo or hi}"
        lines.append(f"Salary expectation: {sal}/mo (context only; do not include in resume)")
    if p.get("work_authorization"):
        lines.append(f"Work authorization: {p['work_authorization']}")
    if p.get("highest_degree"):
        lines.append(f"Education: {p['highest_degree']}" + (f", {p['university']}" if p.get("university") else ""))
    return "\n".join(lines) if lines else "No additional candidate context provided."
