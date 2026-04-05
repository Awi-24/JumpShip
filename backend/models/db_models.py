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


class UserProfile(Base):
    """
    Stores personal information used by the auto-apply agent to fill job forms.
    Sensitive fields (phone, address) are stored locally in SQLite only —
    never sent to cloud LLMs.
    """
    __tablename__ = "user_profiles"

    id = Column(String, primary_key=True, default=gen_uuid)

    # Identity
    full_name       = Column(String)
    email           = Column(String)
    phone           = Column(String)
    linkedin_url    = Column(String)
    github_url      = Column(String)
    portfolio_url   = Column(String)
    location_city   = Column(String)
    location_state  = Column(String)
    location_country = Column(String)

    # Work eligibility
    work_authorization = Column(String)  # e.g. "Citizen", "Permanent Resident", "Need Sponsorship"
    willing_to_relocate = Column(Boolean, default=False)
    preferred_work_mode = Column(String)  # "remote", "hybrid", "on-site", "any"

    # Experience
    years_experience = Column(Integer, default=0)
    highest_degree   = Column(String)  # "Bachelor's", "Master's", "PhD", "None"
    university       = Column(String)
    graduation_year  = Column(Integer)

    # Salary expectations
    salary_min       = Column(Integer)
    salary_max       = Column(Integer)
    salary_currency  = Column(String, default="USD")

    # Platform credentials (stored locally, never sent to LLM)
    linkedin_email    = Column(String)
    linkedin_password = Column(String)  # encrypted in future; plaintext for local-only MVP

    # Free-form answers for common application questions (JSON dict)
    # e.g. {"cover_letter": "...", "why_this_company": "...", "biggest_achievement": "..."}
    custom_answers   = Column(JSON, default=dict)

    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AutoApplyLog(Base):
    """Tracks each automated application attempt."""
    __tablename__ = "auto_apply_logs"

    id          = Column(String, primary_key=True, default=gen_uuid)
    job_id      = Column(String)
    job_title   = Column(String)
    company     = Column(String)
    job_url     = Column(String)
    platform    = Column(String)   # "linkedin", "indeed", etc.
    status      = Column(String)   # "pending","running","success","failed","needs_review"
    error       = Column(Text)     # error message if failed
    screenshot  = Column(String)   # path to screenshot on failure
    fields_filled = Column(JSON)   # dict of field_name → value that was filled
    started_at  = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)


class TraceEvent(Base):
    """
    Records each step of an agent's execution for observability.
    Linked to an ApplyTask by task_id. Events include LLM thinking,
    tool calls, tool results, errors, and human-help requests.
    """
    __tablename__ = "trace_events"

    id         = Column(String, primary_key=True, default=gen_uuid)
    task_id    = Column(String, index=True)
    step       = Column(Integer, default=0)
    event_type = Column(String)   # "thinking", "tool_call", "tool_result", "error", "human_needed", "status"
    content    = Column(JSON)     # { reasoning, tool, args, result, error, screenshot_path, duration_ms, ... }
    timestamp  = Column(DateTime, server_default=func.now())


class AgentTask(Base):
    """
    Persisted agent task state. Mirrors the in-memory ApplyTask dataclass
    but survives server restarts.
    """
    __tablename__ = "agent_tasks"

    id            = Column(String, primary_key=True)
    job_url       = Column(String, nullable=False)
    job_title     = Column(String, default="")
    company       = Column(String, default="")
    platform      = Column(String, default="")
    dry_run       = Column(Boolean, default=True)
    status        = Column(String, default="queued")
    message       = Column(Text, default="")
    error         = Column(Text, default="")
    fields_filled = Column(JSON, default=dict)
    queued_at     = Column(DateTime, server_default=func.now())
    started_at    = Column(DateTime, nullable=True)
    finished_at   = Column(DateTime, nullable=True)
    max_retries   = Column(Integer, default=1)
    retry_count   = Column(Integer, default=0)


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
