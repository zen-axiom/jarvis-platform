"""Mask secret-shaped strings before anything is logged or displayed.

Phase 1A handles no real secrets; this exists so the habit and tests are in place.
"""

from __future__ import annotations

import re
from typing import Any

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("pem", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")),
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    ("api_key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")),
    ("google_key", re.compile(r"\bAIza[A-Za-z0-9_-]{20,}")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    (
        "query_secret",
        re.compile(r"(?i)([?&](?:api[_-]?key|token|access_token|key|secret)=)[^&\s]+"),
    ),
    (
        "labelled_secret",
        re.compile(
            r"(?i)\b((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*)"
            r"(?!<redacted)[^\s,;\"'&]{4,}"
        ),
    ),
    ("hex_blob", re.compile(r"\b[A-Fa-f0-9]{40,}\b")),
)

_SENSITIVE_KEY_RE = re.compile(
    r"(?i)(password|passwd|secret|token|api[_-]?key|authorization|credential)"
)


def redact(text: str) -> str:
    out = text
    for name, pattern in _PATTERNS:
        if name in ("query_secret", "labelled_secret"):
            out = pattern.sub(lambda m, n=name: f"{m.group(1)}<redacted:{n}>", out)
        else:
            out = pattern.sub(f"<redacted:{name}>", out)
    return out


def redact_obj(value: Any) -> Any:
    """Recursively redact strings; values under sensitive-looking keys are masked entirely."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {
            k: ("<redacted:key>" if _SENSITIVE_KEY_RE.search(str(k)) else redact_obj(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_obj(v) for v in value]
    return value
