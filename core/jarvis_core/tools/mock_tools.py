"""Mock tools. They touch only an in-memory store: no filesystem, network, shell or browser."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..policy import Tier
from .base import Tool, ToolRegistry, ToolResult


@dataclass
class MockStore:
    notes: dict[str, str] = field(
        default_factory=lambda: {
            "groceries": "milk, eggs",
            "tomorrow's agenda": "standup 9:30",
            "gym schedule": "Mon/Wed/Fri",
        }
    )
    outbox: list[dict[str, str]] = field(default_factory=list)  # "sent" messages never leave memory


def build_mock_registry(store: MockStore | None = None) -> tuple[ToolRegistry, MockStore]:
    store = store or MockStore()
    reg = ToolRegistry()

    def list_notes(_: dict[str, Any]) -> ToolResult:
        return ToolResult(True, "; ".join(store.notes))

    def write_note(args: dict[str, Any]) -> ToolResult:
        store.notes[str(args.get("title", "untitled"))] = str(args.get("text", ""))
        return ToolResult(True, f"saved note {args.get('title', 'untitled')!r} (in memory)")

    def send_message(args: dict[str, Any]) -> ToolResult:
        store.outbox.append({"to": str(args.get("to", "")), "body": str(args.get("body", ""))})
        return ToolResult(True, f"MOCK: message to {args.get('to', '?')} was NOT sent (no network)")

    def delete_item(args: dict[str, Any]) -> ToolResult:
        name = str(args.get("name", ""))
        existed = store.notes.pop(name, None) is not None
        return ToolResult(existed, f"removed {name!r} (in memory)" if existed else "not found")

    def read_credentials(_: dict[str, Any]) -> ToolResult:  # pragma: no cover - T3 never runs
        return ToolResult(False, "error: this tool must never execute")

    reg.register(
        Tool(
            "mock.list_notes",
            "List mock notes",
            Tier.T0,
            lambda a: "notes",
            lambda a: "Read the mock notes (in memory)",
            list_notes,
        )
    )
    reg.register(
        Tool(
            "mock.write_note",
            "Write a mock note",
            Tier.T1,
            lambda a: "notes",
            lambda a: f"Save note {a.get('title', 'untitled')!r} (in memory)",
            write_note,
        )
    )
    reg.register(
        Tool(
            "mock.send_message",
            "Pretend to send a message",
            Tier.T2,
            lambda a: "outbox",
            lambda a: f"Send a message to {a.get('to', '?')} (mock: never leaves this machine)",
            send_message,
        )
    )
    reg.register(
        Tool(
            "mock.delete_item",
            "Delete a mock note",
            Tier.T2,
            lambda a: f"notes:{a.get('name', '')}",
            lambda a: f"Delete {a.get('name', '?')!r} (in memory)",
            delete_item,
        )
    )
    reg.register(
        Tool(
            "mock.read_credentials",
            "Pretend to read credentials",
            Tier.T3,
            lambda a: "credentials",
            lambda a: "Read stored credentials",
            read_credentials,
        )
    )
    return reg, store
