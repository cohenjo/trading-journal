"""
Tests for the dividend projection calculation logic.

The projection endpoint in app/api/dividends.py computes:
  - Reinvest phase: current * (1 + growth_rate + reinvest_rate * yield_rate)
  - Withdrawal phase: current * (1 + growth_rate)

Tests extract and verify the math without hitting the API.
"""

import pytest
from app.schema.dividend_models import (
    DividendRecord,
    DividendProjectionParams,
    DividendProjectionPoint,
    DividendProjectionResponse,
)


def run_dividend_projection(
    historical: list[DividendRecord],
    params: DividendProjectionParams,
) -> DividendProjectionResponse:
    """
    Replicate the projection logic from app/api/dividends.py
    so we can test it without FastAPI/file I/O.
    """
    if not historical:
        return DividendProjectionResponse(data=[])

    historical.sort(key=lambda x: x.year)
    last_record = historical[-1]
    current_amount = last_record.amount
    current_year = last_record.year

    points: list[DividendProjectionPoint] = []
    for record in historical:
        points.append(DividendProjectionPoint(year=record.year, amount=record.amount, type="historical"))

    if current_year >= params.final_year:
        return DividendProjectionResponse(data=points)

    for year in range(current_year + 1, params.final_year + 1):
        if year <= params.cutoff_year:
            growth_factor = 1 + params.growth_rate + (params.reinvest_rate * params.yield_rate)
        else:
            growth_factor = 1 + params.growth_rate
        current_amount = current_amount * growth_factor
        points.append(DividendProjectionPoint(year=year, amount=current_amount, type="projected"))

    return DividendProjectionResponse(data=points)


# ===================================================================
# Empty / No-op
# ===================================================================

class TestDividendProjectionEdgeCases:
    def test_empty_historical(self):
        result = run_dividend_projection([], DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2035,
        ))
        assert result.data == []

    def test_final_year_before_last_historical(self):
        historical = [DividendRecord(year=2023, amount=1000)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2020,
        ))
        assert len(result.data) == 1
        assert result.data[0].type == "historical"

    def test_final_year_equals_last_historical(self):
        historical = [DividendRecord(year=2023, amount=1000)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2023,
        ))
        assert len(result.data) == 1


# ===================================================================
# Growth Phases
# ===================================================================

class TestDividendProjectionGrowth:
    def test_reinvest_phase_one_year(self):
        """Single year of reinvest: 1000 * (1 + 0.05 + 1.0 * 0.03) = 1080."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert len(projected) == 1
        assert projected[0].year == 2024
        assert projected[0].amount == pytest.approx(1080.0)

    def test_withdrawal_phase_one_year(self):
        """After cutoff, only growth_rate applies: 1000 * (1 + 0.05) = 1050."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2023, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert len(projected) == 1
        assert projected[0].amount == pytest.approx(1050.0)

    def test_phase_transition(self):
        """Reinvest for 2024 (cutoff=2024), then withdraw for 2025."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        params = DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2024, final_year=2025,
        )
        result = run_dividend_projection(historical, params)
        projected = [p for p in result.data if p.type == "projected"]

        # 2024: reinvest: 1000 * 1.08 = 1080
        assert projected[0].amount == pytest.approx(1080.0)
        # 2025: withdrawal: 1080 * 1.05 = 1134
        assert projected[1].amount == pytest.approx(1134.0)


# ===================================================================
# Multi-year Compounding
# ===================================================================

class TestDividendProjectionCompounding:
    def test_three_year_reinvest(self):
        """Compound reinvest over 3 years: 1000 * 1.08^3."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2026,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert len(projected) == 3
        expected = 1000.0 * (1.08 ** 3)
        assert float(projected[-1].amount) == pytest.approx(expected, rel=1e-6)

    def test_zero_growth_rate(self):
        """With zero growth, only reinvest yield applies."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.04, growth_rate=0.0, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert projected[0].amount == pytest.approx(1040.0)

    def test_zero_reinvest_rate(self):
        """With zero reinvest, only growth applies in reinvest phase."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=0.0,
            cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert projected[0].amount == pytest.approx(1050.0)


# ===================================================================
# Multiple Historical Records
# ===================================================================

class TestDividendProjectionMultipleHistorical:
    def test_uses_last_historical_amount_as_base(self):
        """Projection starts from the last historical record's amount."""
        historical = [
            DividendRecord(year=2021, amount=500.0),
            DividendRecord(year=2022, amount=700.0),
            DividendRecord(year=2023, amount=1000.0),
        ]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2024,
        ))
        historical_points = [p for p in result.data if p.type == "historical"]
        projected = [p for p in result.data if p.type == "projected"]

        assert len(historical_points) == 3
        assert len(projected) == 1
        # Base is 1000 (last record), not 500 or 700
        assert projected[0].amount == pytest.approx(1080.0)

    def test_unsorted_historical_gets_sorted(self):
        """Historical records provided out of order should still work."""
        historical = [
            DividendRecord(year=2023, amount=1000.0),
            DividendRecord(year=2021, amount=500.0),
        ]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.03, growth_rate=0.05, reinvest_rate=1.0,
            cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        # Should use 1000 (year 2023) as base after sorting
        assert projected[0].amount == pytest.approx(1080.0)


# ===================================================================
# Negative Growth (Stress Test)
# ===================================================================

class TestDividendProjectionStress:
    def test_negative_growth_rate(self):
        """Dividends shrink with negative growth."""
        historical = [DividendRecord(year=2023, amount=1000.0)]
        result = run_dividend_projection(historical, DividendProjectionParams(
            yield_rate=0.0, growth_rate=-0.10, reinvest_rate=0.0,
            cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert projected[0].amount == pytest.approx(900.0)
