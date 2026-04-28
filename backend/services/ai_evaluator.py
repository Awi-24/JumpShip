"""
JumpShip — Job evaluator and resume tailoring.

Uses LLMClient for all provider calls — provider-agnostic.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

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

  <!-- OPTIONAL: include this section ONLY if <additional_candidate_info> lists projects or side work -->
  <section id="projects">
    <h2>Projects &amp; Open Source</h2>
    <div class="job">
      <h3><span class="role">Project Name</span></h3>
      <p class="job-meta"><em>Technology stack · github.com/handle/repo (optional)</em></p>
      <ul>
        <li>What it does and the impact or scale — include tech keywords matching the job posting.</li>
      </ul>
    </div>
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
You are a Senior Career Engineer and ATS Algorithm Specialist.

⚠️ FAILURE MODE TO AVOID ⚠️
If your output reads like a near-verbatim copy of the original resume — same bullet wording, \
same order, same emphasis — YOU HAVE FAILED THE TASK. The candidate already has that resume; \
they need a TARGETED REWRITE for THIS specific job. A successful output will have:
- Different bullet phrasing (using job's vocabulary)
- Different bullet ordering (job-relevant first)
- Different visual weight (matching roles expanded; off-target roles compressed to 1 line)
- Skills section reordered with target tech first
- Keywords from the job surfaced via rewrites where source supports them

REWRITE BUDGET: at least 60% of bullets MUST be reworded. Anything less means you played it \
too safe. Reword phrasing, change verbs, restructure sentence shape — while preserving facts.

Your mission: AGGRESSIVELY TAILOR the provided resume to the target job — reorder, rewrite, \
de-emphasize, and emphasize content so that a recruiter sees the strongest fit on first scan. \
Stay truthful on facts, but be bold on framing.

<concrete_example>
Source bullet: "Worked with Python and helped build APIs for the team."
Target job mentions: "FastAPI", "REST API design", "high-throughput services".

❌ WRONG (verbatim): "Worked with Python and helped build APIs for the team."
✅ RIGHT (rewritten): "Designed and shipped REST APIs in Python (FastAPI), supporting \
high-throughput services for the engineering team."

Notice: same fact (Python + APIs), but reframed in the job's vocabulary, stronger verb, \
clearer scope. THAT is the level of rewriting expected on every relevant bullet.
</concrete_example>

<strict_guidelines>
1. FACT INTEGRITY (not "zero edit"): Never invent employers, job titles, dates, companies, degrees, \
   institutions, certifications, or quantitative metrics that are not in (a) ORIGINAL RESUME or \
   (b) ADDITIONAL CANDIDATE INFO. Everything else — phrasing, ordering, emphasis, bullet wording, \
   skill grouping, keyword nomenclature — IS yours to refactor.
2. INFERENCE IS ALLOWED: If a bullet says "built REST API in Python" and the job asks for "FastAPI", \
   you may write "built REST API in Python (FastAPI-style framework)" only if the source mentions \
   FastAPI somewhere. If not, do NOT add the framework name. But you CAN reframe generic phrases \
   into the job's vocabulary when the underlying skill is clearly evidenced.
3. ADDITIONAL CANDIDATE INFO is first-class source — projects, side work, certs, open-source MUST \
   be incorporated (Projects section, Skills extension, or bullet under a relevant role).
4. IMPACT ENGINEERING (STAR): Every kept bullet must follow [Strong Verb] + [What] + [Tech] + \
   [Quantifiable result]. Rewrite weak bullets aggressively. Drop empty adjectives.
5. ATS NOMENCLATURE: Match the job's exact wording for skills the candidate genuinely has \
   (job says "React.js" → use "React.js" not "React"; job says "AWS Lambda" → use "AWS Lambda" \
   not "serverless functions"). Only when source supports the underlying skill.
</strict_guidelines>

<tailoring_directives>
Use the FIT SIGNALS (score, gaps, keywords_missing) actively:

A. REORDER — within each role, lead with the bullet most relevant to the target job. Within \
   experience section, keep chronological order BUT promote the most-aligned role visually \
   (longer bullets, more detail). Skills section: list job-relevant tech FIRST.
B. EMPHASIZE — for roles/projects that match the job, expand to 3–5 strong bullets. Surface \
   metrics and tech keywords that exist in source but were buried.
C. DE-EMPHASIZE — roles/projects unrelated to the target job MAY be compressed to 1 line \
   (title + employer + 1 short bullet) instead of dropped. Old internships, irrelevant side jobs: \
   compress hard. NEVER delete a role outright — just shrink it.
D. REWRITE — rephrase bullets to use the job's vocabulary where source supports it. Example: \
   source "wrote scripts to deploy services" + job mentions "CI/CD" → rewrite as \
   "automated CI/CD deployment pipelines" IF source elsewhere shows CI tools.
E. CLOSE GAPS HONESTLY — for each `keywords_missing` item, scan source thoroughly. If anything \
   in source genuinely supports it (even if phrased differently), surface it via rewrite. If \
   source has nothing, do NOT add it.
F. CUT FILLER — long generic descriptions, "responsible for...", duplicated tech mentions, \
   summary statements with no substance.
</tailoring_directives>

<output_format>
You MUST use these FOUR XML tags in your response — in this exact order:

<analise_ats>
List the top 10 technical keywords and required skills from the job description.
</analise_ats>

<mapeamento_de_verdade>
Cross-reference each keyword with the original resume AND additional candidate info. For each: \
FOUND-direct / FOUND-inferable (source supports it under different wording) / ABSENT (must not be added).
</mapeamento_de_verdade>

<curriculo_otimizado>
[HTML fragment only — start with <div class="resume" id="resume-root"> and end with </div>]
[No markdown, no backticks, no prose before or after the HTML]
Allowed tags: div, header, section, table, tr, td, h1, h2, h3, p, ul, li, span, em, strong.
</curriculo_otimizado>

<changes_summary>
Bullet list of concrete changes made:
- KEPT: <items kept verbatim or near-verbatim>
- IMPROVED: <bullets/sections rewritten — note source phrase → new phrase>
- EMPHASIZED: <roles/projects expanded for fit>
- DE-EMPHASIZED: <roles/projects compressed because off-target>
- KEYWORDS SURFACED: <missing keywords now visible because source supports them>
</changes_summary>
</output_format>

═══ HARD GUARDRAILS ═══
FACT-ONLY: Employers, job titles, dates, degrees, institutions, certifications, and quantitative \
metrics MUST come verbatim from source. Phrasing/structure/emphasis is yours to change.
ADDITIONAL INFO INCLUSION: If <additional_candidate_info> exists, you MUST include that content.
ROLE PRESERVATION: All roles, degrees, and certifications in the source must APPEAR in the output \
— but irrelevant ones MAY be compressed to a single line. Never delete a role outright.
CONTACT INTEGRITY: Use contact details exactly as provided in CANDIDATE CONTEXT.
SPACE DISCIPLINE: Target one printed A4 page via reordering + compression of irrelevant content + \
tighter language — in that priority order.
ATS SAFE: No images, no icons. Plain Unicode text only inside all tags.\
"""

_TAILORED_RESUME_USER_HTML_HEAD = """<job_description>
__JOB_TITLE_LINE__

__JOB_DESCRIPTION__
</job_description>

<original_resume>
"""

_TAILORED_RESUME_USER_HTML_TAIL = """
</original_resume>

<candidate_context>
__CANDIDATE_CONTEXT__
</candidate_context>

<fit_signals>
Match score: __SCORE__ / 100
Gap areas: __GAPS__
Keywords to weave in (only where source content supports them): __MISSING_KW__
</fit_signals>

<html_instructions>
1. Follow the SKELETON structure exactly — same HTML section IDs and CSS classes.
2. Replace every placeholder with real content from ORIGINAL RESUME or ADDITIONAL CANDIDATE INFO.
3. Repeat <div class="job">…</div> for each role (most recent first).
4. Include <section id="projects"> if <additional_candidate_info> lists any projects, side work, or open-source. Omit if no project data exists.
5. Omit <section id="education"> entirely if source has no degree/school facts.
6. Omit <section id="certifications"> entirely if source has no certifications. Never output empty sections.
7. skills-block: include every technology from source AND from additional candidate info; ORDER them by relevance to the job (matching tech first); use · separator.
8. Use the <table class="layout-cols"> for education + certifications as shown in SKELETON.
9. No <style>, <script>, <html>, <head>, or <body> tags.
</html_instructions>

<skeleton>
""" + _RESUME_HTML_SKELETON + """
</skeleton>

Execute all steps. Return the three XML tags (<analise_ats>, <mapeamento_de_verdade>, <curriculo_otimizado>).
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
    job_title_line = f"Title: {job_title} at {company_name}" if job_title or company_name else ""
    head = (
        _TAILORED_RESUME_USER_HTML_HEAD
        .replace("__JOB_TITLE_LINE__", job_title_line)
        .replace("__JOB_DESCRIPTION__", job_description or "")
    )
    tail = (
        _TAILORED_RESUME_USER_HTML_TAIL
        .replace("__CANDIDATE_CONTEXT__", candidate_context or "")
        .replace("__SCORE__", str(score))
        .replace("__GAPS__", gaps or "N/A")
        .replace("__MISSING_KW__", missing_keywords or "N/A")
    )
    body = head + resume + tail
    if extra_context and extra_context.strip():
        body += (
            f"\n\n<additional_candidate_info>\n"
            f"{extra_context.strip()}\n"
            f"(Incorporate where relevant and supported by the resume above.)\n"
            f"</additional_candidate_info>"
        )
    if custom_instructions and custom_instructions.strip():
        body += (
            f"\n\n<custom_instructions priority=\"highest\">\n"
            f"{custom_instructions.strip()}\n"
            f"</custom_instructions>"
        )
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
