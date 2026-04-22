"""
JumpShip — Tailored resume generation endpoint.

POST /api/resume/generate  →  PDF download
GET  /api/resume/generated →  list of previously generated resumes
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import GeneratedResume, UserProfile
from backend.models.schemas import JobResult, ResumeProfile, JobAssessment
from backend.services.llm_client import LLMClient, get_local_sem, is_local_provider
from backend.services.resume_generator import generate_pdf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume", tags=["resume-generation"])


class GenerateResumeRequest(BaseModel):
    job: JobResult
    resume_profile: ResumeProfile
    assessment: Optional[dict] = None
    # Optional LLM override (provider / model / key / base_url)
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None


class GeneratedResumeItem(BaseModel):
    id: str
    job_title: str
    company: str
    match_score: int
    provider: str
    model: str
    pdf_path: str
    created_at: str


@router.post("/generate")
async def generate_resume(
    req: GenerateResumeRequest,
    db: Session = Depends(get_db),
):
    """
    Generate a tailored resume PDF for a specific job.

    - LLM produces HTML (ATS-oriented template) tailored to the job + assessment gaps
    - HTML is converted to a styled single-page PDF via xhtml2pdf
    - Returns the PDF as a file download
    - Stores metadata in `generated_resumes` table
    """
    if not req.resume_profile.raw_text:
        raise HTTPException(
            status_code=400,
            detail="Resume text is required. Please upload and parse your resume first.",
        )
    if not req.job.description:
        raise HTTPException(
            status_code=400,
            detail="Job description is missing — cannot generate a tailored resume.",
        )

    client = LLMClient.from_override(req)

    # Load user profile for contact info + prefs to enrich the resume
    user_profile_row = db.query(UserProfile).first()
    user_profile = {}
    if user_profile_row:
        user_profile = {
            c.name: getattr(user_profile_row, c.name)
            for c in UserProfile.__table__.columns
            if getattr(user_profile_row, c.name) is not None
        }

    async def _generate():
        return await asyncio.to_thread(
            generate_pdf,
            resume_text=req.resume_profile.raw_text,
            job_title=req.job.title,
            company_name=req.job.company,
            job_description=req.job.description,
            assessment=req.assessment,
            client=client,
            user_profile=user_profile,
        )

    try:
        if is_local_provider(client.provider):
            async with get_local_sem():
                pdf_path, md_text = await _generate()
        else:
            pdf_path, md_text = await _generate()
    except Exception as exc:
        logger.error("Resume generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Resume generation failed: {exc}")

    # Persist metadata
    score = (req.assessment or {}).get("score", 0) or (req.assessment or {}).get("match_score", 0)
    record = GeneratedResume(
        job_id=req.job.id or "",
        job_title=req.job.title,
        company=req.job.company,
        match_score=int(score),
        markdown=md_text,
        pdf_path=str(pdf_path),
        provider=client.provider,
        model=client._resolve_model(),
    )
    db.add(record)
    db.commit()

    filename = pdf_path.name
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=filename,
        headers={"X-Generated-Resume-Id": record.id},
    )


@router.get("/generated", response_model=list[GeneratedResumeItem])
def list_generated_resumes(db: Session = Depends(get_db)):
    """Return all previously generated resumes (metadata only, no file content)."""
    rows = db.query(GeneratedResume).order_by(GeneratedResume.created_at.desc()).all()
    return [
        GeneratedResumeItem(
            id=r.id,
            job_title=r.job_title,
            company=r.company,
            match_score=r.match_score,
            provider=r.provider,
            model=r.model,
            pdf_path=r.pdf_path,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.get("/generated/{resume_id}/download")
def download_generated_resume(resume_id: str, db: Session = Depends(get_db)):
    """Re-download a previously generated resume PDF."""
    row = db.query(GeneratedResume).filter(GeneratedResume.id == resume_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Generated resume not found.")
    pdf = Path(row.pdf_path)
    if not pdf.exists():
        raise HTTPException(status_code=404, detail="PDF file no longer on disk.")
    return FileResponse(
        path=str(pdf),
        media_type="application/pdf",
        filename=pdf.name,
    )
