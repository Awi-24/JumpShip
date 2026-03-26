from sqlalchemy import Column, String, Float, Boolean, DateTime, Text, JSON, Integer
from sqlalchemy.sql import func
from backend.database import Base
import uuid


def gen_uuid():
    return str(uuid.uuid4())


class SavedJob(Base):
    __tablename__ = "saved_jobs"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    company_name = Column(String)
    job_url = Column(String)
    job_url_direct = Column(String)
    location_city = Column(String)
    location_state = Column(String)
    location_country = Column(String)
    description = Column(Text)
    job_type = Column(String)
    is_remote = Column(Boolean)
    min_salary = Column(Float)
    max_salary = Column(Float)
    salary_interval = Column(String)
    currency = Column(String)
    site = Column(String)
    company_industry = Column(String)
    job_level = Column(String)
    company_logo = Column(String)
    date_posted = Column(String)
    easy_apply = Column(Boolean)
    saved_at = Column(DateTime, server_default=func.now())
    raw_data = Column(JSON)


class Resume(Base):
    __tablename__ = "resumes"

    id = Column(String, primary_key=True, default=gen_uuid)
    filename = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    file_path = Column(String)
    uploaded_at = Column(DateTime, server_default=func.now())


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(String, primary_key=True, default=gen_uuid)
    job_id = Column(String, nullable=False)
    resume_id = Column(String, nullable=False)
    job_title = Column(String)
    company_name = Column(String)
    score = Column(Float)
    strengths = Column(JSON)
    gaps = Column(JSON)
    suggestions = Column(JSON)
    summary = Column(Text)
    keywords_matched = Column(JSON)
    keywords_missing = Column(JSON)
    tailored_resume = Column(Text)
    provider = Column(String, default="anthropic")
    analyzed_at = Column(DateTime, server_default=func.now())


class Application(Base):
    __tablename__ = "applications"

    id = Column(String, primary_key=True, default=gen_uuid)
    job_id = Column(String)
    job_title = Column(String, nullable=False)
    company_name = Column(String)
    job_url = Column(String)
    site = Column(String)
    status = Column(String, default="saved")
    applied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    notes = Column(Text)
    analysis_id = Column(String, nullable=True)
    is_easy_apply = Column(Boolean, default=False)


class Settings(Base):
    """
    Key-value store for user settings.
    Sensitive values (API keys, passwords) are stored as-is in SQLite.
    For production, encrypt with a user-provided master password.
    """
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
