"""
JumpShip V2 — Inbox Agent router.

Endpoints:
  GET  /api/inbox/config          — get current IMAP config (password masked)
  POST /api/inbox/config          — save/update IMAP config
  POST /api/inbox/poll            — trigger a manual poll cycle
  GET  /api/inbox/logs            — recent email classification log
  GET  /api/inbox/status          — poll status + next scheduled run
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import engine
from backend.models.db_models import EmailLog, InboxConfig
from backend.services.auth import verify_api_key
from backend.services.crypto import encrypt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inbox", tags=["inbox"], dependencies=[Depends(verify_api_key)])


# ── Schemas ───────────────────────────────────────────────────────────────────

class InboxConfigIn(BaseModel):
    imap_host:    str  = ""
    imap_port:    int  = 993
    username:     str  = ""
    password:     str  = ""
    use_ssl:      bool = True
    active:       bool = False
    poll_minutes: int  = 15


class InboxConfigOut(BaseModel):
    imap_host:    str
    imap_port:    int
    username:     str
    password_set: bool   # never return the actual password
    use_ssl:      bool
    active:       bool
    poll_minutes: int
    last_uid:     int


# ── Config endpoints ──────────────────────────────────────────────────────────

@router.get("/config")
def get_inbox_config() -> InboxConfigOut:
    with Session(engine) as db:
        cfg = db.query(InboxConfig).first()
        if not cfg:
            return InboxConfigOut(
                imap_host="", imap_port=993, username="",
                password_set=False, use_ssl=True, active=False,
                poll_minutes=15, last_uid=0,
            )
        return InboxConfigOut(
            imap_host    = cfg.imap_host or "",
            imap_port    = cfg.imap_port or 993,
            username     = cfg.username or "",
            password_set = bool(cfg.password),
            use_ssl      = cfg.use_ssl if cfg.use_ssl is not None else True,
            active       = cfg.active or False,
            poll_minutes = cfg.poll_minutes or 15,
            last_uid     = cfg.last_uid or 0,
        )


import socket
import ipaddress


def _is_private_ip(hostname: str) -> bool:
    try:
        # Resolve hostname to IP
        ip_str = socket.gethostbyname(hostname)
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except Exception:
        # If we can't resolve it, assume it's unsafe or let the connection fail later
        return True


@router.post("/config")
def save_inbox_config(body: InboxConfigIn):
    """Save or update IMAP configuration."""
    if _is_private_ip(body.imap_host):
        raise HTTPException(
            status_code=400,
            detail="Invalid IMAP host: private IPs or loopback are not allowed."
        )

    with Session(engine) as db:
        cfg = db.query(InboxConfig).first()
        if not cfg:
            cfg = InboxConfig()
            db.add(cfg)

        cfg.imap_host    = body.imap_host
        cfg.imap_port    = body.imap_port
        cfg.username     = body.username
        cfg.use_ssl      = body.use_ssl
        cfg.active       = body.active
        cfg.poll_minutes = body.poll_minutes
        cfg.updated_at   = datetime.now(timezone.utc)

        # Only update password if a new one is provided
        if body.password:
            cfg.password = encrypt(body.password)

        db.commit()
    return {"status": "saved"}


# ── Poll trigger ──────────────────────────────────────────────────────────────

@router.post("/poll")
async def trigger_poll(background_tasks: BackgroundTasks):
    """Trigger an immediate inbox poll in the background."""
    from backend.agents.inbox_graph import run_inbox_poll

    async def _run():
        try:
            result = await run_inbox_poll()
            logger.info("Manual inbox poll: %s", result)
        except Exception as exc:
            logger.error("Manual inbox poll failed: %s", exc)

    background_tasks.add_task(_run)
    return {"status": "polling", "message": "Inbox poll started in background"}


# ── Logs ──────────────────────────────────────────────────────────────────────

@router.get("/logs")
def get_email_logs(limit: int = 50):
    with Session(engine) as db:
        rows = (
            db.query(EmailLog)
            .order_by(EmailLog.processed_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id":             row.id,
                "email_uid":      row.email_uid,
                "subject":        row.subject,
                "from_addr":      row.from_addr,
                "classification": row.classification,
                "job_id":         row.job_id,
                "application_id": row.application_id,
                "old_status":     row.old_status,
                "new_status":     row.new_status,
                "processed_at":   row.processed_at.isoformat() if row.processed_at else None,
            }
            for row in rows
        ]


@router.get("/status")
def get_inbox_status():
    with Session(engine) as db:
        cfg = db.query(InboxConfig).first()
        total_processed = db.query(EmailLog).count()
        recent_updates  = db.query(EmailLog).filter(
            EmailLog.new_status.isnot(None)
        ).count()

    return {
        "active":           cfg.active if cfg else False,
        "last_uid":         cfg.last_uid if cfg else 0,
        "poll_minutes":     cfg.poll_minutes if cfg else 15,
        "total_processed":  total_processed,
        "status_updates":   recent_updates,
    }
