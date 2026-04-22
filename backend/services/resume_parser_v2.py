"""
JumpShip — Resume parser using pdfminer.six + python-docx + LLM extraction.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re

logger = logging.getLogger(__name__)


def _clean_text(text: str) -> str:
    """Remove PDF artefacts and normalize whitespace for LLM consumption."""
    # Replace form feeds and other control chars with newlines
    text = text.replace('\f', '\n').replace('\r', '\n')
    # Replace non-breaking spaces and other unicode spaces
    text = re.sub(r'[\xa0\u2000-\u200b\u202f\u3000]', ' ', text)
    # Collapse 3+ consecutive newlines into 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Collapse multiple spaces into one
    text = re.sub(r' {2,}', ' ', text)
    # Strip each line
    lines = [line.strip() for line in text.splitlines()]
    # Remove lines that are pure noise (very short, only symbols)
    lines = [l for l in lines if len(l) > 1 or l.isalpha()]
    return '\n'.join(lines).strip()


async def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract and clean plain text from PDF or DOCX bytes."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        raw = _extract_pdf(file_bytes)
    elif lower.endswith(".docx"):
        raw = _extract_docx(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: {filename}")
    return _clean_text(raw)


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
You are an expert technical recruiter parsing a resume for a Brazilian job platform.
Extract a structured profile and generate bilingual job search keywords.

CRITICAL RULES:
1. Return ONLY valid JSON — no markdown fences, no explanation, no commentary.
2. "suggested_keywords" = job titles the candidate should search for, in BOTH Portuguese AND English.
   Include the same role in both languages. Keep each entry to 2-5 words.
   Examples: ["Engenheiro de Dados", "Data Engineer", "Desenvolvedor Python", "Python Developer",
              "Engenheiro MLOps", "MLOps Engineer", "Cientista de Dados Sênior", "Senior Data Scientist"]
3. "suggested_titles" = same list but English-only, ordered by best fit (used as display labels).
4. "skills" = specific tools/technologies only (e.g. "FastAPI", "PostgreSQL", "React", "Kubernetes").
5. Infer seniority (Júnior/Pleno/Sênior or Junior/Mid/Senior) from years of experience and job titles.
6. Use empty array [] or 0 for missing fields — never invent information.

OUTPUT SCHEMA (strict — no extra keys):
{
  "name": "Full Name",
  "title": "Current/most recent role with seniority level in English",
  "skills": ["up to 20 specific technologies and tools"],
  "experience_years": <integer>,
  "domains": ["industry domains, e.g. FinTech, E-commerce, Data Engineering, GenAI"],
  "suggested_keywords": ["10-20 bilingual job titles: alternate PT and EN versions of each role"],
  "suggested_titles": ["5-8 English job titles ordered by best fit"]
}"""

    user = f"""\
Parse this resume. Return ONLY the JSON object, nothing else.

RESUME:
{text[:5000]}"""

    if asyncio.iscoroutinefunction(llm.complete):
        response = await llm.complete(system, user)
    else:
        response = await asyncio.to_thread(llm.complete, system, user)

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

        # Deduplicate keywords; also merge suggested_titles as fallback
        kw = _dedup_keywords(data["suggested_keywords"])
        if not kw:
            kw = _dedup_keywords(data["suggested_titles"])
        data["suggested_keywords"] = kw

        return data

    except (json.JSONDecodeError, KeyError) as exc:
        logger.error(
            "Resume JSON parse failed: %s\n--- LLM raw response (first 800 chars) ---\n%s\n---",
            exc, response[:800],
        )
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


def _dedup_keywords(keywords: list) -> list:
    """Deduplicate and clean job title keywords. Preserves original casing and allows multi-word titles."""
    seen: set[str] = set()
    result: list[str] = []
    for kw in keywords:
        if not isinstance(kw, str):
            continue
        cleaned = re.sub(r'\s+', ' ', kw.strip())
        if len(cleaned) < 2:
            continue
        key = cleaned.lower()
        if key not in seen:
            seen.add(key)
            result.append(cleaned)
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
