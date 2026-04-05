"""
JumpShip — Resume parser using pdfminer.six + python-docx + LLM extraction.
"""
from __future__ import annotations

import io
import json
import logging
import re

logger = logging.getLogger(__name__)


async def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract plain text from PDF or DOCX bytes."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return _extract_pdf(file_bytes)
    elif lower.endswith(".docx"):
        return _extract_docx(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: {filename}")


def _extract_pdf(data: bytes) -> str:
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
        return pdfminer_extract(io.BytesIO(data))
    except ImportError:
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            raise ImportError("Install pdfminer.six or PyPDF2 for PDF parsing")


def _extract_docx(data: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        raise ImportError("Install python-docx for DOCX parsing")


async def parse_profile(text: str, llm) -> dict:
    """Use the LLM to extract a structured profile from resume text."""

    system = """\
You are an expert technical recruiter and resume parser with 15+ years of experience.
Your task is to extract a precise, structured professional profile from a resume.

CRITICAL RULES:
1. Return ONLY valid JSON — no markdown fences, no explanation, no commentary.
2. "suggested_keywords" must be SPECIFIC and SEARCH-READY — these are terms a recruiter would type
   into a job board. Include: core technologies, frameworks, methodologies, seniority level, and domain.
   Examples: "Python backend", "React TypeScript", "MLOps Kubernetes", "Staff Engineer", "fintech SaaS"
3. "suggested_titles" must reflect actual job titles the candidate could apply for, ordered by best fit.
4. "skills" must be specific (e.g. "FastAPI" not just "web frameworks", "PostgreSQL" not just "databases").
5. Infer seniority from experience_years, job titles held, and complexity of responsibilities.
6. If information is missing or unclear, use an empty array or 0 — never guess wildly.

OUTPUT SCHEMA (strict):
{
  "name": "Full Name",
  "title": "Inferred current/most recent title + seniority (e.g. Senior ML Engineer)",
  "skills": ["list of specific technical and soft skills, max 20"],
  "experience_years": <integer: total years of relevant professional experience>,
  "domains": ["business domains: e.g. FinTech, E-commerce, MLOps, Data Engineering, DevOps"],
  "suggested_keywords": ["8-15 search-ready terms combining role+tech+domain"],
  "suggested_titles": ["5-8 exact job titles to search for, ordered by best fit"]
}"""

    user = f"""\
Parse the following resume and return the structured JSON profile.
Focus on extracting actionable search keywords that will find relevant job listings.

RESUME:
{text[:5000]}"""

    response = await llm.complete(system, user)

    try:
        cleaned = _clean_json_response(response)
        data = json.loads(cleaned)
        data["raw_text"] = text[:8000]

        # Validate and sanitise fields
        data.setdefault("name", "")
        data.setdefault("title", "")
        data.setdefault("skills", [])
        data.setdefault("experience_years", 0)
        data.setdefault("domains", [])
        data.setdefault("suggested_keywords", [])
        data.setdefault("suggested_titles", [])

        # Ensure lists are actually lists
        for field in ("skills", "domains", "suggested_keywords", "suggested_titles"):
            if not isinstance(data[field], list):
                data[field] = []

        # Normalize suggested_keywords: split camelCase, lowercase, deduplicate,
        # reject anything longer than 3 words (too specific for job board search).
        data["suggested_keywords"] = _normalize_keywords(data["suggested_keywords"])

        return data

    except (json.JSONDecodeError, KeyError) as exc:
        logger.error("Failed to parse LLM response as JSON: %s | response: %s", exc, response[:300])
        return {
            "name": "",
            "title": "",
            "skills": [],
            "experience_years": 0,
            "domains": [],
            "suggested_keywords": [],
            "suggested_titles": [],
            "raw_text": text[:8000],
        }


def _normalize_keywords(keywords: list) -> list:
    """
    Post-process LLM-generated keywords:
    - Split camelCase/PascalCase into words (e.g. "MachineLearning" → "machine learning")
    - Lowercase everything
    - Strip leading/trailing whitespace
    - Drop keywords longer than 3 words (too narrow for job board queries)
    - Deduplicate (case-insensitive)
    """
    import re

    def split_camel(s: str) -> str:
        # Insert space before uppercase letters preceded by lowercase or digits
        s = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', s)
        # Insert space before sequences of uppercase followed by lowercase (e.g. "RESTApi" → "REST Api")
        s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', s)
        return s

    seen: set[str] = set()
    result: list[str] = []
    for kw in keywords:
        if not isinstance(kw, str):
            continue
        normalized = split_camel(kw).strip().lower()
        # Remove duplicate internal spaces
        normalized = re.sub(r'\s+', ' ', normalized)
        # Drop if > 3 words
        if len(normalized.split()) > 3:
            continue
        # Drop if empty or too short
        if len(normalized) < 2:
            continue
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _clean_json_response(response: str) -> str:
    """Strip markdown fences and whitespace from an LLM JSON response."""
    cleaned = response.strip()

    # Remove ```json ... ``` or ``` ... ```
    if cleaned.startswith("```"):
        # Remove opening fence line
        cleaned = re.sub(r'^```[a-zA-Z]*\n?', '', cleaned)
        # Remove closing fence
        cleaned = re.sub(r'\n?```\s*$', '', cleaned)
        cleaned = cleaned.strip()

    # Handle rare "json\n{...}" without fences
    if cleaned.lower().startswith("json"):
        cleaned = cleaned[4:].strip()

    return cleaned
