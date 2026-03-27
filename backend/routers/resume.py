"""
Router for resume upload and management.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.db_models import Resume
from backend.services.resume_parser import parse_resume

router = APIRouter(prefix="/api/resume", tags=["resume"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Upload a resume (PDF or DOCX).
    Parses the text and stores it in the database.
    Only one resume is kept at a time — uploading a new one replaces the previous.
    """
    allowed_types = {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Upload a PDF or DOCX.",
        )

    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File is too large. Maximum size is 10 MB.")

    # Parse the resume
    try:
        text = parse_resume(content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse resume: {e}")

    # Save file to disk
    file_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix
    file_path = UPLOAD_DIR / f"{file_id}{suffix}"
    file_path.write_bytes(content)

    # Remove old resume records (keep only the latest)
    db.query(Resume).delete()

    resume = Resume(
        id=file_id,
        filename=file.filename,
        content=text,
        file_path=str(file_path),
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)

    return {
        "id": resume.id,
        "filename": resume.filename,
        "char_count": len(text),
        "preview": text[:300] + "..." if len(text) > 300 else text,
        "uploaded_at": resume.uploaded_at.isoformat() if resume.uploaded_at else None,
    }


@router.get("")
def get_resume(db: Session = Depends(get_db)):
    """Return the currently stored resume."""
    resume = db.query(Resume).order_by(Resume.uploaded_at.desc()).first()
    if not resume:
        raise HTTPException(status_code=404, detail="No resume uploaded yet.")
    return {
        "id": resume.id,
        "filename": resume.filename,
        "content": resume.content,
        "char_count": len(resume.content),
        "uploaded_at": resume.uploaded_at.isoformat() if resume.uploaded_at else None,
    }


@router.delete("")
def delete_resume(db: Session = Depends(get_db)):
    """Delete the stored resume."""
    deleted = db.query(Resume).delete()
    db.commit()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="No resume found.")
    return {"message": "Resume deleted"}
