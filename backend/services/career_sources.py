"""
JumpShip — Career source registry.

Loads brazil-career-sources.json and provides filtered views by ATS type.
Validates the data file against a minimal jsonschema on import (I-013).
"""
from __future__ import annotations

import json
import pathlib
from functools import lru_cache

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

_DATA_FILE = pathlib.Path(__file__).parent.parent / "data" / "brazil-career-sources.json"

# Minimal schema covering the top-level keys observed in the file.
# Source entries are required to carry id/name/listing_url/ats; the optional
# `api` block, when present, must specify a provider.
_SCHEMA: dict = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["version", "schema_version", "sources"],
    "properties": {
        "version": {"type": "string"},
        "schema_version": {"type": "string"},
        "generated_at": {"type": "string"},
        "description": {"type": "string"},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name", "listing_url", "ats"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                    "sectors": {"type": "array", "items": {"type": "string"}},
                    "listing_url": {"type": "string", "minLength": 1},
                    "ats": {"type": "string", "minLength": 1},
                    "api": {
                        "anyOf": [
                            {"type": "null"},
                            {
                                "type": "object",
                                "required": ["provider"],
                                "properties": {
                                    "provider": {"type": "string", "minLength": 1},
                                },
                            },
                        ],
                    },
                    "ingestion_notes": {"type": ["string", "null"]},
                },
            },
        },
    },
}

_VALIDATOR = Draft202012Validator(_SCHEMA)


def _validate(payload: dict) -> None:
    errors = sorted(_VALIDATOR.iter_errors(payload), key=lambda e: e.path)
    if errors:
        first = errors[0]
        path = "/".join(str(p) for p in first.absolute_path) or "<root>"
        raise ValidationError(
            f"{_DATA_FILE} failed schema validation at {path}: {first.message}"
        )


@lru_cache(maxsize=1)
def load_sources() -> list[dict]:
    payload = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    _validate(payload)
    return payload["sources"]


# Validate eagerly on import so misconfiguration fails fast at startup.
load_sources()


def get_by_ats(ats: str) -> list[dict]:
    """Return all sources with a matching ATS type that have an api config."""
    return [s for s in load_sources() if s.get("ats") == ats and s.get("api")]
