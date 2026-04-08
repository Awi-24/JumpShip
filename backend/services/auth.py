"""
Simple API Key authentication for sensitive endpoints.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from starlette.status import HTTP_403_FORBIDDEN

from backend.config import settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    """
    Dependency that checks for X-API-Key header.
    Only active if settings.api_key is set.
    """
    if not settings.api_key:
        # Auth disabled (default for local MVP)
        return None
    
    if api_key == settings.api_key:
        return api_key
    
    raise HTTPException(
        status_code=HTTP_403_FORBIDDEN,
        detail="Invalid or missing API Key"
    )
