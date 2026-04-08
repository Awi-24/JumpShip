"""
JumpShip V2 — Apply Agent (LangGraph).

Stateful graph that tailors a resume then submits a job application.

Graph flow:
  [START] → tailor_resume → apply_job ──(success/failed)──→ [END]
                                    ↓ (needs_help)
                                 [INTERRUPT: wait for user]
                                    ↓ (hitl_response set)
                                 apply_job (resumed)

Human-in-the-loop (HITL) is implemented via LangGraph's interrupt().
When the browser agent encounters a CAPTCHA, login wall, or unknown
question it sets state["hitl_question"]. The graph pauses; the frontend
sends the answer over WebSocket; the orchestrator resumes with the
answer in state["hitl_response"].
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from backend.agents import get_checkpointer

from backend.agents.state import ApplyState, TailoredResume
from backend.config import settings

logger = logging.getLogger(__name__)


# ── Node: tailor_resume ───────────────────────────────────────────────────────

async def tailor_resume(state: ApplyState) -> dict:
    """
    Rewrite the resume to maximise relevance for the target job.
    Skips tailoring if the job has no description or resume text is empty.
    """
    job         = state["job"]
    resume_text = state.get("resume_text", "")

    if not resume_text or not job.get("description"):
        logger.info("Skipping tailoring — no resume text or job description")
        return {
            "tailored_resume": None,
            "status": "applying",
            "messages": [HumanMessage(content="Skipped tailoring")],
        }

    import asyncio
    from backend.services.ai_evaluator import generate_tailored_resume

    llm_model = state.get("llm_model") or settings.llm_model

    try:
        # generate_tailored_resume is synchronous — offload to threadpool
        tailored_text = await asyncio.to_thread(
            generate_tailored_resume,
            resume_text     = resume_text,
            job_description = job["description"],
            job_title       = job["title"],
            company_name    = job["company"],
            provider        = "ollama",
            api_key         = llm_model,  # Ollama uses model name as api_key
        )
        cover_letter = ""   # generate_tailored_resume returns a single string
        result = TailoredResume(
            job_id       = job["id"],
            original     = resume_text,
            tailored     = tailored_text,
            cover_letter = cover_letter,
        )
        logger.info("Tailored resume for '%s' @ %s", job["title"], job["company"])
        return {
            "tailored_resume": result,
            "status": "applying",
            "messages": [HumanMessage(content="Resume tailored")],
        }
    except Exception as exc:
        logger.warning("Tailoring failed (%s) — using original resume", exc)
        return {
            "tailored_resume": None,
            "status": "applying",
            "messages": [HumanMessage(content=f"Tailoring failed: {exc}")],
        }


# ── Node: apply_job ───────────────────────────────────────────────────────────

async def apply_job(state: ApplyState) -> dict:
    """
    Run the Playwright ApplicationAgent to fill and submit the application.

    If the agent raises a HITL request the graph pauses via interrupt().
    The caller resumes by calling .ainvoke() again with hitl_response set.
    """
    from backend.services.apply_agent import ApplicationAgent

    job             = state["job"]
    profile         = state.get("profile", {})
    tailored        = state.get("tailored_resume")
    hitl_response   = state.get("hitl_response")

    # Determine which resume text to use
    resume_text = (tailored["tailored"] if tailored else state.get("resume_text", ""))

    # Status + trace callbacks that emit WebSocket-friendly dicts
    # (the WS router subscribes to updates stored in state["messages"])
    trace_log: list[dict] = []

    async def on_status(msg: str):
        trace_log.append({"event_type": "status", "content": {"message": msg}})

    async def on_trace(evt: dict):
        trace_log.append(evt)

    # Build cancel event — not cancellable within a single node invocation
    # (cancellation is handled by the orchestrator dropping the thread)
    cancel_event = asyncio.Event()

    agent = ApplicationAgent(
        job_url         = job["url"],
        profile         = profile,
        llm_model       = state.get("llm_model")       or settings.llm_model,
        ollama_base_url = state.get("ollama_base_url") or settings.ollama_base_url,
        resume_path     = state.get("resume_path"),
        dry_run         = state.get("dry_run", True),
        headless        = state.get("headless", True),
        status_callback = on_status,
        trace_callback  = on_trace,
        cancel_event    = cancel_event,
        # Pass pre-built resume text so agent skips reload
        _resume_text_override = resume_text,
        # Pass HITL response if user already answered
        _hitl_prefill = hitl_response,
    )

    try:
        result = await asyncio.wait_for(agent.run(), timeout=300)
    except asyncio.TimeoutError:
        return {
            "status": "failed",
            "error": "Application timed out after 300s",
            "messages": [HumanMessage(content="Timed out")],
        }
    except Exception as exc:
        return {
            "status": "failed",
            "error": str(exc)[:300],
            "messages": [HumanMessage(content=f"Crashed: {exc}")],
        }

    final_status = result.get("status", "failed")

    # If the agent needs human help, pause via LangGraph interrupt
    if final_status == "needs_review" and agent.human_help.message:
        question = agent.human_help.message
        logger.info("Apply graph HITL: '%s'", question[:80])
        # interrupt() pauses the graph; the caller must resume with hitl_response
        interrupt({"question": question, "task_id": state.get("task_id")})

    messages = [HumanMessage(content=f"Apply result: {final_status}")]
    messages += [HumanMessage(content=str(e)) for e in trace_log[-5:]]  # last 5 trace events

    return {
        "status": final_status,
        "fields_filled":  result.get("fields_filled", {}),
        "error":          result.get("error", ""),
        "screenshot_path": (result.get("screenshots") or [None])[-1],
        "hitl_question":  agent.human_help.message if final_status == "needs_review" else None,
        "hitl_response":  None,   # clear for next invocation
        "messages": messages,
    }


# ── Conditional routing ───────────────────────────────────────────────────────

def _should_continue(state: ApplyState) -> str:
    status = state.get("status", "failed")
    if status in ("success", "failed", "cancelled"):
        return END
    # needs_help / applying → loop back (after HITL resume)
    return "apply_job"


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_apply_graph(checkpointer=None) -> Any:
    graph = StateGraph(ApplyState)
    graph.add_node("tailor_resume", tailor_resume)
    graph.add_node("apply_job", apply_job)

    graph.add_edge(START, "tailor_resume")
    graph.add_edge("tailor_resume", "apply_job")
    graph.add_conditional_edges("apply_job", _should_continue)

    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=[],   # interrupt is triggered inside apply_job via interrupt()
    )


# ── Convenience runner (used by the new WebSocket orchestrator) ───────────────

async def run_apply(
    job: dict,
    profile: dict[str, Any],
    resume_text: str = "",
    resume_path: str | None = None,
    dry_run: bool = True,
    headless: bool = True,
    llm_model: str | None = None,
    ollama_base_url: str | None = None,
    thread_id: str | None = None,
    db_path: str | None = None,
    on_update: Any = None,
) -> dict:
    """
    Launch an apply graph run.  Returns the final state dict.

    Args:
        on_update: Optional async callable(state_snapshot) called after each node.
    """
    resolved_db  = db_path or settings.langgraph_db_path
    resolved_tid = thread_id or str(uuid.uuid4())

    initial_state: ApplyState = {
        "job":            job,
        "match_result":   {},   # type: ignore
        "profile":        profile,
        "resume_path":    resume_path,
        "resume_text":    resume_text,
        "dry_run":        dry_run,
        "headless":       headless,
        "llm_model":      llm_model or settings.llm_model,
        "ollama_base_url": ollama_base_url or settings.ollama_base_url,
        "tailored_resume": None,
        "task_id":        resolved_tid,
        "status":         "queued",
        "fields_filled":  {},
        "error":          "",
        "screenshot_path": None,
        "hitl_question":  None,
        "hitl_response":  None,
        "messages":       [],
    }

    config = {"configurable": {"thread_id": resolved_tid}}

    async with get_checkpointer(resolved_db) as checkpointer:
        app = build_apply_graph(checkpointer=checkpointer)

        if on_update:
            # Stream events so the WebSocket router can push updates in real-time
            async for event in app.astream_events(initial_state, config=config, version="v2"):
                if event["event"] == "on_chain_end":
                    await on_update(event)
            # Retrieve final state
            snapshot = await app.aget_state(config)
            return snapshot.values
        else:
            return await app.ainvoke(initial_state, config=config)


async def resume_apply(
    thread_id: str,
    hitl_response: str,
    db_path: str | None = None,
    on_update: Any = None,
) -> dict:
    """
    Resume a paused apply graph after the user answered a HITL question.
    """
    resolved_db = db_path or settings.langgraph_db_path
    config      = {"configurable": {"thread_id": thread_id}}

    async with get_checkpointer(resolved_db) as checkpointer:
        app = build_apply_graph(checkpointer=checkpointer)
        # Inject the user's response into the interrupted state
        await app.aupdate_state(config, {"hitl_response": hitl_response, "hitl_question": None})
        return await app.ainvoke(None, config=config)
