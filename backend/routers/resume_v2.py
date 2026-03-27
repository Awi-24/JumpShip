"""
JumpShip v2 — Resume parsing endpoint (no DB, session-only).
POST /api/resume/parse → returns ResumeProfile JSON
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File

from backend.models.schemas import ResumeProfile
from backend.services.llm_service import get_llm_service
from backend.services.resume_parser_v2 import extract_text, parse_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume", tags=["resume-v2"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/parse", response_model=ResumeProfile)
async def parse_resume_endpoint(file: UploadFile = File(...)):
    """
    Upload a résumé (PDF or DOCX), extract text, and use the LLM
    to return a structured ResumeProfile. Nothing is persisted.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    lower = file.filename.lower()
    if not (lower.endswith(".pdf") or lower.endswith(".docx")):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a PDF or DOCX.",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Max 10 MB.")

    # Extract raw text
    try:
        text = await extract_text(content, file.filename)
    except Exception as e:
        logger.error(f"Text extraction failed: {e}")
        raise HTTPException(status_code=422, detail=f"Could not extract text: {e}")

    if not text.strip():
        raise HTTPException(status_code=422, detail="No text found in the file.")

    # Parse with LLM
    llm = get_llm_service()
    try:
        profile_data = await parse_profile(text, llm)
        return ResumeProfile(**profile_data)
    except Exception as e:
        logger.error(f"LLM profile parsing failed: {e}")
        # Return a minimal profile with just the raw text
        return ResumeProfile(raw_text=text[:8000])
