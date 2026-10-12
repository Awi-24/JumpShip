"""
LLM prompt templates live next to this file as ``<name>.txt``; see README.md for the catalogue.

``load(name)``   -> the file text (exactly one trailing newline is stripped, so a prompt
                    that must end in a newline keeps an extra blank last line in its file).
``render(name, **fields)`` -> ``load(name).format(**fields)``. Only prompts documented as
                    templates are rendered; their literal braces are doubled (``{{`` / ``}}``).
                    Static prompts are used via ``load`` and keep single braces.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


@lru_cache(maxsize=None)
def load(name: str) -> str:
    text = (_DIR / f"{name}.txt").read_text(encoding="utf-8")
    return text[:-1] if text.endswith("\n") else text


def render(name: str, /, **fields: object) -> str:
    return load(name).format(**fields)
