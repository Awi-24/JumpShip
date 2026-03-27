"""
JumpShip — Resume parser using pdfminer.six + python-docx + LLM extraction.
"""
from __future__ import annotations

import io
import json
import logging

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
        # Fallback: try PyPDF2
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
    system = """You are a resume parser. Extract structured information from the resume text.
Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "name": "string",
  "title": "string (inferred job title/seniority)",
  "skills": ["string"],
  "experience_years": number,
  "domains": ["string (e.g. MLOps, Data Engineering)"],
  "suggested_keywords": ["string (for job search filters)"],
  "suggested_titles": ["string (job titles to search for)"]
}"""

    user = f"Parse this resume:\n\n{text[:4000]}"

    response = await llm.complete(system, user)

    # Try to parse JSON from response
    try:
        # Strip markdown code fences if present
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()

        data = json.loads(cleaned)
        data["raw_text"] = text[:8000]
        return data
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Failed to parse LLM response as JSON: {e}")
        # Return a minimal profile from raw text
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
