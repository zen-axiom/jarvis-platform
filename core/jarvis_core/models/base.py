"""Provider-neutral model interface. Phase 1A ships only the mock implementation.

Models produce replies and tool-call requests; they never execute tools.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


@dataclass(frozen=True)
class Message:
    role: Literal["user", "assistant", "tool"]
    content: str
    name: str | None = None


@dataclass(frozen=True)
class ModelRequest:
    messages: tuple[Message, ...]
    tool_names: tuple[str, ...] = ()
    role: str = "chat"


@dataclass(frozen=True)
class ModelDelta:
    kind: Literal["reply", "tool_call", "done"]
    lang: str = "en"
    speech_text: str = ""
    caption_text: str = ""
    tool_name: str = ""
    tool_args: dict[str, Any] = field(default_factory=dict)
    source: str = "user_request"  # or "untrusted_content"

    @classmethod
    def reply(cls, lang: str, speech_text: str, caption_text: str) -> ModelDelta:
        return cls("reply", lang=lang, speech_text=speech_text, caption_text=caption_text)

    @classmethod
    def call(
        cls, name: str, args: dict[str, Any] | None = None, source: str = "user_request"
    ) -> ModelDelta:
        return cls("tool_call", tool_name=name, tool_args=args or {}, source=source)

    @classmethod
    def done(cls) -> ModelDelta:
        return cls("done")


class ModelProvider(Protocol):
    name: str

    def complete(self, request: ModelRequest) -> Iterator[ModelDelta]: ...
