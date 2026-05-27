"""Tests for the RSU plan hydration worker and the /price-data/{symbol} API endpoint.

Unit tests cover:
  - hydrate_rsu_plan_accounts: patches RSU plan items with price + dividend_yield
  - hydrate_rsu_plan_accounts: skips non-RSU items, missing tickers
  - RSU business rules: dividend_tax_rate=25, dividend_policy=Payout always applied
  - WIX (no dividend): yield stored as 0, no error
  - MSFT (with yield): yield stored as decimal fraction
  - GET /api/finances/price-data/{symbol}: returns cached data
  - GET /api/finances/price-data/{symbol}: 404 when not in cache
  - Schedule registration in JOB_SCHEDULES
"""

from __future__ import annotations

import json
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.worker.rsu_plan_hydration import (
    RSU_HYDRATION_CRON_DEFAULT,
    RSU_HYDRATION_JOB_ID,
    _apply_rsu_hydration,
    _get_stock_symbol,
    _is_rsu_item,
)
from app.worker.registry import JOB_SCHEDULES
from app.services.price_cache import CachedPriceData


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_cached(symbol: str, price: str, dividend_yield: str | None) -> CachedPriceData:
    return CachedPriceData(
        symbol=symbol,
        currency="USD",
        price=Decimal(price),
        dividend_yield=Decimal(dividend_yield) if dividend_yield is not None else None,
        refreshed_at=datetime(2025, 1, 1, 22, 0, tzinfo=UTC),
    )


def _make_rsu_plan_item(symbol: str, extra_acc: dict | None = None) -> dict[str, Any]:
    acc = {"type": "RSU", "stock_symbol": symbol}
    if extra_acc:
        acc.update(extra_acc)
    return {
        "id": "item-1",
        "name": f"RSU {symbol}",
        "category": "Account",
        "account_settings": acc,
    }


# ---------------------------------------------------------------------------
# Unit tests: _is_rsu_item
# ---------------------------------------------------------------------------


def test_is_rsu_item_by_account_settings_type() -> None:
    item = _make_rsu_plan_item("MSFT")
    assert _is_rsu_item(item) is True


def test_is_rsu_item_by_item_type() -> None:
    item = {"type": "RSU", "name": "My RSU"}
    assert _is_rsu_item(item) is True


def test_is_rsu_item_by_sub_category() -> None:
    item = {"sub_category": "rsu", "name": "My RSU"}
    assert _is_rsu_item(item) is True


def test_is_rsu_item_case_insensitive() -> None:
    item = {"account_settings": {"type": "rsu"}}
    assert _is_rsu_item(item) is True


def test_is_rsu_item_false_for_regular_account() -> None:
    item = {"type": "Savings", "account_settings": {"type": "Savings"}}
    assert _is_rsu_item(item) is False


# ---------------------------------------------------------------------------
# Unit tests: _get_stock_symbol
# ---------------------------------------------------------------------------


def test_get_stock_symbol_returns_upper() -> None:
    item = _make_rsu_plan_item("wix")
    assert _get_stock_symbol(item) == "WIX"


def test_get_stock_symbol_returns_none_when_missing() -> None:
    item = {"account_settings": {"type": "RSU"}}
    assert _get_stock_symbol(item) is None


def test_get_stock_symbol_returns_none_when_empty() -> None:
    item = {"account_settings": {"type": "RSU", "stock_symbol": ""}}
    assert _get_stock_symbol(item) is None


# ---------------------------------------------------------------------------
# Unit tests: _apply_rsu_hydration
# ---------------------------------------------------------------------------


def test_apply_rsu_hydration_msft_patches_price_and_yield() -> None:
    """MSFT with 0.87 % yield → account_settings and details both patched.

    CONVENTION: dividend_yield is stored as percentage form (0.87 = 0.87%).
    yfinance returns decimal fraction (0.0087) — normalize on write.
    """
    item = _make_rsu_plan_item("MSFT")
    cached = _make_cached("MSFT", "420.50", "0.87")

    result = _apply_rsu_hydration(item, cached)

    acc = result["account_settings"]
    assert acc["current_price"] == "420.50"
    assert acc["dividend_yield"] == "0.87"
    assert acc["dividend_tax_rate"] == "25"
    assert acc["dividend_policy"] == "Payout"

    details = result["details"]
    assert details["current_price"] == "420.50"
    assert details["dividend_yield"] == "0.87"
    assert details["dividend_tax_rate"] == "25"
    assert details["dividend_policy"] == "Payout"


def test_apply_rsu_hydration_wix_no_dividend() -> None:
    """WIX with no dividend yield → dividend_yield stored as '0'."""
    item = _make_rsu_plan_item("WIX")
    cached = _make_cached("WIX", "15.20", None)

    result = _apply_rsu_hydration(item, cached)

    acc = result["account_settings"]
    assert acc["dividend_yield"] == "0"
    assert acc["dividend_tax_rate"] == "25"
    assert acc["dividend_policy"] == "Payout"


def test_apply_rsu_hydration_does_not_mutate_original() -> None:
    """Original item dict must not be modified."""
    item = _make_rsu_plan_item("MSFT")
    original_acc = dict(item["account_settings"])
    cached = _make_cached("MSFT", "420.00", "0.87")

    _apply_rsu_hydration(item, cached)

    assert item["account_settings"] == original_acc


def test_apply_rsu_hydration_rsu_rules_always_written() -> None:
    """Business rules (tax_rate=25, policy=Payout) are written even if item had different values."""
    item = _make_rsu_plan_item("MSFT", extra_acc={"dividend_tax_rate": "10", "dividend_policy": "Accumulate"})
    cached = _make_cached("MSFT", "420.00", "0.87")

    result = _apply_rsu_hydration(item, cached)

    acc = result["account_settings"]
    assert acc["dividend_tax_rate"] == "25"
    assert acc["dividend_policy"] == "Payout"


# ---------------------------------------------------------------------------
# Unit tests: hydrate_rsu_plan_accounts (via mocked DB)
# ---------------------------------------------------------------------------


def _build_plan_row(plan_id: str, items: list[dict]) -> dict:
    return {"id": plan_id, "data": {"items": items}}


def _build_snapshot_row(hh_id: str, date: str, items: list[dict]) -> dict:
    return {"household_id": hh_id, "date": date, "data": {"items": items}}


class _MockMappings:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def mappings(self) -> "_MockMappings":
        return self

    def all(self) -> list[dict]:
        return self._rows

    def first(self) -> dict | None:
        return self._rows[0] if self._rows else None


class _MockExecResult:
    def __init__(self, rows: list[dict] | list) -> None:
        self._rows = rows

    def mappings(self) -> "_MockMappings":
        return _MockMappings(self._rows)

    def scalars(self) -> "_ScalarResult":
        return _ScalarResult([r.get("data") for r in self._rows if "data" in r])


class _ScalarResult:
    def __init__(self, values: list) -> None:
        self._values = values

    def all(self) -> list:
        return self._values


class FakeSession(AbstractContextManager["FakeSession"]):
    def __init__(self, plan_rows: list[dict], snapshot_rows: list[dict], cache_rows: list[dict]) -> None:
        self.plan_rows = plan_rows
        self.snapshot_rows = snapshot_rows
        self.cache_rows = cache_rows
        self.updates: list[dict] = []
        self.commits = 0

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *_: object) -> bool:
        return False

    def execute(self, stmt: object, params: dict | None = None) -> _MockExecResult:
        sql = str(stmt).lower()
        params = params or {}

        if "public.plans" in sql and "select" in sql and "update" not in sql:
            return _MockExecResult(self.plan_rows)
        if "public.finance_snapshots" in sql and "select" in sql and "update" not in sql:
            return _MockExecResult(self.snapshot_rows)
        if "public.price_cache" in sql and "select" in sql:
            sym = params.get("symbol", "")
            curr = params.get("currency", "USD")
            match = next((r for r in self.cache_rows if r["symbol"] == sym and r["currency"] == curr), None)
            return _MockExecResult([match] if match else [])
        # UPDATE statements
        if "update" in sql:
            self.updates.append({"sql": sql, "params": params})
        return _MockExecResult([])

    def commit(self) -> None:
        self.commits += 1


def test_hydrate_plans_patches_msft_item(monkeypatch: pytest.MonkeyPatch) -> None:
    """Worker patches MSFT RSU plan item with price and dividend yield."""
    from app.worker import rsu_plan_hydration as mod

    plan_item = _make_rsu_plan_item("MSFT")
    plan_rows = [_build_plan_row("plan-1", [plan_item])]
    cache_rows = [
        {
            "symbol": "MSFT",
            "currency": "USD",
            "price": "420.50",
            "dividend_yield": "0.87",
            "refreshed_at": datetime.now(UTC),
        }
    ]

    session = FakeSession(plan_rows, [], cache_rows)

    monkeypatch.setattr(mod, "direct_engine", MagicMock())
    with patch("app.worker.rsu_plan_hydration.Session") as MockSession:
        MockSession.return_value.__enter__.return_value = session
        MockSession.return_value.__exit__.return_value = False

        # Patch the two-phase Session calls to both return the same fake session
        MockSession.side_effect = lambda engine: session

        # Run only the plan hydration phase directly with our fake session
        price_lookup = {
            "MSFT": CachedPriceData(
                symbol="MSFT",
                currency="USD",
                price=Decimal("420.50"),
                dividend_yield=Decimal("0.87"),
                refreshed_at=datetime.now(UTC),
            )
        }
        count = mod._hydrate_plans(session, price_lookup)

    assert count == 1
    update = next(u for u in session.updates if "plans" in u["sql"])
    written_data = json.loads(update["params"]["data"])
    acc = written_data["items"][0]["account_settings"]
    assert acc["current_price"] == "420.50"
    assert acc["dividend_yield"] == "0.87"
    assert acc["dividend_tax_rate"] == "25"
    assert acc["dividend_policy"] == "Payout"


def test_hydrate_plans_skips_non_rsu_item() -> None:
    """Non-RSU items are left unchanged."""
    from app.worker import rsu_plan_hydration as mod

    non_rsu = {
        "id": "item-2",
        "name": "Savings Account",
        "category": "Account",
        "account_settings": {"type": "Savings"},
    }
    session = FakeSession([_build_plan_row("plan-1", [non_rsu])], [], [])

    price_lookup: dict = {}
    count = mod._hydrate_plans(session, price_lookup)

    assert count == 0
    assert not session.updates


def test_hydrate_plans_skips_rsu_without_ticker() -> None:
    """RSU item without stock_symbol is skipped (no crash)."""
    from app.worker import rsu_plan_hydration as mod

    item = {"id": "item-3", "name": "Unknown RSU", "account_settings": {"type": "RSU"}}
    session = FakeSession([_build_plan_row("plan-1", [item])], [], [])

    price_lookup: dict = {}
    count = mod._hydrate_plans(session, price_lookup)

    assert count == 0


def test_hydrate_plans_skips_rsu_not_in_cache() -> None:
    """RSU item whose ticker is not yet in price_cache is skipped gracefully."""
    from app.worker import rsu_plan_hydration as mod

    item = _make_rsu_plan_item("WIX")
    session = FakeSession([_build_plan_row("plan-1", [item])], [], [])

    # Price cache is empty
    price_lookup: dict = {}
    count = mod._hydrate_plans(session, price_lookup)

    assert count == 0


def test_hydrate_wix_no_dividend_stores_zero() -> None:
    """WIX RSU item with no yield in cache → dividend_yield = '0' (no error)."""
    from app.worker import rsu_plan_hydration as mod

    item = _make_rsu_plan_item("WIX")
    session = FakeSession([_build_plan_row("plan-1", [item])], [], [])

    price_lookup = {
        "WIX": CachedPriceData(
            symbol="WIX",
            currency="USD",
            price=Decimal("15.20"),
            dividend_yield=None,
            refreshed_at=datetime.now(UTC),
        )
    }
    count = mod._hydrate_plans(session, price_lookup)

    assert count == 1
    update = next(u for u in session.updates if "plans" in u["sql"])
    written_data = json.loads(update["params"]["data"])
    acc = written_data["items"][0]["account_settings"]
    assert acc["dividend_yield"] == "0"
    assert acc["dividend_tax_rate"] == "25"
    assert acc["dividend_policy"] == "Payout"


# ---------------------------------------------------------------------------
# Unit tests: GET /api/finances/price-data/{symbol}
# ---------------------------------------------------------------------------


def test_get_cached_price_data_returns_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """Endpoint returns cached price and dividend_yield in percentage form."""
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from app.api.finances import router
    from app.dal.database import get_session
    from app.services.price_cache import CachedPriceData

    test_app = FastAPI()
    test_app.include_router(router)

    # CONVENTION: dividend_yield stored as percentage form (0.87 = 0.87%).
    # yfinance returns decimal fraction (0.0087) — normalize on write.
    cached = CachedPriceData(
        symbol="MSFT",
        currency="USD",
        price=Decimal("420.50"),
        dividend_yield=Decimal("0.87"),
        refreshed_at=datetime(2025, 1, 1, 22, 0, tzinfo=UTC),
    )

    fake_session = MagicMock()
    test_app.dependency_overrides[get_session] = lambda: fake_session

    with patch("app.api.finances.lookup_cached_price_data", return_value=cached):
        client = TestClient(test_app)
        resp = client.get("/api/finances/price-data/MSFT")

    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "MSFT"
    assert body["price"] == "420.50"
    assert body["dividend_yield"] == "0.87"
    assert body["currency"] == "USD"


def test_get_cached_price_data_returns_null_yield_for_wix(monkeypatch: pytest.MonkeyPatch) -> None:
    """WIX with no dividend → dividend_yield is null in response."""
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from app.api.finances import router
    from app.dal.database import get_session

    test_app = FastAPI()
    test_app.include_router(router)

    cached = CachedPriceData(
        symbol="WIX",
        currency="USD",
        price=Decimal("15.20"),
        dividend_yield=None,
        refreshed_at=datetime(2025, 1, 1, 22, 0, tzinfo=UTC),
    )

    fake_session = MagicMock()
    test_app.dependency_overrides[get_session] = lambda: fake_session

    with patch("app.api.finances.lookup_cached_price_data", return_value=cached):
        client = TestClient(test_app)
        resp = client.get("/api/finances/price-data/WIX")

    assert resp.status_code == 200
    assert resp.json()["dividend_yield"] is None


def test_get_cached_price_data_404_when_not_cached() -> None:
    """Returns 404 when symbol is not in the cache."""
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from app.api.finances import router
    from app.dal.database import get_session

    test_app = FastAPI()
    test_app.include_router(router)

    fake_session = MagicMock()
    test_app.dependency_overrides[get_session] = lambda: fake_session

    with patch("app.api.finances.lookup_cached_price_data", return_value=None):
        client = TestClient(test_app)
        resp = client.get("/api/finances/price-data/FAKE")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Schedule registration
# ---------------------------------------------------------------------------


def test_rsu_hydration_schedule_registered() -> None:
    """RSU hydration job is registered in JOB_SCHEDULES."""
    schedule = next((s for s in JOB_SCHEDULES if s.job_id == RSU_HYDRATION_JOB_ID), None)
    assert schedule is not None, f"{RSU_HYDRATION_JOB_ID} not found in JOB_SCHEDULES"
    assert schedule.kind == "cron"
    assert schedule.cron_expr == RSU_HYDRATION_CRON_DEFAULT


def test_rsu_hydration_schedule_not_duplicated() -> None:
    """Re-importing the module must not register a duplicate schedule."""
    from app.worker import rsu_plan_hydration  # noqa: F401

    ids = [s.job_id for s in JOB_SCHEDULES if s.job_id == RSU_HYDRATION_JOB_ID]
    assert len(ids) == 1
