"""End-to-end synthetic checks for Jony's Phase 2 options worked example."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
import shutil

from app.services.options.metrics import OptionMetricRoll, OptionMetricTrade, compute_monthly_metrics
from app.services.options.strategy_grouper import StrategyTrade, group_option_strategies
from app.services.options.flex_parser import parse_flex_files
from scripts.flex_synthetic import write_synthetic_files


def test_jony_synthetic_roll_chain_and_roll_metrics_reconcile() -> None:
    """Synthetic Flex fixtures produce Jony's documented cash/P&L/gap and roll metrics."""

    output_dir = Path("tmp/test-jony-phase2-e2e")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    try:
        parsed = parse_flex_files(write_synthetic_files(output_dir))
        jony_trades = [trade for trade in parsed.trades if trade.raw_payload.get("scenario") == "jony_worked_example"]
        strategy_trades = [
            StrategyTrade(
                trade_id=trade.source_trade_id,
                household_id="10000000-0000-0000-0000-000000000001",
                account_id=trade.account_id,
                trade_time=trade.trade_time,
                trade_date=trade.trade_date,
                underlying_symbol=trade.leg.underlying_symbol,
                right=trade.leg.right,
                side=trade.side,
                open_close_indicator=trade.raw_payload.get("openCloseIndicator"),
                event_type=trade.event_type,
                strike=trade.leg.strike,
                expiry=trade.leg.expiry,
                quantity=trade.quantity,
                realized_pnl=trade.realized_pnl,
                net_cash_flow=trade.net_cash_flow,
                currency=trade.currency,
            )
            for trade in jony_trades
        ]
        grouped = group_option_strategies(strategy_trades)
        assert len(grouped.groups) == 1
        assert grouped.groups[0].kind == "roll_chain"
        assert set(grouped.groups[0].trade_ids) == {trade.source_trade_id for trade in jony_trades}
        assert len(grouped.roll_events) == 1
        assert grouped.roll_events[0].classification == "negative"
        assert grouped.roll_events[0].closed_leg_realized_pnl == Decimal("-1000.000000")

        metrics = compute_monthly_metrics(
            [
                OptionMetricTrade(
                    trade_date=trade.trade_date,
                    net_cash_flow=trade.net_cash_flow,
                    realized_pnl=trade.realized_pnl,
                )
                for trade in jony_trades
            ],
            [OptionMetricRoll(detected_date=date(2025, 2, 14), classification="negative")],
        )
        assert metrics[-1].cash_flow_cumulative == Decimal("2700.000000")
        assert metrics[-1].realized_pnl_cumulative == Decimal("1000.000000")
        assert metrics[-1].variance_gap_cumulative == Decimal("1700.000000")
        assert sum(row.roll_count for row in metrics) == 1
        assert sum(row.roll_negative_count for row in metrics) == 1
        assert metrics[1].roll_efficiency_pct == Decimal("0.00")
    finally:
        if output_dir.exists():
            shutil.rmtree(output_dir)
