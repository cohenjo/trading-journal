"""Tests for typed IBKR Flex options parser."""

from __future__ import annotations

import shutil
from decimal import Decimal
from pathlib import Path

from app.services.options.flex_parser import parse_flex_files
from scripts.flex_synthetic import write_synthetic_files


def test_parse_synthetic_flex_rows_into_typed_models() -> None:
    """Synthetic Phase 0 fixtures decode key financial fields as Decimals."""

    output_dir = Path("tmp/test-options-flex-parser")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    try:
        paths = write_synthetic_files(output_dir)
        parsed = parse_flex_files(paths)
        assert len(parsed.trades) == 14
        first = parsed.trades[0]
        assert first.account_id == "U1234567"
        assert first.leg.underlying_symbol == "SPY"
        assert first.leg.right == "put"
        assert first.net_cash_flow == Decimal("4000.000000")
        assert first.realized_pnl == Decimal("0.000000")
        losing_roll = next(row for row in parsed.trades if row.source_trade_id == "T-JONY-003")
        assert losing_roll.realized_pnl == Decimal("-1000.000000")
        assert parsed.open_positions[0].quantity_open == Decimal("-1.000000")
        assert parsed.account_information[0].raw_payload["netLiquidation"] == "100000.000000"
    finally:
        if output_dir.exists():
            shutil.rmtree(output_dir)
