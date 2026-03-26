"""
Router for AI-powered resume vs job description analysis.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import Analysis, Resume, SavedJob
from backend.services.ai_evaluator import analyse_resume, generate_tailored_resume
from backend.routers.settings import get_active_provider_key

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class AnalyseRequest(BaseModel):
    job_id: Optional[str] = None
    # OR pass raw data directly (for jobs not yet saved)
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    job_description: Optional[str] = None
    resume_id: Optional[str] = None  # if None, uses the latest resume


class TailoredResumeRequest(BaseModel):
    analysis_id: str


@router.post("")
def analyse(req: AnalyseRequest, db: Session = Depends(get_db)):
    """
    Analyse a resume against a job description using Claude.
    Returns compatibility score, strengths, gaps and suggestions.
    """
    # Get resume
    if req.resume_id:
        resume = db.query(Resume).filter(Resume.id == req.resume_id).first()
    else:
        resume = db.query(Resume).order_by(Resume.uploaded_at.desc()).first()

    if not resume:
        raise HTTPException(
            status_code=404,
            detail="No resume found. Please upload your resume first.",
        )

    # Get job data
    job_title = req.job_title or ""
    company_name = req.company_name or ""
    job_description = req.job_description or ""

    if req.job_id:
        saved_job = db.query(SavedJob).filter(SavedJob.id == req.job_id).first()
        if not saved_job:
            raise HTTPException(status_code=404, detail="Saved job not found.")
        job_title = job_title or saved_job.title or ""
        company_name = company_name or saved_job.company_name or ""
        job_description = job_description or saved_job.description or ""

    if not job_description:
        raise HTTPException(
            status_code=400,
            detail="Job description is required for analysis.",
        )

    # Check if analysis already exists for this job+resume combo
    if req.job_id:
        existing = (
            db.query(Analysis)
            .filter(Analysis.job_id == req.job_id, Analysis.resume_id == resume.id)
            .order_by(Analysis.analyzed_at.desc())
            .first()
        )
        if existing:
            return _analysis_to_dict(existing)

    # Get active AI provider and key from settings
    try:
        provider, api_key = get_active_provider_key(db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Run AI analysis
    try:
        result = analyse_resume(
            resume_text=resume.content,
            job_description=job_description,
            job_title=job_title,
            company_name=company_name,
            provider=provider,
            api_key=api_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Persist analysis
    analysis = Analysis(
        id=str(uuid.uuid4()),
        job_id=req.job_id or "",
        resume_id=resume.id,
        job_title=job_title,
        company_name=company_name,
        score=result.get("score", 0),
        strengths=result.get("strengths", []),
        gaps=result.get("gaps", []),
        suggestions=result.get("suggestions", []),
        summary=result.get("summary", ""),
        keywords_matched=result.get("keywords_matched", []),
        keywords_missing=result.get("keywords_missing", []),
        tailored_resume=None,
        provider=provider,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return _analysis_to_dict(analysis)


@router.post("/tailored-resume")
def create_tailored_resume(req: TailoredResumeRequest, db: Session = Depends(get_db)):
    """
    Generate a tailored version of the resume based on an existing analysis.
    """
    analysis = db.query(Analysis).filter(Analysis.id == req.analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    if analysis.tailored_resume:
        return {"analysis_id": analysis.id, "tailored_resume": analysis.tailored_resume}

    resume = db.query(Resume).filter(Resume.id == analysis.resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found.")

    # Retrieve job description
    job_description = ""
    if analysis.job_id:
        saved_job = db.query(SavedJob).filter(SavedJob.id == analysis.job_id).first()
        if saved_job:
            job_description = saved_job.description or ""

    if not job_description:
        raise HTTPException(
            status_code=400,
            detail="Job description is required to generate a tailored resume.",
        )

    try:
        provider, api_key = get_active_provider_key(db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        tailored = generate_tailored_resume(
            resume_text=resume.content,
            job_description=job_description,
            job_title=analysis.job_title or "",
            company_name=analysis.company_name or "",
            analysis={
                "score": analysis.score,
                "gaps": analysis.gaps or [],
                "keywords_missing": analysis.keywords_missing or [],
            },
            provider=provider,
            api_key=api_key,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    analysis.tailored_resume = tailored
    db.commit()

    return {"analysis_id": analysis.id, "tailored_resume": tailored}


@router.get("/{analysis_id}")
def get_analysis(analysis_id: str, db: Session = Depends(get_db)):
    """Return a previously computed analysis."""
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return _analysis_to_dict(analysis)


@router.get("/job/{job_id}")
def get_analysis_by_job(job_id: str, db: Session = Depends(get_db)):
    """Return the latest analysis for a saved job."""
    analysis = (
        db.query(Analysis)
        .filter(Analysis.job_id == job_id)
        .order_by(Analysis.analyzed_at.desc())
        .first()
    )
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found for this job.")
    return _analysis_to_dict(analysis)


def _analysis_to_dict(a: Analysis) -> dict:
    return {
        "id": a.id,
        "job_id": a.job_id,
        "resume_id": a.resume_id,
        "job_title": a.job_title,
        "company_name": a.company_name,
        "score": a.score,
        "summary": a.summary,
        "strengths": a.strengths or [],
        "gaps": a.gaps or [],
        "suggestions": a.suggestions or [],
        "keywords_matched": a.keywords_matched or [],
        "keywords_missing": a.keywords_missing or [],
        "has_tailored_resume": bool(a.tailored_resume),
        "analyzed_at": a.analyzed_at.isoformat() if a.analyzed_at else None,
    }
