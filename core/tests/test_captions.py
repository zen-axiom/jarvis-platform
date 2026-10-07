from __future__ import annotations

import json

import pytest
from conftest import CAPTIONS_PATH

from jarvis_core.captions import (
    CAPTION_PLACEHOLDER,
    CaptionPair,
    contains_arabic_script,
    safe_caption,
    validate_caption,
)

CASES = json.loads(CAPTIONS_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_shared_fixture_cases(case: dict) -> None:
    pair = CaptionPair(case["lang"], case["speech_text"], case["caption_text"])
    check = validate_caption(pair)
    assert check.ok is case["valid"]
    if not case["valid"]:
        assert check.reason == case["reason"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_safe_caption_never_returns_arabic_script(case: dict) -> None:
    pair = CaptionPair(case["lang"], case["speech_text"], case["caption_text"])
    shown = safe_caption(pair)
    assert not contains_arabic_script(shown)
    if not case["valid"]:
        assert shown == CAPTION_PLACEHOLDER


def test_speech_text_may_be_urdu_script_but_is_a_separate_field() -> None:
    pair = CaptionPair("ur-roman", "آپ کے نوٹس", "Aap ke notes")
    assert validate_caption(pair).ok
    assert safe_caption(pair) == "Aap ke notes"
