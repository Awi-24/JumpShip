"""
JumpShip V2 — Shared LangGraph state types.

Each graph has its own TypedDict state, but they share common sub-types
defined here so nodes can exchange data cleanly.
"""
from __future__ import annotations

from typing import Annotated, Any, TypedDict
from langgraph.graph.message import add_messages


def trim_messages(existing: list, new: list) -> list:
    """Reducer that appends new messages and keeps only the last 20."""
    full = add_messages(existing, new)
    if len(full) > 20:
        return full[-20:]
    return full


# ── Common sub-types ──────────────────────────────────────────────────────────

class JobListing(TypedDict):
    id:           str
    title:        str
    company:      str
    url:          str
    description:  str
    location:     str
    is_remote:    bool
    site:         str
    date_posted:  str
    raw:          dict[str, Any]


class MatchResult(TypedDict):
    job_id:      str
    score:       float          # 0–100
    strengths:   list[str]
    gaps:        list[str]
    suggestions: list[str]
    summary:     str


class TailoredResume(TypedDict):
    job_id:       str
    original:     str
    tailored:     str
    cover_letter: str


# ── Scout graph state ─────────────────────────────────────────────────────────

class ScoutState(TypedDict):
    """State for the Scout agent — job discovery pipeline."""
    # Inputs
    resume_text:    str
    preferences:    dict[str, Any]   # location, work_type, keywords, etc.

    # Intermediate
    search_queries: list[str]        # LLM-generated jobspy queries
    raw_results:    list[dict]       # raw jobspy rows

    # Output
    jobs:           list[JobListing]
    errors:         list[str]
    messages:       Annotated[list, add_messages]


# ── Matcher graph state ───────────────────────────────────────────────────────

class MatcherState(TypedDict):
    """State for the Matcher agent — scoring and gap analysis."""
    job:         JobListing
    resume_text: str
    profile:     dict[str, Any]

    # Output
    result:      MatchResult
    messages:    Annotated[list, trim_messages]


# ── Apply graph state ─────────────────────────────────────────────────────────

class ApplyState(TypedDict):
    """State for the Apply graph — resume tailoring + form filling."""
    # Inputs
    job:            JobListing
    match_result:   MatchResult
    profile:        dict[str, Any]
    resume_path:    str | None
    resume_text:    str
    dry_run:        bool
    headless:       bool
    llm_model:      str
    ollama_base_url: str

    # Tailoring sub-agent outputs
    tailored_resume: TailoredResume | None

    # Application sub-agent runtime
    task_id:        str
    status:         str   # queued | tailoring | applying | success | failed | needs_help | cancelled
    fields_filled:  dict[str, str]
    error:          str
    screenshot_path: str | None

    # HITL
    hitl_question:   str | None    # set by agent when it needs user input
    hitl_response:   str | None    # set by user's WebSocket message

    messages:        Annotated[list, add_messages]


# ── Inbox graph state ─────────────────────────────────────────────────────────

class InboxState(TypedDict):
    """State for the Inbox agent — email classification and status updates."""
    imap_host:     str
    imap_user:     str
    imap_password: str   # local only — never sent to LLM
    since_uid:     int

    # Processed emails
    emails:        list[dict[str, Any]]

    # Classification results: job_id → new_status
    status_updates: dict[str, str]
    draft_replies:  dict[str, str]

    messages:      Annotated[list, trim_messages]
