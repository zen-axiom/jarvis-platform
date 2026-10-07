from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from jarvis_core.activity_log import ActivityLog

FAKE_SK = "sk-" + "or-" + "q1w2e3r4" * 4


def test_append_and_read_back() -> None:
    clock = lambda: datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)  # noqa: E731
    with ActivityLog(clock=clock) as log:
        log.append(
            trace_id="t1",
            kind="tool",
            status="ok",
            tool="mock.list_notes",
            tier="T0",
            approved_by="user",
            summary="Read notes",
            args={"a": 1},
        )
        (entry,) = log.entries()
    assert entry.ts_utc.startswith("2026-01-02T03:04:05")
    assert (entry.tool, entry.tier, entry.approved_by) == ("mock.list_notes", "T0", "user")


def test_update_and_delete_are_rejected() -> None:
    with ActivityLog() as log:
        log.append(trace_id="t", kind="k", status="ok")
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            log._db.execute("UPDATE activity SET status='x'")
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            log._db.execute("DELETE FROM activity")
        assert len(log.entries()) == 1


def test_summary_and_detail_are_redacted() -> None:
    with ActivityLog() as log:
        log.append(
            trace_id="t",
            kind="k",
            status="ok",
            summary=f"used {FAKE_SK}",
            detail="password: hunter2hunter2",
        )
        (e,) = log.entries()
    assert FAKE_SK not in e.summary and "hunter2" not in e.detail


def test_args_hash_is_computed_from_redacted_args() -> None:
    with ActivityLog() as log:
        log.append(trace_id="t", kind="k", status="ok", args={"api_key": "AAAA", "x": 1})
        log.append(trace_id="t", kind="k", status="ok", args={"api_key": "BBBB", "x": 1})
        a, b = log.entries()
    assert a.args_hash == b.args_hash and len(a.args_hash) == 64


def test_file_backed_log_creates_parent_and_persists(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "dir" / "activity.db"
    with ActivityLog(path) as log:
        log.append(trace_id="t", kind="k", status="ok")
    with ActivityLog(path) as log:
        assert len(log.entries()) == 1
