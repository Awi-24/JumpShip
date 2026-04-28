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
    """
    Persistence layer for JobAssessment results.

    NOTE on schema drift (B-013): the Pydantic ``JobAssessment`` (API contract,
    in ``backend/models/schemas.py``) carries fields that do NOT have dedicated
    columns here — notably ``hire_recommendation``, ``strong_points``,
    ``income_range``, ``career_suggestions``, ``company_insights``, ``job_tags``,
    ``is_relevant``, ``resume_generation_triggered``.

    The legacy column layout uses ``strengths`` / ``gaps`` / ``suggestions`` JSON
    blobs.  Mapping rules used by callers:
      - ``strong_points``       → ``strengths``  (JSON list)
      - ``career_suggestions``  → ``suggestions`` (JSON list)
      - ``gaps``                → ``gaps``        (JSON list)
      - everything else (``hire_recommendation``, ``income_range``,
        ``company_insights``, ``job_tags``, flags) is round-tripped through
        ``raw_assessment`` (JSON column on ``Application.assessment_data`` for
        live data; here we expose ``to_assessment`` / ``from_assessment``
        helpers that round-trip the full Pydantic model into the JSON blobs we
        already have).

    Adding new columns would require a migration and is out of scope.
    """
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
    provider = Column(String, default="ollama")
    analyzed_at = Column(DateTime, server_default=func.now())

    # ── Pydantic <-> ORM round-trip ──────────────────────────────────────
    # Kept as small helpers (no migration required). They pack/unpack the
    # extra JobAssessment fields into the existing JSON columns so callers
    # don't lose data on save/load.

    def to_assessment(self):
        """Reconstruct a ``JobAssessment`` (Pydantic) from this ORM row."""
        from backend.models.schemas import JobAssessment

        extras = {}
        # ``suggestions`` historically stored either a plain list or a dict
        # with the extra keys when round-tripping; support both.
        suggestions = self.suggestions or []
        if isinstance(suggestions, dict):
            extras = {k: v for k, v in suggestions.items() if k != "career_suggestions"}
            suggestions = suggestions.get("career_suggestions", [])

        return JobAssessment(
            match_score=int(self.score or 0),
            summary=self.summary or "",
            strong_points=self.strengths or [],
            gaps=self.gaps or [],
            career_suggestions=suggestions or [],
            keywords_matched=self.keywords_matched or [],
            keywords_missing=self.keywords_missing or [],
            company_insights=extras.get("company_insights", ""),
            income_range=extras.get("income_range", ""),
            is_relevant=extras.get("is_relevant", True),
            job_tags=extras.get("job_tags", []),
            resume_generation_triggered=extras.get("resume_generation_triggered", False),
            hire_recommendation=extras.get("hire_recommendation", "borderline"),
        )

    def apply_assessment(self, assessment) -> None:
        """Populate columns from a ``JobAssessment`` (Pydantic) instance."""
        data = assessment.model_dump()
        self.score = float(data.get("match_score", 0))
        self.summary = data.get("summary", "")
        self.strengths = data.get("strong_points", [])
        self.gaps = data.get("gaps", [])
        # Stash overflow fields alongside career_suggestions so we never drop
        # API-contract data on persistence.
        self.suggestions = {
            "career_suggestions": data.get("career_suggestions", []),
            "company_insights": data.get("company_insights", ""),
            "income_range": data.get("income_range", ""),
            "is_relevant": data.get("is_relevant", True),
            "job_tags": data.get("job_tags", []),
            "resume_generation_triggered": data.get("resume_generation_triggered", False),
            "hire_recommendation": data.get("hire_recommendation", "borderline"),
        }
        self.keywords_matched = data.get("keywords_matched", [])
        self.keywords_missing = data.get("keywords_missing", [])


class Application(Base):
    __tablename__ = "applications"

    id = Column(String, primary_key=True, default=gen_uuid)
    job_id = Column(String)
    job_title = Column(String, nullable=False)
    company_name = Column(String)
    job_url = Column(String)
    site = Column(String)
    status = Column(String, default="saved")  # saved | applying | applied | interviewing | offered | rejected
    is_easy_apply = Column(Boolean, default=False)
    applied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    notes = Column(Text)
    analysis_id = Column(String, nullable=True)
    assessment_data = Column(JSON, nullable=True)   # full JobAssessment dict
    match_score = Column(Integer, nullable=True)    # quick-access score from assessment
    job_description = Column(Text, nullable=True)   # stored for interview chatbot


class UserProfile(Base):
    """Personal information used to pre-fill resume generation context. Stored locally only."""
    __tablename__ = "user_profiles"

    id = Column(String, primary_key=True, default=gen_uuid)

    full_name       = Column(String)
    email           = Column(String)
    phone           = Column(String)
    linkedin_url    = Column(String)
    github_url      = Column(String)
    portfolio_url   = Column(String)
    location_city   = Column(String)
    location_state  = Column(String)
    location_country = Column(String)

    work_authorization  = Column(String)
    willing_to_relocate = Column(Boolean, default=False)
    preferred_work_mode = Column(String)

    years_experience = Column(Integer, default=0)
    highest_degree   = Column(String)
    university       = Column(String)
    graduation_year  = Column(Integer)

    salary_min      = Column(Integer)
    salary_max      = Column(Integer)
    salary_currency = Column(String, default="USD")

    custom_answers  = Column(JSON, default=dict)
    extra_info      = Column(Text)  # freeform: projects, experiences, achievements the LLM can use for resume

    # Fernet-encrypted JSON blob: {"openai": "...", "anthropic": "...", ...}
    # See HDF-20260427-10 — moved from frontend localStorage to server-side Fernet store.
    llm_keys_encrypted = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class GeneratedResume(Base):
    """Stores per-job tailored resumes generated by the LLM. PDF path on disk."""
    __tablename__ = "generated_resumes"

    id          = Column(String, primary_key=True, default=gen_uuid)
    job_id      = Column(String, index=True)
    job_title   = Column(String, default="")
    company     = Column(String, default="")
    match_score = Column(Integer, default=0)
    markdown    = Column(Text)           # raw LLM output (HTML fragment; legacy column name)
    pdf_path    = Column(String)         # absolute path to generated PDF on disk
    provider    = Column(String, default="ollama")
    model       = Column(String, default="")
    created_at  = Column(DateTime, server_default=func.now())


class Settings(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class InterviewSession(Base):
    """
    Persistent mock-interview session — one per Application.
    Allows the user to resume an interview from where they stopped, and stores
    the final report once the interview is closed.
    """
    __tablename__ = "interview_sessions"

    id              = Column(String, primary_key=True, default=gen_uuid)
    application_id  = Column(String, index=True, nullable=False)  # FK to Application.id
    persona_name    = Column(String, default="")
    persona_bio     = Column(Text, default="")
    session_context = Column(Text)                # full system prompt (built once at /init)
    interview_track = Column(String, default="behavioral")  # behavioral | system_design | coding
    messages        = Column(JSON, default=list)  # [{role, content}, ...]
    state           = Column(String, default="")  # last <estado_interno> from LLM
    completed       = Column(Boolean, default=False)
    report          = Column(JSON, nullable=True) # {strengths, improvements, study_tips, score}
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())
