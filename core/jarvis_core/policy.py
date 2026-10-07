"""Risk tiers, approval semantics and scoped session grants.

T0 read-only, T1 reversible local write, T2 sensitive (send/delete/shell/...), T3 blocked.
Rules enforced here:
  * T3 is always blocked; T2 always asks and can never be granted.
  * T0/T1 ask by default; a scoped, expiring, use-limited session grant may pre-approve them.
  * Content from an untrusted source (web page, file text) never uses a grant.
  * Anything other than an explicit "approved" (denied, timeout, error, junk) means not approved.
"""

from __future__ import annotations

import itertools
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import IntEnum
from typing import Literal, Protocol


class Tier(IntEnum):
    T0 = 0
    T1 = 1
    T2 = 2
    T3 = 3


class GrantNotAllowed(Exception):
    """Raised when a session grant is not permitted for the requested tier/scope/limits."""


ActionName = Literal["allow", "ask", "block"]


@dataclass(frozen=True)
class PolicyDecision:
    action: ActionName
    tier: Tier
    reason: str
    grant_id: str | None = None


@dataclass
class Grant:
    id: str
    tool: str
    scope: str
    tier: Tier
    expires_at: float
    remaining: int


class PolicyEngine:
    MAX_TTL_S = 1800.0
    MAX_USES = 25

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._grants: dict[str, Grant] = {}
        self._ids = itertools.count(1)

    # -- evaluation ---------------------------------------------------------------------
    def evaluate(
        self, *, tool: str, tier: Tier, scope: str, untrusted_source: bool = False
    ) -> PolicyDecision:
        if tier >= Tier.T3:
            return PolicyDecision("block", tier, "tier T3 is always blocked")
        if tier == Tier.T2:
            return PolicyDecision("ask", tier, "tier T2 always requires approval")
        if untrusted_source:
            return PolicyDecision("ask", tier, "untrusted content cannot use session grants")
        grant = self._match(tool, scope)
        if grant is not None:
            grant.remaining -= 1
            if grant.remaining <= 0:
                del self._grants[grant.id]
            return PolicyDecision("allow", tier, f"session grant {grant.id}", grant.id)
        return PolicyDecision("ask", tier, "approval required (no active grant)")

    def _match(self, tool: str, scope: str) -> Grant | None:
        self._purge()
        for grant in self._grants.values():
            if grant.tool == tool and grant.scope == scope:
                return grant
        return None

    def _purge(self) -> None:
        now = self._clock()
        for gid in [g.id for g in self._grants.values() if g.expires_at <= now]:
            del self._grants[gid]

    # -- grants -------------------------------------------------------------------------
    def create_grant(
        self, *, tool: str, tier: Tier, scope: str, ttl_s: float, max_uses: int
    ) -> Grant:
        if tier >= Tier.T2:
            raise GrantNotAllowed("grants are only allowed for tiers T0 and T1")
        if not scope or "*" in scope:
            raise GrantNotAllowed("grants need an explicit scope; wildcards are not allowed")
        if not 0 < ttl_s <= self.MAX_TTL_S:
            raise GrantNotAllowed(f"ttl must be in (0, {self.MAX_TTL_S}] seconds")
        if not 1 <= max_uses <= self.MAX_USES:
            raise GrantNotAllowed(f"max_uses must be in [1, {self.MAX_USES}]")
        grant = Grant(
            id=f"g{next(self._ids)}",
            tool=tool,
            scope=scope,
            tier=tier,
            expires_at=self._clock() + ttl_s,
            remaining=max_uses,
        )
        self._grants[grant.id] = grant
        return grant

    def revoke(self, grant_id: str) -> bool:
        return self._grants.pop(grant_id, None) is not None

    def revoke_all(self) -> int:
        n = len(self._grants)
        self._grants.clear()
        return n

    def active_grants(self) -> list[Grant]:
        self._purge()
        return list(self._grants.values())


# -- approval semantics -------------------------------------------------------------------
Decision = Literal["approved", "denied", "timeout"]


@dataclass(frozen=True)
class ApprovalOutcome:
    decision: str
    allow_session: bool = False


@dataclass(frozen=True)
class ApprovalRequest:
    id: str
    tool: str
    tier: Tier
    summary: str
    args: dict
    source: str
    timeout_s: float


class Approver(Protocol):
    def decide(self, request: ApprovalRequest) -> ApprovalOutcome:
        """Return the human's decision. Must return decision="timeout" when nobody answers."""
        ...


def effective_decision(outcome: object) -> Decision:
    """Fail closed: only an explicit "approved" counts; "timeout" is kept distinct from "denied"."""
    decision = getattr(outcome, "decision", None)
    if decision == "approved":
        return "approved"
    if decision == "timeout":
        return "timeout"
    return "denied"
