"""
JumpShip — shared keyword matching: accent folding + word-boundary search.

"java" must not match "javascript", "Sênior" must match "senior", and
"c++", "c#", ".net" and multi-word phrases must work.
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache


def fold(s: str) -> str:
    """NFKD, drop combining marks, casefold, collapse whitespace."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.casefold()).strip()


@lru_cache(maxsize=256)
def _pattern(keywords: tuple[str, ...]) -> re.Pattern | None:
    parts = []
    for kw in keywords:
        k = fold(kw)
        if not k:
            continue
        # Boundary only where the keyword edge is a word char ("c++" has none at the end).
        lead = r"(?<!\w)" if re.match(r"\w", k[0]) else ""
        trail = r"(?!\w)" if re.match(r"\w", k[-1]) else ""
        parts.append(f"{lead}{re.escape(k)}{trail}")
    return re.compile("|".join(parts)) if parts else None


def matches_any(keywords: list[str] | None, *texts: str) -> bool:
    """True when `keywords` is empty or any keyword appears (as a whole word/phrase) in any text."""
    pat = _pattern(tuple(keywords or ()))
    if pat is None:
        return True
    return bool(pat.search(fold(" ".join(t for t in texts if t))))
