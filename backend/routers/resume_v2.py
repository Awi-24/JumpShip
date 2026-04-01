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
from backend.services.llm_service import LLMService, get_llm_service
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

    # Build LLM service — use per-request override if provided, else server defaults
    from backend.config import settings

    provider = llm_provider or settings.llm_provider
    model = llm_model or settings.llm_model
    base_url = llm_base_url or settings.ollama_base_url

    if llm_api_key:
        openai_key    = llm_api_key if provider == "openai"    else settings.openai_api_key
        anthropic_key = llm_api_key if provider == "anthropic" else settings.anthropic_api_key
        groq_key      = llm_api_key if provider == "groq"      else settings.groq_api_key
    else:
        openai_key    = settings.openai_api_key
        anthropic_key = settings.anthropic_api_key
        groq_key      = settings.groq_api_key

    llm = LLMService(
        provider=provider,
        model=model,
        ollama_base_url=base_url,
        openai_api_key=openai_key,
        anthropic_api_key=anthropic_key,
        groq_api_key=groq_key,
    )

    try:
        profile_data = await parse_profile(text, llm)
        return ResumeProfile(**profile_data)
    except Exception as e:
        logger.error(f"LLM profile parsing failed: {e}")
        # Return a minimal profile with just the raw text so the UI still works
        return ResumeProfile(raw_text=text[:8000])
