"""Shared fixtures. Every test runs with the network disabled."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "shared" / "events.schema.json"
CAPTIONS_PATH = ROOT / "shared" / "fixtures" / "captions.json"


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("network access is forbidden in Phase 1A tests")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def _schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


_TYPE_CHECKS = {
    "string": lambda v: isinstance(v, str),
    "object": lambda v: isinstance(v, dict),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}


def assert_conforms(event: dict[str, Any]) -> None:
    """Minimal structural check of an event dict against shared/events.schema.json."""
    defs = _schema()["$defs"]
    by_type = {d["properties"]["type"]["const"]: d for d in defs.values()}
    assert event.get("type") in by_type, f"unknown event type: {event.get('type')!r}"
    d = by_type[event["type"]]
    props = d["properties"]
    assert set(d["required"]) <= set(event), f"missing keys in {event}"
    assert set(event) <= set(props), f"unexpected keys in {event}"
    for key, value in event.items():
        spec = props[key]
        if "const" in spec:
            assert value == spec["const"]
        if "enum" in spec:
            assert value in spec["enum"], f"{key}={value!r} not in {spec['enum']}"
        if "type" in spec:
            assert _TYPE_CHECKS[spec["type"]](value), f"{key} has wrong type in {event}"
