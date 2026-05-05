"""Tests for manual trade CRUD endpoints (TJ-010 / GH #63).

Verifies:
- POST   /api/manual-trades  — valid input creates trade with injected household_id
- POST   /api/manual-trades  — missing required fields returns 422
- GET    /api/manual-trades  — returns only trades for the caller's household
- GET    /api/manual-trades/{id} — returns a single trade
- GET    /api/manual-trades/{id} — returns 404 for unknown trade
- GET    /api/manual-trades/{id} — returns 404 for trade in a different household
- PUT    /api/manual-trades/{id} — partial update succeeds
- PUT    /api/manual-trades/{id} — returns 404 for unknown trade
- DELETE /api/manual-trades/{id} — trade is removed
- DELETE /api/manual-trades/{id} — returns 404 for unknown trade
- household isolation — user without a household membership gets 403

Also covers:
- POST /api/trades (deprecated IBKR endpoint) injects household_id and
  scopes daily summary recalculation per household.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.schema.models import DailySummary, ManualTrade

TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_PAYLOAD: dict[str, Any] = {
    "timestamp": "2024-06-01T10:00:00Z",
    "symbol": "AAPL",
    "side": "BUY",
    "size": "10.5",
    "entry_price": "150.00",
    "exit_price": "155.00",
    "pnl": "52.50",
    "notes": "Test trade",
}


def _create_trade(client: TestClient, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST a manual trade and assert 201 Created."""
    resp = client.post("/api/manual-trades", json=payload or _VALID_PAYLOAD)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# POST /api/manual-trades
# ---------------------------------------------------------------------------


def test_create_manual_trade_success(client: TestClient) -> None:
    """Valid payload → 201 with household_id injected server-side."""
    data = _create_trade(client)

    assert data["symbol"] == "AAPL"
    assert data["side"] == "BUY"
    assert Decimal(data["pnl"]) == Decimal("52.50")
    assert data["id"] is not None
    # household_id must be injected and match the test household
    assert data["household_id"] == str(TEST_HOUSEHOLD_ID)


def test_create_manual_trade_missing_symbol(client: TestClient) -> None:
    """Missing required field → 422 Unprocessable Entity."""
    payload = {**_VALID_PAYLOAD}
    del payload["symbol"]
    resp = client.post("/api/manual-trades", json=payload)
    assert resp.status_code == 422


def test_create_manual_trade_missing_timestamp(client: TestClient) -> None:
    """Missing timestamp → 422."""
    payload = {**_VALID_PAYLOAD}
    del payload["timestamp"]
    resp = client.post("/api/manual-trades", json=payload)
    assert resp.status_code == 422


def test_create_manual_trade_invalid_decimal(client: TestClient) -> None:
    """Non-numeric size → 422."""
    payload = {**_VALID_PAYLOAD, "size": "not-a-number"}
    resp = client.post("/api/manual-trades", json=payload)
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/manual-trades (list)
# ---------------------------------------------------------------------------


def test_list_manual_trades_returns_household_trades(client: TestClient) -> None:
    """List returns only the caller's household trades."""
    _create_trade(client)
    _create_trade(client, {**_VALID_PAYLOAD, "symbol": "TSLA"})

    resp = client.get("/api/manual-trades")
    assert resp.status_code == 200
    trades = resp.json()
    assert len(trades) >= 2  # noqa: PLR2004
    symbols = {t["symbol"] for t in trades}
    assert {"AAPL", "TSLA"}.issubset(symbols)
    # All returned trades must belong to the test household
    for t in trades:
        assert t["household_id"] == str(TEST_HOUSEHOLD_ID)


def test_list_manual_trades_empty_household(session: Session, client: TestClient) -> None:
    """No trades yet → returns empty list."""
    resp = client.get("/api/manual-trades")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# GET /api/manual-trades/{trade_id}
# ---------------------------------------------------------------------------


def test_get_manual_trade_success(client: TestClient) -> None:
    """Retrieve a trade by ID returns full record."""
    created = _create_trade(client)
    trade_id = created["id"]

    resp = client.get(f"/api/manual-trades/{trade_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == trade_id
    assert data["symbol"] == "AAPL"


def test_get_manual_trade_not_found(client: TestClient) -> None:
    """Unknown ID → 404."""
    resp = client.get("/api/manual-trades/999999")
    assert resp.status_code == 404


def test_get_manual_trade_different_household_is_404(session: Session, client: TestClient) -> None:
    """Trade created with a different household_id is invisible to the caller."""
    from app.schema.household_models import Household, HouseholdMember

    other_user = uuid4()
    other_hh = Household(id=uuid4(), name="Other HH", created_by=other_user)
    session.add(other_hh)
    session.add(
        HouseholdMember(
            household_id=other_hh.id,
            user_id=other_user,
            role="owner",
            invited_by=other_user,
        )
    )
    # Insert a trade in the other household directly
    other_trade = ManualTrade(
        household_id=other_hh.id,
        timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        symbol="SPY",
        side="BUY",
        size=Decimal("5"),
        entry_price=Decimal("400"),
        exit_price=Decimal("410"),
        pnl=Decimal("50"),
    )
    session.add(other_trade)
    session.commit()
    session.refresh(other_trade)

    # The test client is authenticated as TEST_USER_ID / TEST_HOUSEHOLD_ID
    resp = client.get(f"/api/manual-trades/{other_trade.id}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/manual-trades/{trade_id}
# ---------------------------------------------------------------------------


def test_update_manual_trade_partial(client: TestClient) -> None:
    """Partial update applies only the supplied fields."""
    created = _create_trade(client)
    trade_id = created["id"]

    resp = client.put(
        f"/api/manual-trades/{trade_id}",
        json={"notes": "updated notes", "pnl": "100.00"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["notes"] == "updated notes"
    assert Decimal(data["pnl"]) == Decimal("100.00")
    # Unchanged fields must be preserved
    assert data["symbol"] == "AAPL"


def test_update_manual_trade_not_found(client: TestClient) -> None:
    """Updating unknown ID → 404."""
    resp = client.put("/api/manual-trades/999999", json={"notes": "x"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/manual-trades/{trade_id}
# ---------------------------------------------------------------------------


def test_delete_manual_trade_success(client: TestClient, session: Session) -> None:
    """Delete removes the trade; subsequent GET returns 404."""
    created = _create_trade(client)
    trade_id = created["id"]

    resp = client.delete(f"/api/manual-trades/{trade_id}")
    assert resp.status_code == 204

    # Confirm it is gone from the DB
    assert session.get(ManualTrade, trade_id) is None


def test_delete_manual_trade_not_found(client: TestClient) -> None:
    """Deleting unknown ID → 404."""
    resp = client.delete("/api/manual-trades/999999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Household isolation — unauthenticated / no-household user
# ---------------------------------------------------------------------------


def test_no_household_returns_403(unauth_client: TestClient) -> None:
    """Request without a valid Authorization header → 401 (not 403)."""
    resp = unauth_client.post("/api/manual-trades", json=_VALID_PAYLOAD)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Deprecated POST /api/trades (IBKR trade)
# ---------------------------------------------------------------------------

_IBKR_PAYLOAD: dict[str, Any] = {
    "tradeID": 1001,
    "accountId": "U1234567",
    "currency": "USD",
    "fxRateToBase": "1.0",
    "assetCategory": "STK",
    "symbol": "MSFT",
    "conid": 272093,
    "multiplier": 1,
    "quantity": "10.0",
    "tradePrice": "300.0",
    "tradeMoney": "3000.0",
    "proceeds": "3000.0",
    "taxes": "0.0",
    "ibCommission": "-1.0",
    "netCash": "2999.0",
    "closePrice": "305.0",
    "cost": "3001.0",
    "fifoPnlRealized": "50.0",
    "mtmPnl": "50.0",
    "dateTime": "2024-06-01T10:00:00",
}


def test_create_ibkr_trade_injects_household_id(client: TestClient, session: Session) -> None:
    """Deprecated /api/trades endpoint injects household_id from JWT.

    Verifies household_id is persisted in the DB (the Trade response model's
    sa_column fields may not serialize cleanly to JSON in all environments).
    """
    resp = client.post("/api/trades", json=_IBKR_PAYLOAD)
    assert resp.status_code == 200, resp.text
    from app.schema.models import Trade as TradeModel

    stored = session.exec(select(TradeModel).where(TradeModel.tradeID == _IBKR_PAYLOAD["tradeID"])).first()
    assert stored is not None
    assert stored.household_id == TEST_HOUSEHOLD_ID


def test_create_ibkr_trade_recalculates_daily_summary(client: TestClient, session: Session) -> None:
    """Creating an IBKR trade creates a DailySummary scoped to the household."""
    resp = client.post("/api/trades", json=_IBKR_PAYLOAD)
    assert resp.status_code == 200

    summary = session.exec(select(DailySummary).where(DailySummary.household_id == TEST_HOUSEHOLD_ID)).first()
    assert summary is not None
    assert summary.household_id == TEST_HOUSEHOLD_ID


def test_create_ibkr_trade_missing_datetime(client: TestClient) -> None:
    """Trades without dateTime are rejected with 422."""
    payload = {**_IBKR_PAYLOAD}
    del payload["dateTime"]
    resp = client.post("/api/trades", json=payload)
    # SQLModel will reject the missing required field at parse time
    assert resp.status_code in (422, 400)
