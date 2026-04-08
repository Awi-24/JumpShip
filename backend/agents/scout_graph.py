"""
JumpShip V2 — Scout Agent (LangGraph).

Discovers job listings from the user's resume and preferences.

Graph flow:
  [START] → generate_queries → scrape_jobs → deduplicate → [END]

The LLM (gemma3:27b via Ollama) reads the resume to synthesise smart
jobspy queries rather than relying on the user typing keywords manually.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from backend.agents import get_checkpointer
from backend.agents.llm import get_llm
from backend.agents.state import JobListing, ScoutState
from backend.config import settings

logger = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────────────

_QUERY_SYSTEM = (
    "You are a job search strategist. Given a resume and user preferences, "
    "generate a list of optimised job search queries. "
    "Respond with a JSON array of query strings only — no prose, no markdown fences."
)

_QUERY_USER = """Resume:
{resume}

Preferences:
- Location: {location}
- Work type: {work_type}
- Min experience years needed: {min_years}
- Desired roles / keywords: {keywords}

Generate 3-6 focused search query strings that will find the best matching jobs.
Return ONLY a JSON array, e.g.: ["software engineer Python remote", "backend developer FastAPI"]"""


# ── Nodes ─────────────────────────────────────────────────────────────────────

async def generate_queries(state: ScoutState) -> dict:
    """Use LLM to derive optimised jobspy search queries from the resume."""
    prefs = state.get("preferences", {})
    llm   = get_llm()

    prompt = _QUERY_USER.format(
        resume   = (state.get("resume_text") or "")[:3000],
        location = prefs.get("location", "Remote"),
        work_type= prefs.get("work_type", "any"),
        min_years= prefs.get("min_years", 0),
        keywords = ", ".join(prefs.get("keywords", [])) or "software engineer",
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=_QUERY_SYSTEM),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip()
        # Strip markdown fences if model wraps in ```json ... ```
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        queries: list[str] = json.loads(raw)
        if not isinstance(queries, list):
            raise ValueError("Expected a JSON array")
    except Exception as exc:
        logger.warning("Query generation failed (%s) — falling back to defaults", exc)
        queries = [prefs.get("keywords", ["software engineer"])[0] if prefs.get("keywords") else "software engineer"]

    logger.info("Scout generated %d queries: %s", len(queries), queries)
    return {"search_queries": queries, "messages": [HumanMessage(content=f"Generated {len(queries)} queries")]}


async def scrape_jobs(state: ScoutState) -> dict:
    """Run job_scraper_v2 for each generated query and accumulate raw results."""
    from backend.services.job_scraper_v2 import search_jobs

    prefs   = state.get("preferences", {})
    queries = state.get("search_queries", [])
    errors: list[str] = []
    all_raw: list[dict] = []

    for query in queries:
        try:
            results = await search_jobs(
                keywords       = [query],
                location       = prefs.get("location", "Remote"),
                results_wanted = prefs.get("results_per_query", 15),
                sites          = prefs.get("sites", ["linkedin", "indeed", "google"]),
                job_type       = prefs.get("job_type", "fulltime"),
            )
            all_raw.extend(results)
            logger.debug("Query '%s' → %d results", query, len(results))
        except Exception as exc:
            msg = f"Scrape failed for '{query}': {exc}"
            logger.warning(msg)
            errors.append(msg)

    return {"raw_results": all_raw, "errors": errors}


async def deduplicate(state: ScoutState) -> dict:
    """Deduplicate raw results by URL and normalise into JobListing objects."""
    seen_urls: set[str] = set()
    jobs: list[JobListing] = []

    for row in state.get("raw_results", []):
        url = row.get("job_url") or row.get("job_url_direct") or ""
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        jobs.append(JobListing(
            id          = row.get("id") or url,
            title       = row.get("title", ""),
            company     = row.get("company_name", ""),
            url         = url,
            description = row.get("description", ""),
            location    = ", ".join(filter(None, [
                row.get("location_city"),
                row.get("location_state"),
                row.get("location_country"),
            ])),
            is_remote   = bool(row.get("is_remote")),
            site        = row.get("site", ""),
            date_posted = row.get("date_posted", ""),
            raw         = row,
        ))

    logger.info("Scout deduplicated → %d unique jobs", len(jobs))
    return {"jobs": jobs}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_scout_graph(checkpointer=None) -> Any:
    """
    Build and compile the Scout StateGraph.

    Args:
        checkpointer: Optional LangGraph checkpointer (AsyncSqliteSaver).
                      Pass None for unit tests or one-shot calls.
    """
    graph = StateGraph(ScoutState)
    graph.add_node("generate_queries", generate_queries)
    graph.add_node("scrape_jobs", scrape_jobs)
    graph.add_node("deduplicate", deduplicate)

    graph.add_edge(START, "generate_queries")
    graph.add_edge("generate_queries", "scrape_jobs")
    graph.add_edge("scrape_jobs", "deduplicate")
    graph.add_edge("deduplicate", END)

    return graph.compile(checkpointer=checkpointer)


# ── Convenience runner ────────────────────────────────────────────────────────

async def run_scout(
    resume_text: str,
    preferences: dict[str, Any],
    thread_id: str | None = None,
    db_path: str | None = None,
) -> list[JobListing]:
    """
    High-level helper: run the Scout graph and return discovered jobs.

    Args:
        resume_text:  Full text of the user's resume.
        preferences:  Dict with keys: location, work_type, keywords, sites, etc.
        thread_id:    LangGraph thread ID for checkpointing (auto-generated if None).
        db_path:      Path to SQLite checkpoint DB (defaults to settings.langgraph_db_path).
    """
    import uuid
    resolved_db  = db_path or settings.langgraph_db_path
    resolved_tid = thread_id or str(uuid.uuid4())

    async with get_checkpointer(resolved_db) as checkpointer:
        app = build_scout_graph(checkpointer=checkpointer)
        config = {"configurable": {"thread_id": resolved_tid}}
        result = await app.ainvoke(
            {"resume_text": resume_text, "preferences": preferences, "messages": []},
            config=config,
        )

    return result.get("jobs", [])
