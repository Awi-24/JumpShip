"""
Encryption utilities for storing sensitive credentials (IMAP/LinkedIn passwords) in SQLite.
Uses cryptography.fernet for symmetric encryption.
"""
from __future__ import annotations

import os
import base64
import logging
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from backend.config import settings

logger = logging.getLogger(__name__)

# Use a fixed salt for the derived key (since we only have one secret key)
_SALT = b"jumpship-salt-2026"

def _get_fernet() -> Fernet:
    """Derive a Fernet key from the SECRET_KEY in settings."""
    secret = settings.secret_key or "dev-secret-change-me-in-production"
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    return Fernet(key)

def encrypt(text: str | None) -> str | None:
    if not text:
        return None
    try:
        f = _get_fernet()
        return f.encrypt(text.encode()).decode()
    except Exception as e:
        logger.error("Encryption failed: %s", e)
        return None

def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        f = _get_fernet()
        return f.decrypt(token.encode()).decode()
    except Exception as e:
        logger.error("Decryption failed: %s", e)
        return None
