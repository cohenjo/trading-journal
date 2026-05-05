"""Worker tests for synthetic Flex options sync."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from typing import Any

from app.services.options.flex_parser import OptionLegKey
from app.worker.handlers.options_sync import _load_accounts, _source_conid_for_insert, run_flex_options_sync


class FakeScalar:
    """Scalar wrapper for returning generated IDs."""

    def __init__(self, value: str) -> None:
        self.value = value

    def scalar_one(self) -> str:
        """Return the fake scalar value."""

        return self.value

    def scalar_one_or_none(self) -> str | None:
        """Return the fake scalar value when present."""

        return self.value or None

    def mappings(self) -> list[dict[str, Any]]:
        """Return no mappings for scalar statements."""

        return []


class FakeMappings:
    """Mappings wrapper for fake SELECT statements."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class FakeSession:
    """Small SQL recorder that mimics the worker's SQLModel session usage."""

    def __init__(self) -> None:
        self.legs: dict[tuple[Any, ...], str] = {}
        self.trades: list[Mapping[str, Any]] = []
        self.cash_events: list[Mapping[str, Any]] = []
        self.positions: list[Mapping[str, Any]] = []
        self.sync_states = 0

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeScalar | FakeMappings:
        sql = str(statement)
        params = params or {}
        if "from public.trading_account_config" in sql:
            assert "name" not in sql
            return FakeMappings(
                [
                    {
                        "id": 1,
                        "household_id": "10000000-0000-0000-0000-000000000001",
                        "account_id": "U1234567",
                    }
                ]
            )
        if "insert into public.options_legs" in sql:
            key = (
                params["account_id"],
                params["underlying_symbol"],
                params["expiry"],
                params["strike"],
                params["right"],
            )
            self.legs.setdefault(key, f"leg-{len(self.legs) + 1}")
            return FakeScalar(self.legs[key])
        if "insert into public.options_trades" in sql:
            self.trades.append(params)
        elif "insert into public.options_cash_events" in sql:
            self.cash_events.append(params)
        elif "insert into public.options_positions" in sql:
            self.positions.append(params)
        elif "insert into public.options_flex_sync_state" in sql:
            self.sync_states += 1
        return FakeMappings([])


class ConidConflictSession:
    """Fake session for duplicate source_conid checks."""

    def __init__(self, conflicting: bool) -> None:
        self.conflicting = conflicting

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeScalar:
        """Return a conflicting leg id only for the conid preflight query."""

        assert "from public.options_legs" in str(statement)
        assert params and params["source_conid"] == 701529335
        return FakeScalar("existing-leg" if self.conflicting else "")


def test_duplicate_conid_is_dropped_for_different_natural_leg() -> None:
    """Live Flex can reuse conids across adjusted option symbols."""

    leg = OptionLegKey(
        account_id="U1234567",
        underlying_symbol="IBKR",
        option_symbol="IBKR  260116P00180000",
        expiry=date(2026, 1, 16),
        strike=Decimal("180"),
        right="put",
        source_conid=701529335,
    )

    household_id = "10000000-0000-0000-0000-000000000001"

    assert _source_conid_for_insert(ConidConflictSession(conflicting=False), household_id, leg) == 701529335  # type: ignore[arg-type]
    assert _source_conid_for_insert(ConidConflictSession(conflicting=True), household_id, leg) is None  # type: ignore[arg-type]


def test_load_accounts_matches_trading_account_config_schema() -> None:
    """Account loading must not select fields absent from trading_account_config."""

    accounts = _load_accounts(FakeSession(), account_id="U1234567")  # type: ignore[arg-type]

    assert len(accounts) == 1
    assert accounts[0].account_id == "U1234567"
    assert accounts[0].config_id == 1


def test_run_flex_options_sync_ingests_synthetic_source(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The worker parses synthetic XML and writes idempotent upsert statements."""

    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")
    session = FakeSession()
    result = run_flex_options_sync(session)  # type: ignore[arg-type]
    assert result["trade_count"] == 18
    assert result["cash_event_count"] == 2
    assert result["position_count"] == 1
    assert len(session.trades) == 18
    losing_roll = next(row for row in session.trades if row["source_trade_id"] == "T-JONY-003")
    assert losing_roll["realized_pnl"] == "-1000.000000" or str(losing_roll["realized_pnl"]) == "-1000.000000"
    assert len(session.legs) >= 1
    assert session.sync_states == 1


def test_select_flex_source_defaults_to_live_when_token_present(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Unset OPTIONS_FLEX_SOURCE + token present -> live (no synthetic fallback)."""

    from app.worker.handlers import options_sync as mod

    monkeypatch.delenv("OPTIONS_FLEX_SOURCE", raising=False)
    monkeypatch.setenv("IBKR_FLEX_TOKEN", "fake-token")
    called: dict[str, Any] = {}

    def fake_fetch(configs, token, args):  # type: ignore[no-untyped-def]
        called["token"] = token
        called["from"] = args.from_date
        called["to"] = args.to_date
        return []

    monkeypatch.setattr(mod, "_synthetic_files", lambda: ["SHOULD_NOT_BE_CALLED"])
    import sys as _sys
    import types as _types

    fake_module = _types.ModuleType("scripts.flex_probe")
    fake_module.fetch_live_xml = fake_fetch  # type: ignore[attr-defined]
    fake_module.parse_args = lambda _argv: _types.SimpleNamespace(from_date=None, to_date=None)  # type: ignore[attr-defined]
    fake_module.query_configs_from_env = lambda: []  # type: ignore[attr-defined]
    monkeypatch.setitem(_sys.modules, "scripts.flex_probe", fake_module)
    monkeypatch.setitem(_sys.modules, "scripts", _types.ModuleType("scripts"))

    paths = mod._select_flex_source(from_date=date(2024, 1, 1), to_date=date(2024, 12, 31), synthetic=False)
    assert paths == []
    assert called["token"] == "fake-token"


def test_select_flex_source_live_without_token_raises(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Explicit OPTIONS_FLEX_SOURCE=live without token must error, not silently fall back."""

    from app.worker.handlers import options_sync as mod
    import pytest as _pytest

    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "live")
    monkeypatch.delenv("IBKR_FLEX_TOKEN", raising=False)
    with _pytest.raises(RuntimeError, match="IBKR_FLEX_TOKEN"):
        mod._select_flex_source(from_date=None, to_date=None, synthetic=False)


def test_select_flex_source_synthetic_when_no_token_and_unset(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """No token + unset env -> synthetic fallback (preserves CI behavior)."""

    from app.worker.handlers import options_sync as mod

    monkeypatch.delenv("OPTIONS_FLEX_SOURCE", raising=False)
    monkeypatch.delenv("IBKR_FLEX_TOKEN", raising=False)
    sentinel = ["sentinel"]
    monkeypatch.setattr(mod, "_synthetic_files", lambda: sentinel)
    paths = mod._select_flex_source(from_date=None, to_date=None, synthetic=False)
    assert paths is sentinel
