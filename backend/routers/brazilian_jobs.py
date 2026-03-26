"""Router for Brazilian job platforms: Gupy, Catho, Vagas.com.br"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from backend.services.brazilian_scrapers import search_brazilian_jobs

router = APIRouter(prefix="/api/jobs/brazil", tags=["brazilian-jobs"])


# ── Pydantic schemas ────────────────────────────────────────────────────────


class BrazilianSearchRequest(BaseModel):
    search_term: str
    location: str = ""
    results_wanted: int = 20
    is_remote: bool = False
    sites: list[str] = ["gupy", "catho", "vagas.com.br"]


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.post("/search")
def search_brazil(req: BrazilianSearchRequest):
    """Search Brazilian job platforms."""
    results = search_brazilian_jobs(
        search_term=req.search_term,
        location=req.location,
        results_wanted=req.results_wanted,
        is_remote=req.is_remote,
        sites=req.sites,
    )
    return {"jobs": results, "total": len(results)}
