"""Worker tests for options monthly metrics persistence."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.worker.handlers.options_metrics import compute_options_monthly_metrics


class FakeMappings:
    """Mappings wrapper for fake SELECT statements."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class FakeSession:
    """Small SQL recorder for monthly metric worker behavior."""

    def __init__(self) -> None:
        self.monthly_rows: list[dict[str, Any]] = []

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        """Return deterministic facts and record dashboard inserts."""

        sql = str(statement)
        params = params or {}
        if "select distinct household_id" in sql:
            return FakeMappings([{"household_id": "10000000-0000-0000-0000-000000000001", "account_id": "U1234567"}])
        if "from public.options_trades" in sql and "union all" in sql:
            return FakeMappings(
                [
                    {
                        "trade_date": date(2026, 1, 2),
                        "net_cash_flow": Decimal("200"),
                        "realized_pnl": Decimal("0"),
                        "trade_count": 1,
                    },
                    {
                        "trade_date": date(2026, 1, 17),
                        "net_cash_flow": Decimal("-2900"),
                        "realized_pnl": Decimal("0"),
                        "trade_count": 0,
                    },
                    {
                        "trade_date": date(2026, 1, 20),
                        "net_cash_flow": Decimal("3000"),
                        "realized_pnl": Decimal("0"),
                        "trade_count": 1,
                    },
                ]
            )
        if "insert into public.options_dashboard_monthly" in sql:
            self.monthly_rows.append(dict(params))
        return FakeMappings([])


def test_monthly_metrics_include_assignment_synthetic_cash_events() -> None:
    """NFLX-style flow is 200 + (-2900) + 3000 = 300 net cash flow."""

    session = FakeSession()

    result = compute_options_monthly_metrics(session)  # type: ignore[arg-type]

    assert result["row_count"] == 1
    assert session.monthly_rows[0]["cash_flow_total"] == Decimal("300")
    assert session.monthly_rows[0]["cash_flow_cumulative"] == Decimal("300")
