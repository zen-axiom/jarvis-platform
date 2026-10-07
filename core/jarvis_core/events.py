"""HUD/orchestrator events. Mirrors shared/events.schema.json."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

HUD_STATES = ("idle", "listening", "thinking", "speaking", "error", "approval_needed")


@dataclass(frozen=True)
class Event:
    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass(frozen=True)
class StateEvent(Event):
    state: str
    type: str = field(default="state", init=False)

    def __post_init__(self) -> None:
        if self.state not in HUD_STATES:
            raise ValueError(f"unknown HUD state: {self.state!r}")


@dataclass(frozen=True)
class TranscriptEvent(Event):
    lang: str
    text: str
    type: str = field(default="transcript", init=False)


@dataclass(frozen=True)
class CaptionEvent(Event):
    """speech_text is for a future TTS engine only; the HUD displays caption_text."""

    lang: str
    speech_text: str
    caption_text: str
    type: str = field(default="caption", init=False)


@dataclass(frozen=True)
class ActivityEvent(Event):
    id: str
    label: str
    status: str
    tier: str | None = None
    approved_by: str | None = None
    type: str = field(default="activity", init=False)


@dataclass(frozen=True)
class ApprovalRequestEvent(Event):
    id: str
    tool: str
    tier: str
    summary: str
    args: dict[str, Any]
    source: str
    timeout_s: float
    type: str = field(default="approval_request", init=False)


@dataclass(frozen=True)
class ApprovalResolvedEvent(Event):
    id: str
    decision: str
    type: str = field(default="approval_resolved", init=False)


@dataclass(frozen=True)
class ErrorEvent(Event):
    message: str
    type: str = field(default="error", init=False)
