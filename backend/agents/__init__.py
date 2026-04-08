"""
JumpShip V2 — LangGraph multi-agent system.

Agents:
  scout_graph   — Discovers and scrapes job listings
  matcher_graph — Scores jobs against the user's resume/profile
  apply_graph   — Tailors resume and fills applications (Playwright)
  inbox_graph   — Monitors email inbox and updates job statuses
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Any


@asynccontextmanager
async def get_checkpointer(db_path: str) -> AsyncGenerator[Any, None]:
    """
    Yield a LangGraph checkpointer.
    Uses AsyncSqliteSaver when langgraph-checkpoint-sqlite is installed,
    falls back to MemorySaver (no persistence across restarts).
    """
    try:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        async with AsyncSqliteSaver.from_conn_string(db_path) as cp:
            yield cp
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver
        yield MemorySaver()
