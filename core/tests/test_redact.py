from __future__ import annotations

from jarvis_core.redact import redact, redact_obj

# Fake secrets are assembled at runtime so no secret-shaped literal sits in the source.
FAKE_SK = "sk-" + "ant-" + "a1b2c3d4" * 4
FAKE_GH = "ghp_" + "Z9y8X7w6" * 4
FAKE_JWT = ".".join(["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjMifQ", "abc123DEF456ghi"])


def test_api_key_masked() -> None:
    assert FAKE_SK not in redact(f"key is {FAKE_SK} ok")
    assert "<redacted:api_key>" in redact(f"key is {FAKE_SK} ok")


def test_github_token_and_jwt_masked() -> None:
    assert "<redacted:github_token>" in redact(FAKE_GH)
    assert "<redacted:jwt>" in redact(f"jwt={FAKE_JWT}") or "<redacted" in redact(FAKE_JWT)


def test_bearer_and_labelled_and_query_secrets() -> None:
    assert "<redacted:bearer>" in redact("Authorization: Bearer abcdefghijklmnop1234")
    assert redact("password: hunter2hunter2") == "password: <redacted:labelled_secret>"
    assert redact("https://x.test/a?token=abc123def456&q=1") == (
        "https://x.test/a?token=<redacted:query_secret>&q=1"
    )


def test_long_hex_masked_but_normal_text_untouched() -> None:
    assert "<redacted:hex_blob>" in redact("a" * 40)
    text = "Send a message to Ahmed about the 9:30 meeting"
    assert redact(text) == text


def test_redact_obj_masks_sensitive_keys_and_nested_strings() -> None:
    out = redact_obj({"api_key": "whatever", "nested": [{"note": f"x {FAKE_SK}"}], "n": 3})
    assert out["api_key"] == "<redacted:key>"
    assert FAKE_SK not in str(out)
    assert out["n"] == 3
