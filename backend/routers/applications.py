"""
Router for job application tracking.
"""
from __future__ import annotations

import uuid
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import Application, SavedJob

router = APIRouter(prefix="/api/applications", tags=["applications"])

VALID_STATUSES = ["saved", "applying", "applied", "interviewing", "offered", "rejected"]


# ── Schemas ──────────────────────────────────────────────────────────────────


class CreateApplicationRequest(BaseModel):
    job_id: Optional[str] = None
    job_title: str
    company_name: Optional[str] = None
    job_url: Optional[str] = None
    site: Optional[str] = None
    notes: Optional[str] = None
    analysis_id: Optional[str] = None
    status: Optional[str] = "saved"
    is_easy_apply: Optional[bool] = False
    assessment_data: Optional[dict] = None
    match_score: Optional[int] = None
    job_description: Optional[str] = None


class UpdateStatusRequest(BaseModel):
    status: str
    notes: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("")
def list_applications(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all tracked applications, optionally filtered by status."""
    q = db.query(Application)
    if status:
        q = q.filter(Application.status == status)
    apps = q.order_by(Application.created_at.desc()).all()
    return {"applications": [_app_to_dict(a) for a in apps], "count": len(apps)}


@router.post("")
def create_application(req: CreateApplicationRequest, db: Session = Depends(get_db)):
    """Create a new application record (optionally linked to a saved job)."""
    # If job_id given, enrich from saved job
    job_title = req.job_title
    company_name = req.company_name
    job_url = req.job_url
    site = req.site

    if req.job_id:
        saved = db.query(SavedJob).filter(SavedJob.id == req.job_id).first()
        if saved:
            job_title = job_title or saved.title
            company_name = company_name or saved.company_name
            job_url = job_url or saved.job_url
            site = site or saved.site

    # Prevent duplicates
    existing = (
        db.query(Application)
        .filter(Application.job_id == req.job_id, Application.job_url == job_url)
        .first()
        if req.job_id
        else None
    )
    if existing:
        return {"message": "Application already exists", "id": existing.id, "already_existed": True}

    initial_status = req.status if req.status in VALID_STATUSES else "saved"
    app = Application(
        id=str(uuid.uuid4()),
        job_id=req.job_id,
        job_title=job_title,
        company_name=company_name,
        job_url=job_url,
        site=site,
        notes=req.notes,
        analysis_id=req.analysis_id,
        status=initial_status,
        is_easy_apply=req.is_easy_apply or False,
        assessment_data=req.assessment_data,
        match_score=req.match_score,
        job_description=req.job_description,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return {"message": "Application created", "id": app.id, "already_existed": False}


@router.put("/{application_id}/status")
def update_status(
    application_id: str,
    req: UpdateStatusRequest,
    db: Session = Depends(get_db),
):
    """Update the status of an application."""
    if req.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{req.status}'. Valid: {', '.join(VALID_STATUSES)}",
        )

    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found.")

    app.status = req.status
    if req.notes:
        app.notes = req.notes
    if req.status == "applied":
        app.applied_at = datetime.utcnow()

    db.commit()
    db.refresh(app)
    return _app_to_dict(app)


@router.delete("/{application_id}")
def delete_application(application_id: str, db: Session = Depends(get_db)):
    """Remove an application record."""
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found.")
    db.delete(app)
    db.commit()
    return {"message": "Application deleted"}


@router.get("/stats/summary")
def get_stats(db: Session = Depends(get_db)):
    """Return a summary count by status for the dashboard."""
    apps = db.query(Application).all()
    counts: dict = {s: 0 for s in VALID_STATUSES}
    for a in apps:
        if a.status in counts:
            counts[a.status] += 1
    return {"total": len(apps), "by_status": counts}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _app_to_dict(a: Application) -> dict:
    return {
        "id": a.id,
        "job_id": a.job_id,
        "job_title": a.job_title,
        "company_name": a.company_name,
        "job_url": a.job_url,
        "site": a.site,
        "status": a.status,
        "is_easy_apply": bool(a.is_easy_apply),
        "notes": a.notes,
        "analysis_id": a.analysis_id,
        "assessment_data": a.assessment_data,
        "match_score": a.match_score,
        "job_description": a.job_description,
        "applied_at": a.applied_at.isoformat() if a.applied_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
