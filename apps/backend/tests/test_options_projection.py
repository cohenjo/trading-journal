"""
Tests for the options income projection calculation.

The projection in app/api/options.py computes:
  - base_amount = average of historical amounts
  - Growth phase: base_amount * (1 + growth_rate) ** years_from_last_hist
  - Flat phase (after cutoff): holds at the cutoff_year value

Tests replicate the math without file I/O.
"""

import pytest
from app.schema.options_models import (
    OptionsRecord,
    OptionsProjectionParams,
    OptionsProjectionPoint,
    OptionsProjectionResponse,
)


def run_options_projection(
    historical: list[OptionsRecord],
    params: OptionsProjectionParams,
) -> OptionsProjectionResponse:
    """Replicate the projection logic from app/api/options.py."""
    if not historical:
        return OptionsProjectionResponse(data=[])

    historical.sort(key=lambda x: x.year)
    total = sum(r.amount for r in historical)
    count = len(historical)
    base_amount = total / count if count > 0 else 0.0

    if base_amount <= 0:
        points = [OptionsProjectionPoint(year=r.year, amount=r.amount, type="historical") for r in historical]
        return OptionsProjectionResponse(data=points)

    points: list[OptionsProjectionPoint] = []
    for record in historical:
        points.append(OptionsProjectionPoint(year=record.year, amount=record.amount, type="historical"))

    last_hist_year = historical[-1].year
    if params.final_year <= last_hist_year:
        return OptionsProjectionResponse(data=points)

    cutoff_value: float | None = None
    for year in range(last_hist_year + 1, params.final_year + 1):
        if year <= params.cutoff_year:
            years_from_last_hist = year - last_hist_year
            current_amount = base_amount * ((1 + params.growth_rate) ** years_from_last_hist)
            if year == params.cutoff_year:
                cutoff_value = current_amount
        else:
            if cutoff_value is None:
                cutoff_value = base_amount
            current_amount = cutoff_value
        points.append(OptionsProjectionPoint(year=year, amount=current_amount, type="projected"))

    return OptionsProjectionResponse(data=points)


# ===================================================================
# Empty / Edge Cases
# ===================================================================

class TestOptionsProjectionEdgeCases:
    def test_empty_historical(self):
        result = run_options_projection([], OptionsProjectionParams(
            growth_rate=0.05, cutoff_year=2030, final_year=2035,
        ))
        assert result.data == []

    def test_final_year_before_last_historical(self):
        historical = [OptionsRecord(year=2023, amount=5000)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.05, cutoff_year=2030, final_year=2020,
        ))
        assert len(result.data) == 1
        assert result.data[0].type == "historical"

    def test_zero_base_amount_returns_historical_only(self):
        """If all historical amounts average to zero, no projection."""
        historical = [
            OptionsRecord(year=2022, amount=100),
            OptionsRecord(year=2023, amount=-100),
        ]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.05, cutoff_year=2030, final_year=2035,
        ))
        # base_amount = 0, so only historical returned
        assert all(p.type == "historical" for p in result.data)


# ===================================================================
# Growth Phase
# ===================================================================

class TestOptionsProjectionGrowth:
    def test_one_year_growth(self):
        """base=5000, 1 year at 10% growth: 5000 * 1.10 = 5500."""
        historical = [OptionsRecord(year=2023, amount=5000.0)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.10, cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert len(projected) == 1
        assert projected[0].amount == pytest.approx(5500.0)

    def test_three_year_compound_growth(self):
        """base=5000, 3 years at 10%: 5000 * 1.10^3."""
        historical = [OptionsRecord(year=2023, amount=5000.0)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.10, cutoff_year=2030, final_year=2026,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        assert len(projected) == 3
        expected = 5000.0 * (1.10 ** 3)
        assert projected[-1].amount == pytest.approx(expected, rel=1e-6)

    def test_base_is_average_of_historical(self):
        """Base amount = average(2000, 4000, 6000) = 4000."""
        historical = [
            OptionsRecord(year=2021, amount=2000.0),
            OptionsRecord(year=2022, amount=4000.0),
            OptionsRecord(year=2023, amount=6000.0),
        ]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.10, cutoff_year=2030, final_year=2024,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        # base = 4000, 1 year at 10%: 4000 * 1.10 = 4400
        assert projected[0].amount == pytest.approx(4400.0)


# ===================================================================
# Flat Phase (After Cutoff)
# ===================================================================

class TestOptionsProjectionFlatPhase:
    def test_flat_after_cutoff(self):
        """Growth to cutoff, then flat."""
        historical = [OptionsRecord(year=2023, amount=1000.0)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.10, cutoff_year=2025, final_year=2027,
        ))
        projected = [p for p in result.data if p.type == "projected"]

        # 2024: 1000 * 1.10^1 = 1100
        # 2025: 1000 * 1.10^2 = 1210 (cutoff)
        # 2026: 1210 (flat)
        # 2027: 1210 (flat)
        assert projected[0].amount == pytest.approx(1100.0)
        assert projected[1].amount == pytest.approx(1210.0)
        assert projected[2].amount == pytest.approx(1210.0)
        assert projected[3].amount == pytest.approx(1210.0)

    def test_cutoff_before_last_historical(self):
        """If cutoff <= last_hist_year, flat phase uses base_amount."""
        historical = [OptionsRecord(year=2023, amount=1000.0)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.10, cutoff_year=2022, final_year=2025,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        # cutoff_value is None initially, so it falls back to base_amount = 1000
        assert all(p.amount == pytest.approx(1000.0) for p in projected)


# ===================================================================
# Zero Growth
# ===================================================================

class TestOptionsProjectionZeroGrowth:
    def test_zero_growth_stays_at_base(self):
        historical = [OptionsRecord(year=2023, amount=3000.0)]
        result = run_options_projection(historical, OptionsProjectionParams(
            growth_rate=0.0, cutoff_year=2030, final_year=2025,
        ))
        projected = [p for p in result.data if p.type == "projected"]
        # 3000 * 1.0^n = 3000 for all years
        for p in projected:
            assert p.amount == pytest.approx(3000.0)
