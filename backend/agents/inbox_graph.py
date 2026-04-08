"""
JumpShip V2 — Inbox Agent (LangGraph).

Polls a user-configured IMAP mailbox, classifies job-related emails with
the LLM, and automatically updates the Kanban board status.

Graph flow:
  [START] → fetch_emails → classify_emails → update_statuses → [END]

Privacy note: email credentials are loaded from the local DB and never
sent to any external service. The LLM only sees email subject + snippet
(first 500 chars of body), not full content.

Triggered via:
  - Background asyncio task on a configurable poll interval (default 15 min)
  - Manual POST /api/inbox/poll
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Annotated, Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from backend.agents.llm import get_llm
from backend.agents.state import InboxState
from backend.config import settings

logger = logging.getLogger(__name__)


# ── Classification prompt ─────────────────────────────────────────────────────

_CLASSIFY_SYSTEM = (
    "You are an email classifier for a job seeker. "
    "Given an email subject and brief snippet, classify the email into exactly one category. "
    "Respond with a JSON object only — no prose, no markdown. "
    'Use exactly one of these categories: "rejection", "interview_request", "assessment", "offer", "other".'
)

_CLASSIFY_USER = """Classify this email:

Subject: {subject}
From: {from_addr}
Snippet: {snippet}

Return ONLY this JSON (no extra keys):
{{"classification": "<category>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}}"""

# Map classification → new Kanban status
_CLASS_TO_STATUS: dict[str, str] = {
    "rejection":        "rejected",
    "interview_request": "interviewing",
    "offer":            "offered",
    "assessment":       "applied",   # keep in applied — assessment is pre-interview
    "other":            "",          # no status change
}


# ── Node: fetch_emails ────────────────────────────────────────────────────────

async def fetch_emails(state: InboxState) -> dict:
    """
    Connect to IMAP and fetch unread emails since last processed UID.
    Runs in a threadpool (imapclient is synchronous).
    """
    def _fetch() -> list[dict]:
        try:
            import imapclient
        except ImportError:
            raise RuntimeError("imapclient not installed — run: pip install imapclient")

        server = imapclient.IMAPClient(
            host=state["imap_host"],
            port=state.get("imap_port", 993),
            ssl=state.get("use_ssl", True),
        )
        try:
            server.login(state["imap_user"], state["imap_password"])
            server.select_folder("INBOX", readonly=True)

            since_uid = state.get("since_uid", 0)
            # Fetch UIDs greater than the last processed
            messages = server.search(["NOT", "DELETED"])
            new_uids = [uid for uid in messages if uid > since_uid]

            if not new_uids:
                return []

            # Fetch subject + from + body snippet for each
            result = []
            fetch_data = server.fetch(new_uids, ["ENVELOPE", "BODY.PEEK[TEXT]<0.500>"])
            for uid, data in fetch_data.items():
                try:
                    envelope = data.get(b"ENVELOPE")
                    subject  = ""
                    from_addr = ""
                    received_at = None
                    if envelope:
                        subject   = _decode_header(envelope.subject)
                        from_addr = _format_address(envelope.from_)
                        if envelope.date:
                            received_at = envelope.date.isoformat()

                    body_key = b"BODY[TEXT]<0>"
                    snippet = ""
                    if body_key in data:
                        raw = data[body_key]
                        if isinstance(raw, bytes):
                            snippet = raw.decode("utf-8", errors="replace")[:500]

                    result.append({
                        "uid":         uid,
                        "subject":     subject,
                        "from_addr":   from_addr,
                        "received_at": received_at,
                        "snippet":     snippet,
                    })
                except Exception as exc:
                    logger.debug("Failed to parse email UID %s: %s", uid, exc)

            return result
        finally:
            try:
                server.logout()
            except Exception:
                pass

    try:
        emails = await asyncio.to_thread(_fetch)
        logger.info("Inbox fetched %d new emails", len(emails))
        return {
            "emails": emails,
            "messages": [HumanMessage(content=f"Fetched {len(emails)} emails")],
        }
    except Exception as exc:
        logger.error("IMAP fetch failed: %s", exc)
        return {"emails": [], "messages": [HumanMessage(content=f"Fetch failed: {exc}")]}


def _decode_header(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _format_address(addr_list: Any) -> str:
    if not addr_list:
        return ""
    try:
        a = addr_list[0]
        mailbox = _decode_header(a.mailbox)
        host    = _decode_header(a.host)
        return f"{mailbox}@{host}"
    except Exception:
        return ""


# ── Node: classify_emails ─────────────────────────────────────────────────────

async def classify_emails(state: InboxState) -> dict:
    """
    Use the LLM to classify each fetched email.
    Enriches each email dict with classification + confidence.
    """
    emails = state.get("emails", [])
    if not emails:
        return {"emails": [], "messages": [HumanMessage(content="No emails to classify")]}

    llm = get_llm()
    classified: list[dict] = []

    for email in emails:
        prompt = _CLASSIFY_USER.format(
            subject  = email.get("subject", "")[:200],
            from_addr= email.get("from_addr", ""),
            snippet  = email.get("snippet", "")[:500],
        )
        try:
            response = await llm.ainvoke([
                SystemMessage(content=_CLASSIFY_SYSTEM),
                HumanMessage(content=prompt),
            ])
            raw = response.content.strip()
            # Strip markdown fences
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            result = json.loads(raw)
            email["classification"] = result.get("classification", "other")
            email["confidence"]     = float(result.get("confidence", 0.5))
            email["reasoning"]      = result.get("reasoning", "")
        except Exception as exc:
            logger.debug("Classification failed for UID %s: %s", email.get("uid"), exc)
            email["classification"] = "other"
            email["confidence"]     = 0.0
            email["reasoning"]      = f"Error: {exc}"

        classified.append(email)
        logger.info(
            "Email UID %s → %s (%.0f%%)",
            email.get("uid"), email["classification"], email.get("confidence", 0) * 100,
        )

    return {
        "emails": classified,
        "messages": [HumanMessage(content=f"Classified {len(classified)} emails")],
    }


# ── Node: update_statuses ─────────────────────────────────────────────────────

async def update_statuses(state: InboxState) -> dict:
    """
    For each classified email, attempt to match it to an open application
    by searching for the company name in the email address/subject.
    Updates the Kanban status and persists EmailLog rows.
    """
    from backend.database import engine
    from backend.models.db_models import Application, EmailLog, InboxConfig
    from sqlalchemy.orm import Session

    emails   = state.get("emails", [])
    updates: dict[str, str] = {}
    max_uid  = state.get("since_uid", 0)

    with Session(engine) as db:
        # Load all open applications for matching
        open_apps = db.query(Application).filter(
            Application.status.notin_(["rejected", "offered"])
        ).all()

        for email in emails:
            uid            = email.get("uid", 0)
            classification = email.get("classification", "other")
            new_status     = _CLASS_TO_STATUS.get(classification, "")

            # Try to match to an application by company name in subject/from
            matched_app = None
            if new_status:
                subject_lower  = email.get("subject", "").lower()
                from_lower     = email.get("from_addr", "").lower()
                for app in open_apps:
                    company = (app.company_name or "").lower()
                    if company and len(company) > 3:
                        if company in subject_lower or company in from_lower:
                            matched_app = app
                            break

            old_status = None
            if matched_app and new_status and new_status != matched_app.status:
                old_status = matched_app.status
                matched_app.status = new_status
                if new_status == "interviewing":
                    matched_app.applied_at = datetime.now(timezone.utc)
                updates[matched_app.id] = new_status
                logger.info(
                    "Application '%s' @ %s: %s → %s",
                    matched_app.job_title, matched_app.company_name,
                    old_status, new_status,
                )

            # Persist EmailLog
            log = EmailLog(
                email_uid      = str(uid),
                subject        = email.get("subject", "")[:255],
                from_addr      = email.get("from_addr", "")[:255],
                received_at    = _parse_dt(email.get("received_at")),
                classification = classification,
                job_id         = matched_app.job_id if matched_app else None,
                application_id = matched_app.id     if matched_app else None,
                old_status     = old_status,
                new_status     = new_status or None,
                raw_snippet    = email.get("snippet", "")[:500],
            )
            db.add(log)

            if isinstance(uid, int) and uid > max_uid:
                max_uid = uid

        db.commit()

        # Update last processed UID in InboxConfig
        if max_uid > state.get("since_uid", 0):
            cfg_row = db.query(InboxConfig).first()
            if cfg_row:
                cfg_row.last_uid = max_uid
                db.commit()

    return {
        "status_updates": updates,
        "messages": [HumanMessage(content=f"Updated {len(updates)} application statuses")],
    }


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_inbox_graph(checkpointer=None) -> Any:
    graph = StateGraph(InboxState)
    graph.add_node("fetch_emails",   fetch_emails)
    graph.add_node("classify_emails", classify_emails)
    graph.add_node("update_statuses", update_statuses)

    graph.add_edge(START, "fetch_emails")
    graph.add_edge("fetch_emails", "classify_emails")
    graph.add_edge("classify_emails", "update_statuses")
    graph.add_edge("update_statuses", END)

    return graph.compile(checkpointer=checkpointer)


# ── Convenience runner ────────────────────────────────────────────────────────

async def run_inbox_poll(thread_id: str | None = None) -> dict:
    """
    Run one inbox poll cycle using credentials from the DB.
    Returns a summary dict: {emails_fetched, updates_made, errors}.
    """
    import uuid
    from backend.database import engine
    from backend.models.db_models import InboxConfig
    from sqlalchemy.orm import Session
    from backend.services.crypto import decrypt

    with Session(engine) as db:
        cfg = db.query(InboxConfig).filter(InboxConfig.active == True).first()
        if not cfg:
            return {"error": "No active inbox configured", "emails_fetched": 0, "updates_made": 0}

        initial: InboxState = {
            "imap_host":     cfg.imap_host,
            "imap_user":     cfg.username,
            "imap_password": decrypt(cfg.password),   # decrypt for agent use
            "imap_port":     cfg.imap_port,
            "use_ssl":       cfg.use_ssl,
            "since_uid":     cfg.last_uid or 0,
            "emails":        [],
            "status_updates": {},
            "draft_replies":  {},
            "messages":      [],
        }

    resolved_tid = thread_id or str(uuid.uuid4())
    # Use MemorySaver for inbox runs — results are in the DB, not graph state
    from langgraph.checkpoint.memory import MemorySaver
    app = build_inbox_graph(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": resolved_tid}}

    final = await app.ainvoke(initial, config=config)
    return {
        "emails_fetched": len(final.get("emails", [])),
        "updates_made":   len(final.get("status_updates", {})),
        "errors":         [],
    }
