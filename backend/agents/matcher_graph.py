"""
JumpShip V2 — Matcher Agent (LangGraph).

Scores a job listing against the user's resume and profile.

Graph flow:
  [START] → score_job → [END]

Wraps the existing ai_evaluator so it plugs into the LangGraph checkpoint
system without rewriting the scoring logic.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph
from backend.agents import get_checkpointer
from backend.agents.state import JobListing, MatchResult, MatcherState
from backend.config import settings

logger = logging.getLogger(__name__)


# ── Nodes ─────────────────────────────────────────────────────────────────────

async def score_job(state: MatcherState) -> dict:
    """
    Score a single job against the resume using ai_evaluator.
    Runs the existing multi-provider evaluator — defaults to Ollama gemma3:27b.
    """
    import asyncio
    from backend.services.ai_evaluator import analyse_resume

    job = state["job"]

    try:
        # analyse_resume is synchronous — run in threadpool to avoid blocking
        analysis = await asyncio.to_thread(
            analyse_resume,
            resume_text     = state["resume_text"],
            job_description = job["description"],
            job_title       = job["title"],
            company_name    = job["company"],
            provider        = "ollama",
            api_key         = settings.llm_model,   # Ollama uses model name as "api_key" field
        )
        result = MatchResult(
            job_id      = job["id"],
            score       = float(analysis.get("score", 0)),
            strengths   = analysis.get("strengths", []),
            gaps        = analysis.get("gaps", []),
            suggestions = analysis.get("suggestions", []),
            summary     = analysis.get("summary", ""),
        )
        logger.info("Matcher scored job '%s' → %.0f/100", job["title"], result["score"])
    except Exception as exc:
        logger.error("Matcher failed for job '%s': %s", job.get("title"), exc)
        result = MatchResult(
            job_id      = job["id"],
            score       = 0.0,
            strengths   = [],
            gaps        = [f"Evaluation error: {exc}"],
            suggestions = [],
            summary     = "Could not evaluate this job.",
        )

    return {
        "result": result,
        "messages": [HumanMessage(content=f"Scored: {result['score']:.0f}/100")],
    }


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_matcher_graph(checkpointer=None) -> Any:
    graph = StateGraph(MatcherState)
    graph.add_node("score_job", score_job)
    graph.add_edge(START, "score_job")
    graph.add_edge("score_job", END)
    return graph.compile(checkpointer=checkpointer)


# ── Convenience runner ────────────────────────────────────────────────────────

async def run_matcher(
    job: JobListing,
    resume_text: str,
    profile: dict[str, Any],
    thread_id: str | None = None,
    db_path: str | None = None,
) -> MatchResult:
    """Score a single job and return the MatchResult."""
    import uuid
    resolved_db  = db_path or settings.langgraph_db_path
    resolved_tid = thread_id or str(uuid.uuid4())

    async with get_checkpointer(resolved_db) as checkpointer:
        app = build_matcher_graph(checkpointer=checkpointer)
        config = {"configurable": {"thread_id": resolved_tid}}
        result = await app.ainvoke(
            {"job": job, "resume_text": resume_text, "profile": profile, "messages": []},
            config=config,
        )

    return result["result"]


async def batch_match(
    jobs: list[JobListing],
    resume_text: str,
    profile: dict[str, Any],
    db_path: str | None = None,
    concurrency: int = 3,
) -> list[MatchResult]:
    """
    Score multiple jobs concurrently (up to `concurrency` at a time).
    Returns results in the same order as `jobs`.
    """
    import asyncio
    import uuid

    semaphore = asyncio.Semaphore(concurrency)

    async def _score_one(job: JobListing) -> MatchResult:
        async with semaphore:
            return await run_matcher(
                job=job,
                resume_text=resume_text,
                profile=profile,
                thread_id=str(uuid.uuid4()),
                db_path=db_path,
            )

    return list(await asyncio.gather(*[_score_one(j) for j in jobs]))
