"""
Router for job search and saved jobs management.
"""
from __future__ import annotations

import uuid
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import SavedJob
from backend.services.job_scraper_v2 import search_jobs

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


# ── Pydantic schemas ────────────────────────────────────────────────────────


class JobSearchRequest(BaseModel):
    sites: List[str] = ["indeed", "linkedin"]
    search_term: str
    location: str = ""
    distance: int = 50
    is_remote: bool = False
    job_type: Optional[str] = None
    easy_apply: Optional[bool] = None
    results_wanted: int = 20
    country_indeed: str = "usa"
    hours_old: Optional[int] = None


class SaveJobRequest(BaseModel):
    title: str
    company_name: Optional[str] = None
    job_url: str
    job_url_direct: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_country: Optional[str] = None
    description: Optional[str] = None
    job_type: Optional[str] = None
    is_remote: Optional[bool] = None
    min_salary: Optional[float] = None
    max_salary: Optional[float] = None
    salary_interval: Optional[str] = None
    currency: Optional[str] = None
    site: Optional[str] = None
    company_industry: Optional[str] = None
    job_level: Optional[str] = None
    company_logo: Optional[str] = None
    date_posted: Optional[str] = None
    easy_apply: Optional[bool] = None
    raw_data: Optional[dict] = None


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.post("/search")
async def search(req: JobSearchRequest):
    """
    Scrape jobs from the requested sites and return results.
    Results are NOT automatically saved — use /save to persist a job.
    """
    try:
        location = "Remote" if req.is_remote else (req.location or "Remote")
        jobs = await search_jobs(
            keywords=[req.search_term] if req.search_term else [],
            location=location,
            job_type=req.job_type or "fulltime",
            sites=req.sites,
            results_wanted=req.results_wanted,
        )
        return {"jobs": jobs, "count": len(jobs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save")
def save_job(req: SaveJobRequest, db: Session = Depends(get_db)):
    """Save a job to the local database."""
    # Check for duplicate URL
    existing = db.query(SavedJob).filter(SavedJob.job_url == req.job_url).first()
    if existing:
        return {"message": "Job already saved", "id": existing.id, "already_existed": True}

    job = SavedJob(
        id=str(uuid.uuid4()),
        **req.model_dump(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {"message": "Job saved", "id": job.id, "already_existed": False}


@router.get("/saved")
def get_saved_jobs(
    site: Optional[str] = Query(None),
    is_remote: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    """Return all saved jobs, optionally filtered."""
    q = db.query(SavedJob)
    if site:
        q = q.filter(SavedJob.site == site)
    if is_remote is not None:
        q = q.filter(SavedJob.is_remote == is_remote)
    jobs = q.order_by(SavedJob.saved_at.desc()).all()
    return {"jobs": [_job_to_dict(j) for j in jobs], "count": len(jobs)}


@router.get("/saved/{job_id}")
def get_saved_job(job_id: str, db: Session = Depends(get_db)):
    """Return a single saved job by ID."""
    job = db.query(SavedJob).filter(SavedJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_dict(job)


@router.delete("/saved/{job_id}")
def delete_saved_job(job_id: str, db: Session = Depends(get_db)):
    """Remove a saved job from the database."""
    job = db.query(SavedJob).filter(SavedJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"message": "Job removed"}


# ── Helpers ─────────────────────────────────────────────────────────────────


def _job_to_dict(job: SavedJob) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "company_name": job.company_name,
        "job_url": job.job_url,
        "job_url_direct": job.job_url_direct,
        "location": {
            "city": job.location_city,
            "state": job.location_state,
            "country": job.location_country,
        },
        "description": job.description,
        "job_type": job.job_type,
        "is_remote": job.is_remote,
        "min_salary": job.min_salary,
        "max_salary": job.max_salary,
        "salary_interval": job.salary_interval,
        "currency": job.currency,
        "site": job.site,
        "company_industry": job.company_industry,
        "job_level": job.job_level,
        "company_logo": job.company_logo,
        "date_posted": job.date_posted,
        "easy_apply": job.easy_apply,
        "saved_at": job.saved_at.isoformat() if job.saved_at else None,
    }
