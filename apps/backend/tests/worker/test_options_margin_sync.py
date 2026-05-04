"""Worker tests for Phase 4 options margin snapshots."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.worker.handlers import options_margin_sync


class FakeScalar:
    """Scalar wrapper for fake aggregate selects."""

    def __init__(self, value: Decimal | None = None) -> None:
        self.value = value

    def scalar_one_or_none(self) -> Decimal | None:
        """Return the aggregate value."""

        return self.value

    def mappings(self) -> list[dict[str, Any]]:
        """Return empty mappings."""

        return []


class FakeMappings:
    """Mappings wrapper for fake account query."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return rows."""

        return self.rows


class FakeSession:
    """Small SQL recorder for synthetic margin fallback."""

    def __init__(self) -> None:
        self.snapshots: list[dict[str, Any]] = []

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeScalar | FakeMappings:
        """Return account/risk rows and record snapshot upserts."""

        sql = str(statement)
        params = params or {}
        if "from public.trading_account_config" in sql:
            assert "name" not in sql
            return FakeMappings(
                [
                    {
                        "id": 1,
                        "household_id": "10000000-0000-0000-0000-000000000001",
                        "account_id": "U123",
                    }
                ]
            )
        if "sum(capital_at_risk_open)" in sql:
            return FakeScalar(Decimal("5000"))
        if "insert into public.options_margin_snapshots" in sql:
            existing = next(
                (
                    row
                    for row in self.snapshots
                    if row["account_id"] == params["account_id"] and row["captured_at"] == params["captured_at"]
                ),
                None,
            )
            if existing:
                existing.update(params)
            else:
                self.snapshots.append(params)
        return FakeScalar()


def test_synthetic_fallback_produces_idempotent_margin_row(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """When IB Gateway is offline, synthetic margin uses open capital at risk."""

    monkeypatch.setattr(options_margin_sync, "is_ib_gateway_available", lambda *args, **kwargs: False)
    session = FakeSession()
    first = options_margin_sync.run_options_margin_sync(session)  # type: ignore[arg-type]
    second = options_margin_sync.run_options_margin_sync(session)  # type: ignore[arg-type]

    assert first["source"] == "synthetic"
    assert second["source"] == "synthetic"
    assert len(session.snapshots) == 1
    assert session.snapshots[0]["margin_used"] == Decimal("5000")
    assert session.snapshots[0]["margin_available"] == Decimal("15000")
