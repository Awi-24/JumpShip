"""
JumpShip v2 — Resume parsing endpoint (no DB, session-only).
POST /api/resume/parse → returns ResumeProfile JSON
Accepts optional LLM override fields as multipart form data alongside the file.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional

from backend.models.schemas import ResumeProfile
from backend.services.llm_client import LLMClient
from backend.services.resume_parser_v2 import extract_text, parse_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume", tags=["resume-v2"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/parse", response_model=ResumeProfile)
async def parse_resume_endpoint(
    file: UploadFile = File(...),
    llm_provider: Optional[str] = Form(default=None),
    llm_model: Optional[str] = Form(default=None),
    llm_base_url: Optional[str] = Form(default=None),
    llm_api_key: Optional[str] = Form(default=None),
):
    """
    Upload a résumé (PDF or DOCX), extract text, and use the LLM
    to return a structured ResumeProfile. Nothing is persisted.
    LLM override fields can be sent as additional form fields.
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

    # Build provider-agnostic LLM client
    from backend.config import settings as cfg
    provider = llm_provider or cfg.llm_provider
    # Only fall back to cfg.ollama_base_url for ollama; other providers have their own defaults
    effective_base_url = llm_base_url or (cfg.ollama_base_url if provider == "ollama" else None)
    llm = LLMClient(
        provider=provider,
        model=llm_model or cfg.llm_model,
        api_key=llm_api_key or "",
        base_url=effective_base_url or None,
    )

    logger.info(
        "Resume parse request: provider=%s model=%s text_len=%d",
        llm.provider, llm._resolve_model(), len(text),
    )
    logger.debug("Extracted text preview:\n%s", text[:500])

    try:
        profile_data = await parse_profile(text, llm)
        logger.info(
            "Resume parse OK: keywords=%d titles=%d skills=%d",
            len(profile_data.get("suggested_keywords", [])),
            len(profile_data.get("suggested_titles", [])),
            len(profile_data.get("skills", [])),
        )
        return ResumeProfile(**profile_data)
    except Exception as e:
        logger.error("LLM profile parsing failed: %s", e)
        return ResumeProfile(raw_text=text[:8000])
