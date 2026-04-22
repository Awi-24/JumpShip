"""
JumpShip — Job evaluator and resume tailoring.

Uses LLMClient for all provider calls — provider-agnostic.
"""
from __future__ import annotations

from typing import Optional

from backend.services.llm_client import LLMClient


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

_ASSESSMENT_SYSTEM = (
    "You are an expert HR consultant and career coach specialising in resume "
    "optimisation and job matching. Analyse the candidate's resume against the "
    "job description and provide structured, actionable feedback. "
    "Respond ONLY with valid JSON — no markdown fences, no prose outside the JSON."
)

_ASSESSMENT_USER = """Analyse this resume against the job description below.

## RESUME
{resume}

## JOB DESCRIPTION
{job_description}
Job Title: {job_title} at {company_name}

Return EXACTLY this JSON structure (no extra keys, no markdown):
{{
  "score": <integer 0-100>,
  "summary": "<2-3 sentence fit summary>",
  "strengths": ["<strength with evidence>"],
  "gaps": ["<gap or missing requirement>"],
  "suggestions": ["<actionable improvement>"],
  "keywords_matched": ["<keyword found in resume>"],
  "keywords_missing": ["<keyword absent from resume>"]
}}"""

# HTML fragment the LLM must follow (ATS-friendly, parsed by our PDF pipeline).
_RESUME_HTML_SKELETON = """
<div class="resume" id="resume-root">
  <header class="hdr">
    <h1 class="legal-name">Full Legal Name</h1>
    <p class="contact-line">City, ST | email@ | phone | linkedin.com/in/… | github.com/…</p>
  </header>
  <section id="summary">
    <h2>Professional Summary</h2>
    <p>2–4 sentences from the source only; weave relevant job-posting keywords naturally for ATS.</p>
  </section>
  <section id="experience">
    <h2>Professional Experience</h2>
    <div class="job">
      <h3><span class="role">Job Title</span><span class="dash"> — </span><span class="company">Company</span></h3>
      <p class="job-meta"><em>Jan 2020 – Present · City, ST (Remote)</em></p>
      <ul>
        <li>Use <strong>tools/platforms</strong> from the source; outcome + metric when present in source.</li>
      </ul>
    </div>
  </section>
  <section id="education">
    <h2>Education</h2>
    <ul>
      <li><strong>Degree / program</strong>, School — Year <em>(honors only if in source)</em></li>
    </ul>
  </section>
  <section id="certifications">
    <h2>Certifications &amp; Licenses</h2>
    <ul>
      <li>Credential, Issuer, Year (from source only)</li>
    </ul>
  </section>
  <section id="skills">
    <h2>Technical Skills &amp; Keywords</h2>
    <p class="skills-block">Languages: … | Cloud / Data: … | Tools: … (list every technology from the source; shorten words, do not drop items)</p>
  </section>
</div>
""".strip()

_TAILORED_RESUME_SYSTEM_HTML = (
    "You are a professional resume editor. Output ONE resume as an HTML fragment only — "
    "no Markdown, no backticks, no commentary, no preamble or closing remarks. "
    "The outer element MUST be exactly: <div class=\"resume\" id=\"resume-root\"> … </div>. "
    "Use only these tags: div, header, section, h1, h2, h3, p, ul, li, span, em, strong. "
    "For dates and locations use <em>…</em> (never raw asterisks). For emphasis use <strong>…</strong>. "
    "Preserve ALL factual content from the original resume: every employer, title, date range, "
    "location, degree, school, certification, license, project, and substantive bullet. "
    "Never drop Education or Certifications when those facts exist in the source — merge wording "
    "instead. Target one printed page by tightening language, not by deleting sections. "
    "Mirror ATS-relevant keywords from the job description only where they honestly match the source."
)

_TAILORED_RESUME_USER_HTML_HEAD = """Compare the ORIGINAL RESUME to the TARGET JOB. Return ONLY the HTML fragment (start with <div class="resume" id="resume-root">, end with </div>).

## ORIGINAL RESUME (source of truth — do not invent employers, dates, degrees, tools, or metrics)
"""

_TAILORED_RESUME_USER_HTML_TAIL = """
## TARGET JOB (alignment only)
Title: __JOB_TITLE__ at __COMPANY__

__JOB_DESCRIPTION__

## CANDIDATE CONTEXT (use for contact line when missing from resume text)
__CANDIDATE_CONTEXT__

## PRIOR FIT SIGNALS (do not paste as a narrative)
Match score (0-100): __SCORE__
Gaps vs posting: __GAPS__
Posting keywords still weak in resume: __MISSING_KW__

RULES
1. Copy the skeleton structure below exactly (same section ids and classes). Replace placeholder text with real content from the resume only.
2. Include <section id="education"> with every school/degree/program found in the source. If the source truly has none, omit that entire section.
3. Include <section id="certifications"> with every certificate/license in the source. If none, omit that entire section (no "N/A" paragraphs).
4. Repeat <div class="job">…</div> once per role in the source (most recent first).
5. skills-block must stay one or two dense lines of ATS keywords — include every skill/tool from the source; compress wording, never truncate mid-list with a dangling comma.
6. No <style>, <script>, <html>, or <body> tags.

## SKELETON (structure to follow)
""" + _RESUME_HTML_SKELETON + """

## OUTPUT
Return the filled HTML fragment only.
"""

_COMPACT_RESUME_SYSTEM_HTML = (
    "You compress resume HTML so it fits one printed A4 page. Preserve EVERY fact and every "
    "<section id=\"education\"> and <section id=\"certifications\"> entry when present. "
    "Shorten <p> and <li> text only; keep the same outer <div class=\"resume\" id=\"resume-root\">. "
    "Same allowed tags only. No commentary outside the fragment."
)

_COMPACT_RESUME_USER_HTML = (
    "The HTML resume below is too tall for one PDF page. Rewrite with tighter wording only.\n\n"
)


def _build_tailored_resume_user_html(
    resume: str,
    job_description: str,
    job_title: str,
    company_name: str,
    candidate_context: str,
    score: object,
    gaps: str,
    missing_keywords: str,
) -> str:
    # Placeholder replace (not str.format) so job descriptions can contain "{" or "}".
    tail = (
        _TAILORED_RESUME_USER_HTML_TAIL.replace("__JOB_TITLE__", job_title or "")
        .replace("__COMPANY__", company_name or "")
        .replace("__JOB_DESCRIPTION__", job_description or "")
        .replace("__CANDIDATE_CONTEXT__", candidate_context or "")
        .replace("__SCORE__", str(score))
        .replace("__GAPS__", gaps or "N/A")
        .replace("__MISSING_KW__", missing_keywords or "N/A")
    )
    return _TAILORED_RESUME_USER_HTML_HEAD + resume + tail


def generate_tailored_resume_html(
    resume_text: str,
    job_description: str,
    job_title: str,
    company_name: str,
    assessment: Optional[dict] = None,
    client: Optional[LLMClient] = None,
    user_profile: Optional[dict] = None,
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
    )

    return llm.complete(_TAILORED_RESUME_SYSTEM_HTML, user_prompt)


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
