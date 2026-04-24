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
    "You are Marcus Webb, a Principal Technical Recruiter with 20+ years placing engineers at "
    "FAANG, high-growth startups, and Fortune 500 companies. You assess candidate-job fit with "
    "calibrated honesty — your reputation depends on accurate scores, not flattery. "
    "Respond ONLY with valid JSON — no markdown fences, no prose outside the JSON.\n\n"
    "SCORING INTEGRITY:\n"
    "• Never inflate scores. Calibrated accuracy matters more than candidate comfort.\n"
    "• 90+ = this candidate would likely pass every round as-is.\n"
    "• 70-89 = strong fit, minor gaps. 50-69 = moderate, notable gaps. <50 = significant mismatch.\n"
    "• Do not claim the candidate has skills not evidenced in their resume.\n"
    "• If you lack company data, say so rather than fabricating insights."
)

_ASSESSMENT_USER = """Assess this resume against the job description below.

## RESUME
{resume}

## JOB DESCRIPTION
{job_description}
Job Title: {job_title} at {company_name}

Return EXACTLY this JSON structure (no extra keys, no markdown):
{{
  "score": <integer 0-100>,
  "summary": "<2-3 sentence fit summary — specific, not generic>",
  "strengths": ["<strength backed by evidence from resume>"],
  "gaps": ["<specific gap or missing requirement>"],
  "suggestions": ["<actionable step to bridge the gap>"],
  "keywords_matched": ["<keyword found in both resume and job>"],
  "keywords_missing": ["<keyword required by job but absent from resume>"]
}}"""

# HTML fragment the LLM must follow (ATS-friendly, two-column bottom for space efficiency).
_RESUME_HTML_SKELETON = """
<div class="resume" id="resume-root">
  <header class="hdr">
    <h1 class="legal-name">Full Legal Name</h1>
    <p class="contact-line">City, Country · email@example.com · +1 (555) 000-0000 · linkedin.com/in/handle · github.com/handle</p>
  </header>

  <section id="summary">
    <h2>Professional Summary</h2>
    <p>2–3 sentences from source only; weave ATS keywords from the job posting where they honestly match the source.</p>
  </section>

  <section id="experience">
    <h2>Professional Experience</h2>
    <div class="job">
      <h3><span class="role">Job Title</span><span class="dash"> — </span><span class="company">Company Name</span></h3>
      <p class="job-meta"><em>Mon YYYY – Mon YYYY · City, ST (Remote/Hybrid/On-site)</em></p>
      <ul>
        <li>Impact-focused bullet with <strong>specific tool/platform names</strong> from source; quantify when metric appears in source.</li>
        <li>Second achievement from source content.</li>
      </ul>
    </div>
  </section>

  <section id="skills">
    <h2>Technical Skills</h2>
    <p class="skills-block"><strong>Languages:</strong> … · <strong>Frameworks:</strong> … · <strong>Cloud &amp; Data:</strong> … · <strong>Tools:</strong> … (include every technology from source; use · separator; never truncate)</p>
  </section>

  <table class="layout-cols" width="100%"><tr>
    <td width="48%" style="vertical-align:top;padding:0;">
      <section id="education">
        <h2>Education</h2>
        <ul>
          <li><strong>Degree, Field</strong> — Institution <em>(Year)</em></li>
        </ul>
      </section>
    </td>
    <td width="4%" style="padding:0;"></td>
    <td width="48%" style="vertical-align:top;padding:0;">
      <section id="certifications">
        <h2>Certifications &amp; Licenses</h2>
        <ul>
          <li>Credential — Issuer <em>(Year)</em></li>
        </ul>
      </section>
    </td>
  </tr></table>
</div>
""".strip()

_TAILORED_RESUME_SYSTEM_HTML = """\
You are Victoria Chen, CPRW (Certified Professional Résumé Writer), with 15 years crafting \
résumés for Fortune 500 candidates, Silicon Valley engineers, and C-suite executives. \
Your résumés pass ATS systems and impress hiring managers because they are factually precise, \
keyword-optimized, and visually tight on the page.

OUTPUT FORMAT: One HTML fragment only — no Markdown, no backticks, no preamble, no commentary. \
Start with <div class="resume" id="resume-root"> and end with </div>. Nothing before or after. \
Allowed tags: div, header, section, table, tr, td, h1, h2, h3, p, ul, li, span, em, strong.

═══ HARD GUARDRAILS — violating any rule invalidates the output ═══

SOURCE-ONLY: Every employer name, job title, date range, degree, institution, certification, \
project, technology, and metric MUST come verbatim from the ORIGINAL RESUME TEXT. \
Never infer, embellish, add, or synthesize facts not explicitly stated in the source.

COMPLETENESS: All roles in the source must appear in the output. All degrees and certifications \
must appear. No employer may be omitted, renamed, or merged with another.

NO FABRICATION: Do not add skills, tools, or accomplishments not stated in the source. \
Do not estimate or round dates. Do not upgrade job titles.

CONTACT INTEGRITY: Use contact details exactly as provided in CANDIDATE CONTEXT. \
Do not construct email addresses or LinkedIn URLs from a name.

SPACE DISCIPLINE: Target one printed A4 page by tightening language — not by dropping sections. \
Compress bullet text; do not delete bullets. Shorten summaries; do not omit roles.

ATS SAFE: No images, no icons, no special separators. Plain Unicode text only inside all tags.\
"""

_TAILORED_RESUME_USER_HTML_HEAD = """Your task: produce a tailored résumé HTML fragment for the TARGET JOB.
Return ONLY the HTML fragment (start with <div class="resume" id="resume-root">, end with </div>).

## ORIGINAL RESUME (source of truth — never invent beyond this)
"""

_TAILORED_RESUME_USER_HTML_TAIL = """
## TARGET JOB (for keyword alignment and summary framing only)
Title: __JOB_TITLE__ at __COMPANY__

__JOB_DESCRIPTION__

## CANDIDATE CONTEXT (populate contact line from here when missing from resume text)
__CANDIDATE_CONTEXT__

## FIT SIGNALS (context only — do not paste into the résumé as-is)
Match score: __SCORE__ / 100
Gap areas: __GAPS__
Keywords to weave in (only where source content supports them): __MISSING_KW__

## INSTRUCTIONS
1. Follow the SKELETON structure exactly — same HTML section IDs and CSS classes.
2. Replace every placeholder with real content from the ORIGINAL RESUME only.
3. Repeat <div class="job">…</div> for each role (most recent first).
4. Omit <section id="education"> entirely if source has no degree/school facts.
5. Omit <section id="certifications"> entirely if source has no certifications.
   Never output these sections with "N/A" or empty lists.
6. skills-block: include every technology from source, use · separator, never truncate.
7. Use the <table class="layout-cols"> for education + certifications as shown in SKELETON.
8. No <style>, <script>, <html>, <head>, or <body> tags.

## SKELETON (follow this structure exactly)
""" + _RESUME_HTML_SKELETON + """

## OUTPUT
Return the filled HTML fragment only. Start immediately with <div class="resume" id="resume-root">.
"""

_COMPACT_RESUME_SYSTEM_HTML = """\
You are Victoria Chen, CPRW. The résumé HTML below is slightly too tall for one A4 page. \
Rewrite it with tighter wording only — shorten sentences and bullets; do not delete any employer, \
role, degree, certification, or skill. Keep every section. Keep the same HTML structure. \
No commentary — output the fragment only.\
"""

_COMPACT_RESUME_USER_HTML = (
    "The résumé HTML below overflows one printed A4 page. Tighten wording only; preserve all facts.\n\n"
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
    custom_instructions: Optional[str] = None,
    extra_context: Optional[str] = None,
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
    body = _TAILORED_RESUME_USER_HTML_HEAD + resume + tail
    if extra_context and extra_context.strip():
        body += f"\n\n## ADDITIONAL CANDIDATE INFORMATION (incorporate where relevant and supported by the above resume)\n{extra_context.strip()}"
    if custom_instructions and custom_instructions.strip():
        body += f"\n\n## USER CUSTOMIZATION INSTRUCTIONS (highest priority — follow exactly)\n{custom_instructions.strip()}"
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
