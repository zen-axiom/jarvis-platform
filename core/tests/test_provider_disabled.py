from __future__ import annotations

import dataclasses
import re
from pathlib import Path

import pytest

import jarvis_core
from jarvis_core.models.mock import MockProvider
from jarvis_core.models.registry import (
    DISABLED_KINDS,
    ProviderConfig,
    ProviderDisabled,
    create_provider,
)


def test_default_is_mock() -> None:
    assert isinstance(create_provider(), MockProvider)
    assert isinstance(create_provider(ProviderConfig("mock")), MockProvider)


@pytest.mark.parametrize("kind", [*DISABLED_KINDS, "nope", ""])
def test_everything_else_is_disabled(kind: str) -> None:
    with pytest.raises(ProviderDisabled):
        create_provider(ProviderConfig(kind))


def test_provider_config_has_no_url_or_secret_fields() -> None:
    assert [f.name for f in dataclasses.fields(ProviderConfig)] == ["kind"]


def test_package_source_imports_no_network_libraries() -> None:
    root = Path(jarvis_core.__file__).parent
    banned = re.compile(
        r"^\s*(?:import|from)\s+(socket|http|urllib|requests|httpx|aiohttp|ssl|ftplib|smtplib"
        r"|subprocess|webbrowser|keyring)\b",
        re.MULTILINE,
    )
    offenders = [str(p) for p in root.rglob("*.py") if banned.search(p.read_text("utf-8"))]
    assert offenders == []
