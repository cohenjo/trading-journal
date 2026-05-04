"""Smoke tests for synthetic IBKR Flex fixtures."""

from __future__ import annotations

import shutil
from decimal import Decimal
from pathlib import Path

from scripts.flex_probe import summarize_flex_xml
from scripts.flex_synthetic import write_synthetic_files


def test_jony_worked_example_totals() -> None:
    """The synthetic harness preserves Jony's cash-vs-P&L worked example."""
    output_dir = Path("tmp/test-flex-synthetic")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    try:
        paths = write_synthetic_files(output_dir)
        summary = summarize_flex_xml(paths)
        jony = summary["scenario_summaries"]["jony_worked_example"]
        assert Decimal(jony["cash_flow"]) == Decimal("2700.00")
        assert Decimal(jony["fifoPnlRealized"]) == Decimal("1000.00")
        assert {f"multiyear_smoke_{year}" for year in range(2021, 2025)}.issubset(summary["scenario_summaries"])
    finally:
        if output_dir.exists():
            shutil.rmtree(output_dir)
