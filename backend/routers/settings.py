"""
Router for managing user settings:
- AI provider API keys (Anthropic, OpenAI, Gemini, DeepSeek, Groq,
  Hugging Face, Mistral AI, OpenRouter, Cohere)
- Platform login credentials (LinkedIn, Indeed, Glassdoor, etc.)
"""
from __future__ import annotations

import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, Dict

from backend.database import get_db
from backend.models.db_models import Settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Keys stored in the Settings table
AI_KEY_NAMES = {
    "anthropic":   "api_key_anthropic",
    "openai":      "api_key_openai",
    "gemini":      "api_key_gemini",
    "deepseek":    "api_key_deepseek",
    "groq":        "api_key_groq",
    "huggingface": "api_key_huggingface",
    "mistral":     "api_key_mistral",
    "openrouter":  "api_key_openrouter",
    "cohere":      "api_key_cohere",
    "ollama":      "ollama_model",  # stores model name, not a key
}

PLATFORM_CRED_NAMES = {
    "linkedin": {"email": "cred_linkedin_email", "password": "cred_linkedin_password"},
    "indeed": {"email": "cred_indeed_email", "password": "cred_indeed_password"},
    "glassdoor": {"email": "cred_glassdoor_email", "password": "cred_glassdoor_password"},
    "ziprecruiter": {"email": "cred_ziprecruiter_email", "password": "cred_ziprecruiter_password"},
}

USER_PROFILE_KEYS = ["profile_name", "profile_email", "profile_phone", "profile_linkedin_url"]


# ── Schemas ───────────────────────────────────────────────────────────────────


class AIKeysUpdate(BaseModel):
    anthropic:   Optional[str] = None
    openai:      Optional[str] = None
    gemini:      Optional[str] = None
    deepseek:    Optional[str] = None
    groq:        Optional[str] = None
    huggingface: Optional[str] = None
    mistral:     Optional[str] = None
    openrouter:  Optional[str] = None
    cohere:      Optional[str] = None
    ollama:      Optional[str] = None  # model name, not a key
    active_provider: Optional[str] = None  # which provider to use for analysis


class PlatformCreds(BaseModel):
    email: str
    password: str


class UserProfile(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get(db: Session, key: str) -> Optional[str]:
    row = db.query(Settings).filter(Settings.key == key).first()
    return row.value if row else None


def _set(db: Session, key: str, value: str):
    row = db.query(Settings).filter(Settings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Settings(key=key, value=value))
    db.commit()


def _mask(value: Optional[str]) -> Optional[str]:
    """Return masked version of secret — shows last 4 chars."""
    if not value:
        return None
    if len(value) <= 4:
        return "****"
    return "•" * (len(value) - 4) + value[-4:]


def _check_ollama_health() -> tuple[bool, list[str]]:
    """
    Check if Ollama is running and list installed models.
    Returns (available: bool, models: list[str])
    Uses a 2-second timeout to fail fast if Ollama isn't running.
    """
    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    try:
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"{ollama_host.rstrip('/')}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            return True, models
    except Exception:
        # Any error (timeout, connection refused, parse error) → Ollama unavailable
        return False, []


# ── AI Keys ───────────────────────────────────────────────────────────────────


@router.get("/ai-keys")
def get_ai_keys(db: Session = Depends(get_db)):
    """Return masked API keys, active provider, and Ollama availability."""
    result: dict = {
        provider: _mask(_get(db, key_name))
        for provider, key_name in AI_KEY_NAMES.items()
    }
    result["active_provider"] = _get(db, "active_provider") or "anthropic"

    # Check Ollama availability and list models
    ollama_available, ollama_models = _check_ollama_health()
    result["ollama_available"] = ollama_available
    result["ollama_models"] = ollama_models

    return result


@router.put("/ai-keys")
def update_ai_keys(req: AIKeysUpdate, db: Session = Depends(get_db)):
    """Save API keys. Empty string clears the key."""
    for provider, key_name in AI_KEY_NAMES.items():
        value = getattr(req, provider, None)
        if value is not None:
            if value.strip():
                _set(db, key_name, value.strip())
            else:
                # Clear key
                db.query(Settings).filter(Settings.key == key_name).delete()
                db.commit()
    if req.active_provider:
        if req.active_provider not in AI_KEY_NAMES:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown provider '{req.active_provider}'. Valid: {', '.join(AI_KEY_NAMES.keys())}",
            )
        _set(db, "active_provider", req.active_provider)
    return {"message": "AI keys updated"}


@router.get("/ollama-status")
def get_ollama_status():
    """Check if Ollama is running and list installed models."""
    available, models = _check_ollama_health()
    return {
        "available": available,
        "models": models,
    }


# ── Platform Credentials ───────────────────────────────────────────────────────


@router.get("/platforms")
def get_platform_creds(db: Session = Depends(get_db)):
    """Return masked platform credentials."""
    result = {}
    for platform, keys in PLATFORM_CRED_NAMES.items():
        email = _get(db, keys["email"])
        password = _get(db, keys["password"])
        result[platform] = {
            "email": email or None,
            "has_password": bool(password),
        }
    return result


@router.put("/platforms/{platform}")
def update_platform_creds(
    platform: str, req: PlatformCreds, db: Session = Depends(get_db)
):
    """Save login credentials for a job platform."""
    if platform not in PLATFORM_CRED_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown platform '{platform}'. Valid: {', '.join(PLATFORM_CRED_NAMES.keys())}",
        )
    keys = PLATFORM_CRED_NAMES[platform]
    _set(db, keys["email"], req.email)
    _set(db, keys["password"], req.password)
    return {
        "message": f"Credentials saved for {platform}",
        "warning": (
            "⚠️ For security, use a dedicated 'burn account' created specifically for "
            "automation — never your primary account. Automated login may violate the "
            "platform's Terms of Service."
        ),
    }


@router.delete("/platforms/{platform}")
def delete_platform_creds(platform: str, db: Session = Depends(get_db)):
    """Remove stored credentials for a platform."""
    if platform not in PLATFORM_CRED_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown platform '{platform}'.")
    keys = PLATFORM_CRED_NAMES[platform]
    for key in keys.values():
        db.query(Settings).filter(Settings.key == key).delete()
    db.commit()
    return {"message": f"Credentials removed for {platform}"}


# ── User Profile ───────────────────────────────────────────────────────────────


@router.get("/profile")
def get_user_profile(db: Session = Depends(get_db)):
    """Return the user's profile used to auto-fill application forms."""
    return {
        "name": _get(db, "profile_name"),
        "email": _get(db, "profile_email"),
        "phone": _get(db, "profile_phone"),
        "linkedin_url": _get(db, "profile_linkedin_url"),
    }


@router.put("/profile")
def update_user_profile(req: UserProfile, db: Session = Depends(get_db)):
    """Update the user profile for application form auto-fill."""
    mapping = {
        "name": "profile_name",
        "email": "profile_email",
        "phone": "profile_phone",
        "linkedin_url": "profile_linkedin_url",
    }
    for field, key in mapping.items():
        value = getattr(req, field, None)
        if value is not None:
            _set(db, key, value)
    return {"message": "Profile updated"}


# ── Helper for other services ────────────────────────────────────────────────


def get_active_provider_key(db: Session) -> tuple[str, str]:
    """
    Returns (provider_name, api_key) for the active AI provider.
    Used by the analysis service to pick the right SDK.
    For Ollama the 'key' field stores the model name (optional).

    Auto-detection: If no provider is explicitly configured AND no API keys exist,
    checks if Ollama is running. If yes, uses Ollama as fallback with empty model string.
    """
    active_provider = _get(db, "active_provider")

    # If no provider is set, check if any API keys exist
    if not active_provider:
        # Check if any AI key is configured
        has_any_key = any(_get(db, key_name) for key_name in AI_KEY_NAMES.values())

        if not has_any_key:
            # No provider set AND no API keys → try Ollama auto-detection
            ollama_available, _ = _check_ollama_health()
            if ollama_available:
                return "ollama", ""  # Use Ollama with default model
            else:
                raise ValueError(
                    "No AI provider configured and Ollama is not running. "
                    "Go to Settings → AI Keys to add an API key, or install and start Ollama."
                )
        else:
            # Some keys exist but no provider set → default to anthropic
            provider = "anthropic"
    else:
        provider = active_provider

    key_name = AI_KEY_NAMES.get(provider)
    if not key_name:
        raise ValueError(f"Unknown provider: {provider}")
    api_key = _get(db, key_name) or ""

    # Ollama runs locally — no API key required
    if not api_key and provider != "ollama":
        raise ValueError(
            f"No API key configured for provider '{provider}'. "
            "Go to Settings → AI Keys to add one."
        )
    return provider, api_key
