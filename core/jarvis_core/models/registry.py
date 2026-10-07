"""Provider registry. Phase 1A enables the mock provider only.

ProviderConfig deliberately has no URL, key or secret fields. Adding any of them is a
future-phase decision that needs explicit approval and a compatibility check first.
"""

from __future__ import annotations

from dataclasses import dataclass

from .base import ModelProvider
from .mock import MockProvider

# Known formats a future phase may enable. They are stubs that refuse to construct.
DISABLED_KINDS = ("anthropic-messages", "openai-compatible")


class ProviderDisabled(Exception):
    """Raised for any provider kind other than the mock."""


@dataclass(frozen=True)
class ProviderConfig:
    kind: str = "mock"


def create_provider(config: ProviderConfig | None = None) -> ModelProvider:
    config = config or ProviderConfig()
    if config.kind == "mock":
        return MockProvider()
    if config.kind in DISABLED_KINDS:
        raise ProviderDisabled(f"provider {config.kind!r} is not enabled in Phase 1A (mock only)")
    raise ProviderDisabled(f"unknown provider kind {config.kind!r}")
