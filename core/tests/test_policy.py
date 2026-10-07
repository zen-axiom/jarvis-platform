from __future__ import annotations

import pytest

from jarvis_core.policy import (
    ApprovalOutcome,
    GrantNotAllowed,
    PolicyEngine,
    Tier,
    effective_decision,
)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def eval_(p: PolicyEngine, tier: Tier, tool: str = "t", scope: str = "s", **kw):
    return p.evaluate(tool=tool, tier=tier, scope=scope, **kw)


def test_tiers_default_actions() -> None:
    p = PolicyEngine()
    assert eval_(p, Tier.T0).action == "ask"
    assert eval_(p, Tier.T1).action == "ask"
    assert eval_(p, Tier.T2).action == "ask"
    assert eval_(p, Tier.T3).action == "block"


@pytest.mark.parametrize("tier", [Tier.T2, Tier.T3])
def test_grants_refused_for_t2_and_t3(tier: Tier) -> None:
    with pytest.raises(GrantNotAllowed):
        PolicyEngine().create_grant(tool="t", tier=tier, scope="s", ttl_s=60, max_uses=1)


@pytest.mark.parametrize(
    ("scope", "ttl", "uses"),
    [
        ("", 60, 1),
        ("*", 60, 1),
        ("notes:*", 60, 1),
        ("s", 0, 1),
        ("s", 99999, 1),
        ("s", 60, 0),
        ("s", 60, 999),
    ],
)
def test_grant_limits_enforced(scope: str, ttl: float, uses: int) -> None:
    with pytest.raises(GrantNotAllowed):
        PolicyEngine().create_grant(tool="t", tier=Tier.T1, scope=scope, ttl_s=ttl, max_uses=uses)


def test_grant_allows_matching_tool_and_scope_only() -> None:
    p = PolicyEngine()
    g = p.create_grant(tool="t", tier=Tier.T1, scope="notes", ttl_s=60, max_uses=5)
    d = eval_(p, Tier.T1, tool="t", scope="notes")
    assert d.action == "allow" and d.grant_id == g.id
    assert eval_(p, Tier.T1, tool="t", scope="other").action == "ask"
    assert eval_(p, Tier.T1, tool="other", scope="notes").action == "ask"


def test_grant_is_use_limited_and_expires() -> None:
    clock = Clock()
    p = PolicyEngine(clock)
    p.create_grant(tool="t", tier=Tier.T0, scope="s", ttl_s=60, max_uses=2)
    assert eval_(p, Tier.T0).action == "allow"
    assert eval_(p, Tier.T0).action == "allow"
    assert eval_(p, Tier.T0).action == "ask"  # uses exhausted
    p.create_grant(tool="t", tier=Tier.T0, scope="s", ttl_s=60, max_uses=5)
    clock.t += 61
    assert eval_(p, Tier.T0).action == "ask"  # expired
    assert p.active_grants() == []


def test_untrusted_source_never_uses_grants() -> None:
    p = PolicyEngine()
    p.create_grant(tool="t", tier=Tier.T1, scope="s", ttl_s=60, max_uses=5)
    d = eval_(p, Tier.T1, untrusted_source=True)
    assert d.action == "ask" and "untrusted" in d.reason
    assert len(p.active_grants()) == 1 and p.active_grants()[0].remaining == 5


def test_revoke_and_revoke_all() -> None:
    p = PolicyEngine()
    g1 = p.create_grant(tool="a", tier=Tier.T0, scope="s", ttl_s=60, max_uses=1)
    p.create_grant(tool="b", tier=Tier.T0, scope="s", ttl_s=60, max_uses=1)
    assert p.revoke(g1.id) and not p.revoke(g1.id)
    assert p.revoke_all() == 1
    assert eval_(p, Tier.T0, tool="b").action == "ask"


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (ApprovalOutcome("approved"), "approved"),
        (ApprovalOutcome("denied"), "denied"),
        (ApprovalOutcome("timeout"), "timeout"),
        (ApprovalOutcome("yes please"), "denied"),
        (ApprovalOutcome("APPROVED"), "denied"),
        (None, "denied"),
        ("approved", "denied"),
    ],
)
def test_only_explicit_approved_counts(outcome: object, expected: str) -> None:
    assert effective_decision(outcome) == expected
