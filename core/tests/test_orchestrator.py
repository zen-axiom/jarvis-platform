from __future__ import annotations

from collections.abc import Callable

import pytest
from conftest import assert_conforms

from jarvis_core import events as ev
from jarvis_core.activity_log import ActivityLog
from jarvis_core.captions import CAPTION_PLACEHOLDER, contains_arabic_script
from jarvis_core.models.base import ModelDelta, ModelRequest
from jarvis_core.models.mock import MockProvider
from jarvis_core.orchestrator import CancelToken, Orchestrator
from jarvis_core.policy import ApprovalOutcome, ApprovalRequest, PolicyEngine
from jarvis_core.tools.mock_tools import MockStore, build_mock_registry


class ScriptedApprover:
    def __init__(self, *outcomes: object, on_decide: Callable[[], None] | None = None) -> None:
        self.outcomes = list(outcomes)
        self.requests: list[ApprovalRequest] = []
        self.on_decide = on_decide

    def decide(self, request: ApprovalRequest) -> ApprovalOutcome:
        self.requests.append(request)
        if self.on_decide:
            self.on_decide()
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # type: ignore[return-value]


class Harness:
    def __init__(self, approver: ScriptedApprover, provider=None, max_steps: int = 8) -> None:
        self.events: list[ev.Event] = []
        self.tools, self.store = build_mock_registry(MockStore())
        self.policy = PolicyEngine()
        self.log = ActivityLog()
        self.approver = approver
        self.orch = Orchestrator(
            provider=provider or MockProvider(),
            tools=self.tools,
            policy=self.policy,
            log=self.log,
            approver=approver,
            emit=self.events.append,
            max_steps=max_steps,
        )

    def run(self, text: str, cancel: CancelToken | None = None):
        return self.orch.run_turn(text, cancel)

    def types(self) -> list[str]:
        return [e.type for e in self.events]

    def activities(self) -> list[ev.ActivityEvent]:
        return [e for e in self.events if isinstance(e, ev.ActivityEvent)]

    def captions(self) -> list[ev.CaptionEvent]:
        return [e for e in self.events if isinstance(e, ev.CaptionEvent)]


APPROVE = ApprovalOutcome("approved")
DENY = ApprovalOutcome("denied")
TIMEOUT = ApprovalOutcome("timeout")


def test_t0_read_requires_approval_then_runs() -> None:
    h = Harness(ScriptedApprover(APPROVE))
    r = h.run("what is in my notes")
    assert r.status == "completed"
    assert len(h.approver.requests) == 1 and h.approver.requests[0].tier.name == "T0"
    assert [a.status for a in h.activities()] == ["ok"]
    assert h.captions()[0].caption_text.startswith("You have three notes")
    assert h.events[-1] == ev.StateEvent("idle")


@pytest.mark.parametrize(("outcome", "status"), [(DENY, "denied"), (TIMEOUT, "timeout")])
def test_t2_not_executed_unless_approved(outcome: ApprovalOutcome, status: str) -> None:
    h = Harness(ScriptedApprover(outcome))
    h.run("send a message to Ahmed")
    assert h.store.outbox == []
    assert [a.status for a in h.activities()] == [status]


def test_t2_approved_runs_only_in_memory() -> None:
    h = Harness(ScriptedApprover(APPROVE))
    h.run("send a message to Ahmed")
    assert h.store.outbox == [{"to": "Ahmed", "body": "Meeting confirmed"}]
    assert any(e.kind == "tool" and e.approved_by == "user" for e in h.log.entries())


def test_unavailable_approver_means_denied() -> None:
    h = Harness(ScriptedApprover(RuntimeError("ui closed")))
    h.run("send a message to Ahmed")
    assert h.store.outbox == [] and [a.status for a in h.activities()] == ["denied"]


def test_junk_approval_result_means_denied() -> None:
    h = Harness(ScriptedApprover(ApprovalOutcome("sure")))
    h.run("send a message to Ahmed")
    assert h.store.outbox == []


def test_t3_blocked_without_asking() -> None:
    h = Harness(ScriptedApprover())
    r = h.run("show my password")
    assert r.status == "completed" and h.approver.requests == []
    assert [a.status for a in h.activities()] == ["blocked"]


def test_allow_session_grant_skips_second_prompt_for_t1() -> None:
    h = Harness(ScriptedApprover(ApprovalOutcome("approved", allow_session=True)))
    h.run("save a note")
    h.run("save a note")
    assert len(h.approver.requests) == 1
    assert [a.approved_by for a in h.activities()][-1].startswith("grant:")
    assert any(e.kind == "grant_created" for e in h.log.entries())


def test_allow_session_refused_for_t2() -> None:
    h = Harness(ScriptedApprover(ApprovalOutcome("approved", allow_session=True), APPROVE))
    h.run("send a message to Ahmed")
    h.run("send a message to Ahmed")
    assert len(h.approver.requests) == 2
    assert any(e.kind == "grant_refused" for e in h.log.entries())


def test_untrusted_source_cannot_create_or_use_grants() -> None:
    h = Harness(ScriptedApprover(ApprovalOutcome("approved", allow_session=True), APPROVE))
    h.run("save the web page text")
    h.run("save the web page text")
    assert len(h.approver.requests) == 2
    assert all(r.source == "untrusted_content" for r in h.approver.requests)
    assert any(e.kind == "grant_refused" for e in h.log.entries())


def test_cancel_before_start() -> None:
    h = Harness(ScriptedApprover())
    cancel = CancelToken()
    cancel.cancel()
    r = h.run("what is in my notes", cancel)
    assert r.status == "cancelled" and h.approver.requests == []
    assert h.events[-1] == ev.StateEvent("idle")
    assert any(e.kind == "cancelled" for e in h.log.entries())


def test_cancel_during_approval_never_executes_tool() -> None:
    cancel = CancelToken()
    h = Harness(ScriptedApprover(APPROVE, on_decide=cancel.cancel))
    r = h.run("send a message to Ahmed", cancel)
    assert r.status == "cancelled"
    assert h.store.outbox == []
    resolved = [e for e in h.events if isinstance(e, ev.ApprovalResolvedEvent)]
    assert [e.decision for e in resolved] == ["denied"]


def test_step_limit_ends_turn_with_error() -> None:
    class Looping:
        name = "loop"

        def complete(self, request: ModelRequest):
            yield ModelDelta.call("mock.list_notes")
            yield ModelDelta.done()

    h = Harness(ScriptedApprover(*[APPROVE] * 10), provider=Looping(), max_steps=3)
    r = h.run("anything")
    assert r.status == "step_limit" and r.steps == 3
    assert h.events[-1] == ev.StateEvent("error")
    assert len(h.approver.requests) == 3


def test_provider_exception_fails_closed() -> None:
    class Broken:
        name = "broken"

        def complete(self, request: ModelRequest):
            raise RuntimeError("boom")
            yield  # pragma: no cover

    h = Harness(ScriptedApprover(), provider=Broken())
    r = h.run("hi")
    assert r.status == "error" and h.events[-1] == ev.StateEvent("error")
    assert any(isinstance(e, ev.ErrorEvent) for e in h.events)


def test_unknown_tool_is_reported_not_executed() -> None:
    class Rogue:
        name = "rogue"

        def complete(self, request: ModelRequest):
            if request.messages[-1].role == "tool":
                yield ModelDelta.done()
            else:
                yield ModelDelta.call("shell.run", {"cmd": "rm -rf /"})

    h = Harness(ScriptedApprover(), provider=Rogue())
    h.run("go")
    assert [a.status for a in h.activities()] == ["error"] and h.approver.requests == []


def test_urdu_script_caption_from_model_is_replaced_with_placeholder() -> None:
    h = Harness(ScriptedApprover())
    h.run("badcaption please")
    (cap,) = h.captions()
    assert cap.caption_text == CAPTION_PLACEHOLDER
    assert any(e.kind == "caption_rejected" for e in h.log.entries())


def test_roman_urdu_turn_has_separate_speech_and_roman_caption() -> None:
    h = Harness(ScriptedApprover(APPROVE))
    h.run("mere notes dikhao", None)
    (cap,) = h.captions()
    assert cap.lang == "ur-en"
    assert contains_arabic_script(cap.speech_text)
    assert not contains_arabic_script(cap.caption_text)


@pytest.mark.parametrize(
    ("text", "outcomes"),
    [
        ("what is in my notes", [APPROVE]),
        ("mere notes dikhao", [APPROVE]),
        ("send a message", [DENY]),
        ("delete my gym schedule", [APPROVE]),
        ("save a note", [APPROVE]),
        ("show my password", []),
        ("badcaption", []),
    ],
)
def test_all_emitted_events_conform_to_shared_schema(text: str, outcomes: list) -> None:
    h = Harness(ScriptedApprover(*outcomes))
    h.run(text)
    assert h.events
    for e in h.events:
        assert_conforms(e.to_dict())
    for c in h.captions():
        assert not contains_arabic_script(c.caption_text)


def test_log_never_contains_secret_shaped_values() -> None:
    secret = "sk-" + "ant-" + "z9x8c7v6" * 4
    h = Harness(ScriptedApprover())
    h.run(f"my key is {secret}")
    dump = " ".join(f"{e.summary} {e.detail}" for e in h.log.entries())
    assert secret not in dump
    transcript = next(e for e in h.events if isinstance(e, ev.TranscriptEvent))
    assert secret not in transcript.text
