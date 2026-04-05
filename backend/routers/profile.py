"""
JumpShip — User profile endpoints.
The profile stores personal data used by the auto-apply agent to fill job forms.
All data stays local (SQLite); nothing here is ever sent to cloud LLMs.

GET  /api/profile        → current profile (or 404)
POST /api/profile        → create / full replace
PUT  /api/profile        → partial update
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from backend.database import engine
from backend.models.db_models import UserProfile

router = APIRouter(tags=["profile"])


# ── Pydantic schema ────────────────────────────────────────────────────────────

class ProfileSchema(BaseModel):
    full_name:           Optional[str] = None
    email:               Optional[str] = None
    phone:               Optional[str] = None
    linkedin_url:        Optional[str] = None
    github_url:          Optional[str] = None
    portfolio_url:       Optional[str] = None
    location_city:       Optional[str] = None
    location_state:      Optional[str] = None
    location_country:    Optional[str] = None
    work_authorization:  Optional[str] = None
    willing_to_relocate: Optional[bool] = None
    preferred_work_mode: Optional[str] = None
    years_experience:    Optional[int] = None
    highest_degree:      Optional[str] = None
    university:          Optional[str] = None
    graduation_year:     Optional[int] = None
    salary_min:          Optional[int] = None
    salary_max:          Optional[int] = None
    salary_currency:     Optional[str] = None
    linkedin_email:      Optional[str] = None
    linkedin_password:   Optional[str] = None
    custom_answers:      Optional[dict] = None

    model_config = {"from_attributes": True}


_PROFILE_ID = "singleton"  # single-user app — one profile per installation


def _get_db():
    return Session(engine)


@router.get("/api/profile", response_model=ProfileSchema)
def get_profile():
    with _get_db() as db:
        p = db.get(UserProfile, _PROFILE_ID)
        if not p:
            raise HTTPException(status_code=404, detail="Profile not set up yet.")
        return ProfileSchema.model_validate(p)


@router.post("/api/profile", response_model=ProfileSchema)
def upsert_profile(data: ProfileSchema):
    """Create or fully replace the user profile."""
    with _get_db() as db:
        p = db.get(UserProfile, _PROFILE_ID)
        if not p:
            p = UserProfile(id=_PROFILE_ID)
            db.add(p)
        for field, val in data.model_dump(exclude_none=True).items():
            setattr(p, field, val)
        db.commit()
        db.refresh(p)
        return ProfileSchema.model_validate(p)


@router.put("/api/profile", response_model=ProfileSchema)
def patch_profile(data: ProfileSchema):
    """Partial update — only supplied fields are changed."""
    with _get_db() as db:
        p = db.get(UserProfile, _PROFILE_ID)
        if not p:
            p = UserProfile(id=_PROFILE_ID)
            db.add(p)
        for field, val in data.model_dump(exclude_unset=True).items():
            setattr(p, field, val)
        db.commit()
        db.refresh(p)
        return ProfileSchema.model_validate(p)
