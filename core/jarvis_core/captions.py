"""Speech/caption separation and the Roman-only caption guard.

Captions shown in the HUD must never contain Urdu/Arabic script. English captions
must equal the English speech text. speech_text is a separate field for future TTS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CAPTION_LANGS = ("en", "ur-roman", "ur-en")
CAPTION_PLACEHOLDER = "[caption unavailable]"

# Arabic, Arabic Supplement, Arabic Extended-A, Presentation Forms A and B.
ARABIC_SCRIPT_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
# ZWNJ/ZWJ/LRM/RLM, bidi embeddings/overrides, bidi isolates.
BIDI_CONTROL_RE = re.compile(r"[‌-‏‪-‮⁦-⁩]")


@dataclass(frozen=True)
class CaptionPair:
    lang: str
    speech_text: str
    caption_text: str


@dataclass(frozen=True)
class CaptionCheck:
    ok: bool
    reason: str | None = None


def contains_arabic_script(text: str) -> bool:
    return ARABIC_SCRIPT_RE.search(text) is not None


def validate_caption(pair: CaptionPair) -> CaptionCheck:
    """Check order is part of the contract (shared fixtures rely on it)."""
    if pair.lang not in CAPTION_LANGS:
        return CaptionCheck(False, "unknown_lang")
    if not pair.caption_text.strip():
        return CaptionCheck(False, "empty_caption")
    if contains_arabic_script(pair.caption_text):
        return CaptionCheck(False, "arabic_script")
    if BIDI_CONTROL_RE.search(pair.caption_text):
        return CaptionCheck(False, "bidi_control")
    if pair.lang == "en" and pair.caption_text != pair.speech_text:
        return CaptionCheck(False, "english_mismatch")
    return CaptionCheck(True)


def safe_caption(pair: CaptionPair) -> str:
    """The text the HUD may display: the caption if valid, else a neutral placeholder."""
    return pair.caption_text if validate_caption(pair).ok else CAPTION_PLACEHOLDER
