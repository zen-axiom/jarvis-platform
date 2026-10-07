"""Append-only activity log (SQLite, stdlib). Everything is redacted before it is written."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .redact import redact, redact_obj

_SCHEMA = """
CREATE TABLE IF NOT EXISTS activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc      TEXT NOT NULL,
    trace_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    tool        TEXT NOT NULL DEFAULT '',
    tier        TEXT NOT NULL DEFAULT '',
    approved_by TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    args_hash   TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity
BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity
BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END;
"""


@dataclass(frozen=True)
class LogEntry:
    id: int
    ts_utc: str
    trace_id: str
    kind: str
    status: str
    tool: str
    tier: str
    approved_by: str
    summary: str
    args_hash: str
    detail: str


def _now() -> datetime:
    return datetime.now(UTC)


class ActivityLog:
    def __init__(
        self, path: str | Path = ":memory:", *, clock: Callable[[], datetime] = _now
    ) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._clock = clock
        self._db = sqlite3.connect(str(path))
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)

    def append(
        self,
        *,
        trace_id: str,
        kind: str,
        status: str,
        tool: str = "",
        tier: str = "",
        approved_by: str = "",
        summary: str = "",
        args: dict[str, Any] | None = None,
        detail: str = "",
    ) -> int:
        # Hash the *redacted* args so two different secrets never produce distinguishable hashes.
        canonical = json.dumps(redact_obj(args or {}), sort_keys=True, ensure_ascii=True)
        args_hash = hashlib.sha256(canonical.encode()).hexdigest()
        cur = self._db.execute(
            "INSERT INTO activity (ts_utc, trace_id, kind, status, tool, tier, approved_by,"
            " summary, args_hash, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                self._clock().isoformat(timespec="milliseconds"),
                trace_id,
                kind,
                status,
                tool,
                tier,
                approved_by,
                redact(summary),
                args_hash,
                redact(detail),
            ),
        )
        self._db.commit()
        return int(cur.lastrowid or 0)

    def entries(self, limit: int = 100) -> list[LogEntry]:
        rows = self._db.execute("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,))
        return [LogEntry(**dict(r)) for r in rows][::-1]

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> ActivityLog:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
