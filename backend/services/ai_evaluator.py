"""
Multi-provider AI evaluator.
Supports: Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek,
          Groq, Hugging Face, Mistral AI, OpenRouter, Cohere, Ollama (local).

JSON output is enforced via:
- Anthropic   → tool_use (guaranteed structured output)
- OpenAI      → response_format: json_object
- DeepSeek    → response_format: json_object
- Groq        → response_format: json_object
- Mistral     → response_format: json_object
- OpenRouter  → response_format: json_object (passed through to underlying model)
- Cohere      → response_format: json_object (v2 API)
- Gemini      → response_mime_type: application/json  (1.5-flash supports it)
- HuggingFace → prompt-based (Serverless Inference API, varies by model)
- Ollama      → response_format: json_object (local model, no API key needed)
- All         → fallback: strip markdown fences + extract JSON block + 1 retry
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional

# ── JSON schema used for analysis ─────────────────────────────────────────────

ANALYSIS_SCHEMA = {
    "type": "object",
    "required": ["score", "summary", "strengths", "gaps", "suggestions",
                 "keywords_matched", "keywords_missing"],
    "properties": {
        "score":             {"type": "integer", "minimum": 0, "maximum": 100},
        "summary":           {"type": "string"},
        "strengths":         {"type": "array", "items": {"type": "string"}},
        "gaps":              {"type": "array", "items": {"type": "string"}},
        "suggestions":       {"type": "array", "items": {"type": "string"}},
        "keywords_matched":  {"type": "array", "items": {"type": "string"}},
        "keywords_missing":  {"type": "array", "items": {"type": "string"}},
    },
}

# ── Prompts ────────────────────────────────────────────────────────────────────

ANALYSIS_SYSTEM_PROMPT = (
    "You are an expert HR consultant and career coach specialising in resume "
    "optimisation and job matching. Analyse the candidate's resume against the "
    "job description and provide structured, actionable feedback. "
    "Respond ONLY with valid JSON — no markdown fences, no prose outside the JSON."
)

ANALYSIS_USER_PROMPT = """Analyse this resume against the job description below.

## RESUME
{resume}

## JOB DESCRIPTION
{job_description}
Job Title: {job_title} at {company_name}

Return EXACTLY this JSON structure (no extra keys, no markdown):
{{
  "score": <integer 0-100>,
  "summary": "<2-3 sentence fit summary>",
  "strengths": ["<strength with evidence>"],
  "gaps": ["<gap or missing requirement>"],
  "suggestions": ["<actionable improvement>"],
  "keywords_matched": ["<keyword found in resume>"],
  "keywords_missing": ["<keyword absent from resume>"]
}}"""

TAILORED_RESUME_PROMPT = """You are an expert resume writer. Rewrite the resume to maximise its relevance for this job.

## ORIGINAL RESUME
{resume}

## TARGET JOB
Title: {job_title} at {company_name}
{job_description}

## CONTEXT
Compatibility score: {score}/100
Gaps to address: {gaps}
Missing keywords to weave in: {missing_keywords}

Rules:
1. Do NOT invent experience or skills
2. Reorder and rephrase to highlight most relevant content first
3. Weave in missing keywords where legitimately applicable
4. Tailor the professional summary to this role
5. Use strong action verbs; quantify achievements where possible
6. Plain text output only — use --- for section dividers

Return ONLY the tailored resume text."""


# ── JSON cleaning helpers ──────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` wrappers."""
    text = text.strip()
    # Remove leading fence (with optional language tag)
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    # Remove trailing fence
    text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _extract_json_object(text: str) -> str:
    """
    Pull the first {...} block from text — useful when a model adds a preamble
    before the JSON despite being told not to.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def _clean_and_parse(raw: str) -> dict:
    """Try to parse JSON, progressively cleaning the response."""
    # 1. Strip markdown fences
    cleaned = _strip_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 2. Try extracting the first JSON object
    extracted = _extract_json_object(cleaned)
    try:
        return json.loads(extracted)
    except json.JSONDecodeError:
        pass

    # 3. Give up — raise with useful context
    preview = raw[:500].replace("\n", "\\n")
    raise ValueError(f"AI returned non-parseable JSON.\nPreview: {preview}")


# ── Provider adapters ──────────────────────────────────────────────────────────

def _call_anthropic(api_key: str, system: str, user: str,
                    max_tokens: int = 2048,
                    json_schema: Optional[dict] = None) -> str:
    """
    Use tool_use with a strict JSON schema when json_schema is provided —
    this guarantees a valid JSON response from Claude.
    """
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    if json_schema:
        # Tool-use forces structured output
        tools = [{
            "name": "structured_output",
            "description": "Return the analysis result as structured data.",
            "input_schema": json_schema,
        }]
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=system,
            tools=tools,
            tool_choice={"type": "tool", "name": "structured_output"},
            messages=[{"role": "user", "content": user}],
        )
        # Extract the tool_use block
        for block in msg.content:
            if block.type == "tool_use" and block.name == "structured_output":
                return json.dumps(block.input)
        # Fallback: try text block
        for block in msg.content:
            if hasattr(block, "text"):
                return block.text.strip()
        raise ValueError("Anthropic returned no usable content block.")
    else:
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text.strip()


def _call_openai(api_key: str, system: str, user: str,
                 max_tokens: int = 2048,
                 json_schema: Optional[dict] = None) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    kwargs: dict = dict(
        model="gpt-4o-mini",
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


def _call_gemini(api_key: str, system: str, user: str,
                 max_tokens: int = 2048,
                 json_schema: Optional[dict] = None) -> str:
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    gen_config: dict = {"max_output_tokens": max_tokens}
    if json_schema:
        gen_config["response_mime_type"] = "application/json"

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system,
        generation_config=gen_config,
    )
    resp = model.generate_content(user)
    return resp.text.strip()


def _call_deepseek(api_key: str, system: str, user: str,
                   max_tokens: int = 2048,
                   json_schema: Optional[dict] = None) -> str:
    # DeepSeek uses an OpenAI-compatible API
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    kwargs: dict = dict(
        model="deepseek-chat",
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


def _call_groq(api_key: str, system: str, user: str,
               max_tokens: int = 2048,
               json_schema: Optional[dict] = None) -> str:
    """Groq — extremely fast Llama 3 inference. Generous free daily limits."""
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    kwargs: dict = dict(
        model="llama-3.3-70b-versatile",
        max_tokens=max_tokens,
        messages=messages,
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


def _call_huggingface(api_key: str, system: str, user: str,
                      max_tokens: int = 2048,
                      json_schema: Optional[dict] = None) -> str:
    """
    Hugging Face Serverless Inference API — thousands of open-source models.
    Uses Qwen2.5-72B-Instruct (strong, free tier).
    """
    from openai import OpenAI
    client = OpenAI(
        api_key=api_key,
        base_url="https://api-inference.huggingface.co/v1/",
    )
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    # HF serverless inference doesn't reliably support response_format — use prompt only
    resp = client.chat.completions.create(
        model="Qwen/Qwen2.5-72B-Instruct",
        max_tokens=max_tokens,
        messages=messages,
    )
    return resp.choices[0].message.content.strip()


def _call_mistral(api_key: str, system: str, user: str,
                  max_tokens: int = 2048,
                  json_schema: Optional[dict] = None) -> str:
    """Mistral AI — 'La Plateforme' free Experiment tier."""
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1/")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    kwargs: dict = dict(
        model="mistral-small-latest",
        max_tokens=max_tokens,
        messages=messages,
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


def _call_openrouter(api_key: str, system: str, user: str,
                     max_tokens: int = 2048,
                     json_schema: Optional[dict] = None) -> str:
    """
    OpenRouter — aggregator for dozens of models, including rotating free ones.
    Uses Llama 3.2 3B (always free).
    """
    from openai import OpenAI
    client = OpenAI(
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={
            "HTTP-Referer": "https://github.com/jumpship-app",
            "X-Title": "Jumpship",
        },
    )
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    kwargs: dict = dict(
        model="meta-llama/llama-3.2-3b-instruct:free",
        max_tokens=max_tokens,
        messages=messages,
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


def _call_cohere(api_key: str, system: str, user: str,
                 max_tokens: int = 2048,
                 json_schema: Optional[dict] = None) -> str:
    """Cohere — Trial key is free for development with generous rate limits."""
    import httpx
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    payload: dict = {
        "model": "command-r",
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if json_schema:
        payload["response_format"] = {"type": "json_object"}
    resp = httpx.post(
        "https://api.cohere.com/v2/chat",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    # Cohere v2 response: data["message"]["content"][0]["text"]
    try:
        return data["message"]["content"][0]["text"].strip()
    except (KeyError, IndexError, TypeError):
        # Fallback for older response shapes
        return data.get("text", "").strip()


def _call_ollama(api_key: str, system: str, user: str,
                 max_tokens: int = 2048,
                 json_schema: Optional[dict] = None) -> str:
    """
    Ollama — run LLMs locally, zero cost, no internet required.
    Requires Ollama running on localhost:11434.
    The 'api_key' field stores the model name (e.g. 'llama3.2', 'mistral',
    'qwen2.5', 'deepseek-r1'). Defaults to 'llama3.2' if blank.
    """
    from openai import OpenAI
    model_name = api_key.strip() if api_key and api_key.strip() else "llama3.2"
    # OLLAMA_HOST env var allows Docker to reach the host machine's Ollama instance.
    # Default is localhost for native/start.sh usage; Docker sets host.docker.internal.
    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    # Large timeout: local models take time to load into memory on first call,
    # especially on slower disks or machines with limited RAM.
    client = OpenAI(
        api_key="ollama",  # Ollama ignores the key but the client requires one
        base_url=f"{ollama_host.rstrip('/')}/v1/",
        timeout=300.0,  # 5 minutes — covers cold-start model loading
    )
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    kwargs: dict = dict(
        model=model_name,
        max_tokens=max_tokens,
        messages=messages,
    )
    if json_schema:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content.strip()


PROVIDER_CALLERS = {
    "anthropic":   _call_anthropic,
    "openai":      _call_openai,
    "gemini":      _call_gemini,
    "deepseek":    _call_deepseek,
    "groq":        _call_groq,
    "huggingface": _call_huggingface,
    "mistral":     _call_mistral,
    "openrouter":  _call_openrouter,
    "cohere":      _call_cohere,
    "ollama":      _call_ollama,
}


def _call_provider(provider: str, api_key: str, system: str, user: str,
                   max_tokens: int = 2048,
                   json_schema: Optional[dict] = None) -> str:
    caller = PROVIDER_CALLERS.get(provider)
    if not caller:
        raise ValueError(
            f"Unknown AI provider: '{provider}'. "
            f"Valid: {', '.join(PROVIDER_CALLERS.keys())}"
        )
    return caller(api_key, system, user, max_tokens, json_schema)


# ── Public interface ───────────────────────────────────────────────────────────

_ANALYSIS_DEFAULTS = {
    "score": 0,
    "summary": "",
    "strengths": [],
    "gaps": [],
    "suggestions": [],
    "keywords_matched": [],
    "keywords_missing": [],
}


def analyse_resume(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company_name: str = "",
    provider: str = "anthropic",
    api_key: Optional[str] = None,
) -> dict:
    """
    Analyse resume against job description.
    Returns dict with score, strengths, gaps, suggestions, keywords_*.
    Uses provider-native structured output (tool_use / json_object / json mime)
    for guaranteed JSON.
    """
    if not api_key:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
    # Ollama is local — no API key required (the key field holds the model name instead)
    if not api_key and provider != "ollama":
        raise ValueError(
            f"No API key provided for provider '{provider}'. "
            "Add one in Settings → AI Keys."
        )

    user_prompt = ANALYSIS_USER_PROMPT.format(
        resume=resume_text[:8000],
        job_description=job_description[:6000],
        job_title=job_title,
        company_name=company_name,
    )

    raw = _call_provider(
        provider, api_key,
        ANALYSIS_SYSTEM_PROMPT, user_prompt,
        max_tokens=2048,
        json_schema=ANALYSIS_SCHEMA,
    )

    # For Anthropic tool_use the result is already valid JSON; for others clean it
    try:
        result = _clean_and_parse(raw)
    except ValueError:
        # One retry: ask the model to fix its own output
        repair_prompt = (
            "The following text should be valid JSON but isn't. "
            "Return ONLY the corrected JSON with no extra text:\n\n" + raw[:2000]
        )
        raw2 = _call_provider(
            provider, api_key,
            "You are a JSON repair assistant. Output only valid JSON.",
            repair_prompt,
            max_tokens=2048,
            json_schema=None,  # No schema enforcement on repair — keep it simple
        )
        result = _clean_and_parse(raw2)

    # Fill missing keys with safe defaults
    for key, default in _ANALYSIS_DEFAULTS.items():
        result.setdefault(key, default)

    # Coerce score to int in [0, 100]
    try:
        result["score"] = max(0, min(100, int(result["score"])))
    except (TypeError, ValueError):
        result["score"] = 0

    return result


def generate_tailored_resume(
    resume_text: str,
    job_description: str,
    job_title: str,
    company_name: str,
    analysis: Optional[dict] = None,
    provider: str = "anthropic",
    api_key: Optional[str] = None,
) -> str:
    """Generate a tailored resume for a specific job. Returns plain text."""
    if not api_key:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key and provider != "ollama":
        raise ValueError(f"No API key provided for provider '{provider}'.")

    gaps = ", ".join((analysis or {}).get("gaps", [])[:3]) or "N/A"
    missing_kw = ", ".join((analysis or {}).get("keywords_missing", [])[:10]) or "N/A"
    score = (analysis or {}).get("score", "N/A")

    prompt = TAILORED_RESUME_PROMPT.format(
        resume=resume_text[:8000],
        job_description=job_description[:5000],
        job_title=job_title,
        company_name=company_name,
        score=score,
        gaps=gaps,
        missing_keywords=missing_kw,
    )

    # Tailored resume is plain text — no JSON schema needed
    return _call_provider(provider, api_key, "", prompt, max_tokens=4096, json_schema=None)
