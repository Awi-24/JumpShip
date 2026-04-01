"""
Router for user profile management.
The profile is stored as a single JSON blob in the Settings/UserProfile table
and is used by agents to auto-fill job application forms.
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import UserProfile

router = APIRouter(prefix="/api/profile", tags=["profile"])

_PROFILE_KEY = "default"


# ── Schemas ───────────────────────────────────────────────────────────────────


class WorkExperience(BaseModel):
    company: str = ""
    title: str = ""
    start_date: str = ""
    end_date: str = ""
    current: bool = False
    description: str = ""
    location: str = ""


class Education(BaseModel):
    institution: str = ""
    degree: str = ""
    field: str = ""
    start_date: str = ""
    end_date: str = ""
    gpa: str = ""


class CustomQA(BaseModel):
    question: str = ""
    answer: str = ""


class UserProfileSchema(BaseModel):
    # Personal info
    name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip_code: str = ""

    # Professional links
    linkedin_url: str = ""
    github_url: str = ""
    portfolio_url: str = ""

    # Professional info
    professional_summary: str = ""
    current_title: str = ""
    years_experience: int = 0
    skills: List[str] = []

    # Work experience & Education
    work_experience: List[WorkExperience] = []
    education: List[Education] = []

    # Application preferences
    expected_salary: str = ""
    work_authorization: str = ""
    willing_to_relocate: bool = False
    remote_preference: str = ""  # remote | hybrid | onsite | any

    # Cover letter & custom Q&A
    cover_letter_template: str = ""
    custom_answers: List[CustomQA] = []


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("", response_model=UserProfileSchema)
def get_profile(db: Session = Depends(get_db)):
    """Return the stored user profile (or defaults if none saved yet)."""
    row = db.query(UserProfile).filter(UserProfile.key == _PROFILE_KEY).first()
    if not row:
        return UserProfileSchema()
    return json.loads(row.value)


@router.put("")
def save_profile(profile: UserProfileSchema, db: Session = Depends(get_db)):
    """Upsert the user profile."""
    data = profile.model_dump()
    row = db.query(UserProfile).filter(UserProfile.key == _PROFILE_KEY).first()
    if row:
        row.value = json.dumps(data)
    else:
        db.add(UserProfile(key=_PROFILE_KEY, value=json.dumps(data)))
    db.commit()
    return {"message": "Profile saved successfully.", "profile": data}


# ── Internal helper (used by agents.py) ──────────────────────────────────────


def _get_profile_dict(db: Session) -> dict:
    """Return the profile as a plain dict for use by agents."""
    row = db.query(UserProfile).filter(UserProfile.key == _PROFILE_KEY).first()
    if not row:
        return {}
    return json.loads(row.value)
