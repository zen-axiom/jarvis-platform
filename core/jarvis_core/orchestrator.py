"""Mock turn loop: model -> policy -> approval -> tool -> log, with cancellation and a step cap.

Fail-closed rules: a tool runs only after an explicit "approved" (or an eligible grant);
cancellation is checked before every step and again right before a tool executes; a failure
anywhere ends the turn with an error and no further tool calls.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from . import events as ev
from .activity_log import ActivityLog
from .captions import CaptionPair, safe_caption, validate_caption
from .models.base import Message, ModelDelta, ModelProvider, ModelRequest
from .policy import (
    ApprovalOutcome,
    ApprovalRequest,
    Approver,
    GrantNotAllowed,
    PolicyEngine,
    Tier,
    effective_decision,
)
from .redact import redact, redact_obj
from .tools.base import ToolRegistry

TurnStatus = Literal["completed", "cancelled", "error", "step_limit"]


class CancelToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


class Cancelled(Exception):
    pass


@dataclass(frozen=True)
class TurnResult:
    status: TurnStatus
    steps: int
    trace_id: str


class Orchestrator:
    GRANT_TTL_S = 600.0
    GRANT_USES = 10

    def __init__(
        self,
        *,
        provider: ModelProvider,
        tools: ToolRegistry,
        policy: PolicyEngine,
        log: ActivityLog,
        approver: Approver,
        emit: Callable[[ev.Event], None],
        max_steps: int = 8,
        approval_timeout_s: float = 60.0,
    ) -> None:
        self.provider = provider
        self.tools = tools
        self.policy = policy
        self.log = log
        self.approver = approver
        self._emit_cb = emit
        self.max_steps = max_steps
        self.approval_timeout_s = approval_timeout_s

    # -- public ---------------------------------------------------------------------------
    def run_turn(
        self, user_text: str, cancel: CancelToken | None = None, *, lang: str = "en"
    ) -> TurnResult:
        cancel = cancel or CancelToken()
        trace = uuid.uuid4().hex[:12]
        self._n = 0
        steps = 0
        try:
            self._emit(ev.TranscriptEvent(lang=lang, text=redact(user_text)))
            self._emit(ev.StateEvent("thinking"))
            self.log.append(trace_id=trace, kind="request", status="ok", summary=user_text)
            messages: list[Message] = [Message("user", user_text)]
            while True:
                self._check(cancel)
                if steps >= self.max_steps:
                    return self._fail(trace, steps, "step_limit", "Step limit reached.")
                steps += 1
                deltas = self._collect(
                    self.provider.complete(
                        ModelRequest(tuple(messages), tool_names=self.tools.names())
                    ),
                    cancel,
                )
                calls = [d for d in deltas if d.kind == "tool_call"]
                for d in deltas:
                    if d.kind == "reply":
                        self._speak(trace, d)
                        messages.append(Message("assistant", d.caption_text))
                if not calls:
                    break
                self._emit(ev.StateEvent("thinking"))
                for call in calls:
                    result = self._run_tool(trace, call, cancel)
                    messages.append(Message("tool", result, name=call.tool_name))
            self._emit(ev.StateEvent("idle"))
            return TurnResult("completed", steps, trace)
        except Cancelled:
            self._n += 1
            self._emit(ev.ActivityEvent(self._aid(trace), "Cancelled by user", "cancelled"))
            self.log.append(trace_id=trace, kind="cancelled", status="cancelled")
            self._emit(ev.StateEvent("idle"))
            return TurnResult("cancelled", steps, trace)
        except Exception as exc:  # noqa: BLE001 - fail closed, report, never continue
            return self._fail(trace, steps, "error", f"{type(exc).__name__}: {exc}")

    # -- internals ------------------------------------------------------------------------
    def _emit(self, event: ev.Event) -> None:
        self._emit_cb(event)

    def _aid(self, trace: str) -> str:
        return f"{trace}:{self._n}"

    @staticmethod
    def _check(cancel: CancelToken) -> None:
        if cancel.cancelled:
            raise Cancelled

    def _collect(self, deltas, cancel: CancelToken) -> list[ModelDelta]:  # noqa: ANN001
        out: list[ModelDelta] = []
        for d in deltas:
            self._check(cancel)
            out.append(d)
        return out

    def _fail(self, trace: str, steps: int, status: TurnStatus, message: str) -> TurnResult:
        message = redact(message)
        self.log.append(trace_id=trace, kind="turn", status=status, detail=message)
        self._emit(ev.ErrorEvent(message))
        self._emit(ev.StateEvent("error"))
        return TurnResult(status, steps, trace)

    def _speak(self, trace: str, d: ModelDelta) -> None:
        pair = CaptionPair(d.lang, d.speech_text, d.caption_text)
        check = validate_caption(pair)
        if not check.ok:
            self.log.append(
                trace_id=trace, kind="caption_rejected", status="error", detail=str(check.reason)
            )
        self._emit(ev.StateEvent("speaking"))
        self._emit(ev.CaptionEvent(d.lang, d.speech_text, safe_caption(pair)))

    def _run_tool(self, trace: str, call: ModelDelta, cancel: CancelToken) -> str:
        self._n += 1
        aid = self._aid(trace)
        tool = self.tools.get(call.tool_name)
        if tool is None:
            self._emit(ev.ActivityEvent(aid, f"Unknown tool {call.tool_name}", "error"))
            self.log.append(
                trace_id=trace,
                kind="tool",
                status="error",
                tool=call.tool_name,
                detail="unknown tool",
            )
            return "error: unknown tool"

        args = dict(call.tool_args)
        shown = redact_obj(args)
        tier = tool.tier
        label = redact(tool.describe(args))
        untrusted = call.source == "untrusted_content"
        decision = self.policy.evaluate(
            tool=tool.name, tier=tier, scope=tool.scope_of(args), untrusted_source=untrusted
        )

        if decision.action == "block":
            self._emit(ev.ActivityEvent(aid, label, "blocked", tier.name))
            self.log.append(
                trace_id=trace,
                kind="tool",
                status="blocked",
                tool=tool.name,
                tier=tier.name,
                summary=label,
                args=args,
                detail=decision.reason,
            )
            return "blocked by policy"

        if decision.action == "allow":
            return self._execute(trace, aid, tool, args, label, f"grant:{decision.grant_id}")

        # ask
        request = ApprovalRequest(
            id=aid,
            tool=tool.name,
            tier=tier,
            summary=label,
            args=shown,
            source=call.source,
            timeout_s=self.approval_timeout_s,
        )
        self._emit(
            ev.ApprovalRequestEvent(
                aid, tool.name, tier.name, label, shown, call.source, self.approval_timeout_s
            )
        )
        self._emit(ev.StateEvent("approval_needed"))
        self.log.append(
            trace_id=trace,
            kind="approval_requested",
            status="pending",
            tool=tool.name,
            tier=tier.name,
            summary=label,
            args=args,
            detail="untrusted source" if untrusted else "",
        )
        try:
            outcome: object = self.approver.decide(request)
        except Exception:  # noqa: BLE001 - an unavailable approver means "not approved"
            outcome = None
        cancelled_while_waiting = cancel.cancelled
        verdict = "denied" if cancelled_while_waiting else effective_decision(outcome)
        self._emit(ev.ApprovalResolvedEvent(aid, verdict))
        self._emit(ev.StateEvent("thinking"))
        if cancelled_while_waiting:  # never execute after the fact
            raise Cancelled

        if verdict != "approved":
            status = "timeout" if verdict == "timeout" else "denied"
            self._emit(ev.ActivityEvent(aid, label, status, tier.name))
            self.log.append(
                trace_id=trace,
                kind="approval",
                status=status,
                tool=tool.name,
                tier=tier.name,
                summary=label,
            )
            return "timed out waiting for approval" if verdict == "timeout" else "denied by user"

        if isinstance(outcome, ApprovalOutcome) and outcome.allow_session:
            self._maybe_grant(trace, tool.name, tier, tool.scope_of(args), untrusted)
        return self._execute(trace, aid, tool, args, label, "user")

    def _maybe_grant(self, trace: str, tool: str, tier: Tier, scope: str, untrusted: bool) -> None:
        try:
            if untrusted:
                raise GrantNotAllowed("untrusted content cannot create session grants")
            grant = self.policy.create_grant(
                tool=tool, tier=tier, scope=scope, ttl_s=self.GRANT_TTL_S, max_uses=self.GRANT_USES
            )
        except GrantNotAllowed as exc:
            self.log.append(
                trace_id=trace,
                kind="grant_refused",
                status="denied",
                tool=tool,
                tier=tier.name,
                detail=str(exc),
            )
            return
        self.log.append(
            trace_id=trace,
            kind="grant_created",
            status="ok",
            tool=tool,
            tier=tier.name,
            approved_by="user",
            detail=f"{grant.id} scope={scope} ttl_s={self.GRANT_TTL_S}",
        )

    def _execute(self, trace: str, aid: str, tool, args, label: str, approved_by: str) -> str:  # noqa: ANN001
        try:
            result = tool.run(args)
        except Exception as exc:  # noqa: BLE001
            self._emit(ev.ActivityEvent(aid, label, "error", tool.tier.name, approved_by))
            self.log.append(
                trace_id=trace,
                kind="tool",
                status="error",
                tool=tool.name,
                tier=tool.tier.name,
                approved_by=approved_by,
                summary=label,
                args=args,
                detail=f"{type(exc).__name__}: {exc}",
            )
            return f"error: {type(exc).__name__}"
        status = "ok" if result.ok else "error"
        self._emit(ev.ActivityEvent(aid, label, status, tool.tier.name, approved_by))
        self.log.append(
            trace_id=trace,
            kind="tool",
            status=status,
            tool=tool.name,
            tier=tool.tier.name,
            approved_by=approved_by,
            summary=label,
            args=args,
            detail=result.output,
        )
        return result.output
