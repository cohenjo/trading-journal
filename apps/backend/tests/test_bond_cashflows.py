"""Comprehensive tests for bond cashflow generation.

Tests cover:
- Coupon schedule generation for different frequencies
- Principal cashflow at maturity
- Edge cases: zero-coupon bonds, various frequencies
- Date handling and month calculation
- Cashflow amounts and currency handling
- Bond ladder integration (rung_id)
"""

from datetime import date
import pytest

from app.utils.bond_cashflows import (
    _frequency_per_year,
    _add_months,
    generate_cashflows_for_bond,
    generate_all_cashflows,
)
from app.data.bonds_types import BondHolding


class TestFrequencyPerYear:
    """Test suite for _frequency_per_year helper function."""

    def test_annual_frequency(self):
        """Annual coupon frequency should return 1."""
        assert _frequency_per_year("ANNUAL") == 1
        assert _frequency_per_year("annual") == 1
        assert _frequency_per_year("Annual") == 1

    def test_semi_annual_frequency(self):
        """Semi-annual coupon frequency should return 2."""
        assert _frequency_per_year("SEMI_ANNUAL") == 2
        assert _frequency_per_year("semi_annual") == 2
        assert _frequency_per_year("Semi_Annual") == 2

    def test_quarterly_frequency(self):
        """Quarterly coupon frequency should return 4."""
        assert _frequency_per_year("QUARTERLY") == 4
        assert _frequency_per_year("quarterly") == 4
        assert _frequency_per_year("Quarterly") == 4

    def test_unsupported_frequency_raises_error(self):
        """Unsupported frequency should raise ValueError."""
        with pytest.raises(ValueError, match="Unsupported coupon_frequency"):
            _frequency_per_year("MONTHLY")
        
        with pytest.raises(ValueError, match="Unsupported coupon_frequency"):
            _frequency_per_year("WEEKLY")
        
        with pytest.raises(ValueError, match="Unsupported coupon_frequency"):
            _frequency_per_year("INVALID")


class TestAddMonths:
    """Test suite for _add_months date arithmetic helper."""

    def test_add_months_basic(self):
        """Adding months should work correctly."""
        start = date(2024, 1, 15)
        assert _add_months(start, 1) == date(2024, 2, 15)
        assert _add_months(start, 6) == date(2024, 7, 15)
        assert _add_months(start, 12) == date(2025, 1, 15)

    def test_add_months_year_rollover(self):
        """Adding months should handle year rollovers."""
        start = date(2024, 10, 15)
        assert _add_months(start, 3) == date(2025, 1, 15)
        assert _add_months(start, 15) == date(2026, 1, 15)

    def test_add_months_day_capping(self):
        """Day should be capped at 28 to avoid month-end issues."""
        # Day 31 gets capped to 28
        start = date(2024, 1, 31)
        assert _add_months(start, 1) == date(2024, 2, 28)
        
        # Day 29 gets capped to 28
        start = date(2024, 1, 29)
        assert _add_months(start, 1) == date(2024, 2, 28)
        
        # Day 28 stays as 28
        start = date(2024, 1, 28)
        assert _add_months(start, 1) == date(2024, 2, 28)

    def test_add_zero_months(self):
        """Adding zero months should return same month."""
        start = date(2024, 6, 15)
        assert _add_months(start, 0) == date(2024, 6, 15)

    def test_add_negative_months(self):
        """Adding negative months should go backwards."""
        start = date(2024, 6, 15)
        assert _add_months(start, -1) == date(2024, 5, 15)
        assert _add_months(start, -6) == date(2023, 12, 15)


class TestGenerateCashflowsForBond:
    """Test suite for generate_cashflows_for_bond function."""

    def test_semi_annual_bond_cashflows(self):
        """Semi-annual bond should generate correct coupon and principal cashflows."""
        bond = BondHolding(
            id="TEST001",
            issuer="Test Bond 4% 2026",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.04,
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2026, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Note: Loop generates coupons while payment_date < maturity_date
        # Issue: 2024-01-01, first payment: 2024-07-01, last before maturity: 2025-07-01
        # Payment at 2026-01-01 would equal maturity, so not included in loop
        # Expected: 3 coupons + 1 principal = 4
        assert len(cashflows) == 4
        
        # Verify coupon amounts (4% / 2 = 2% per payment)
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) == 3
        for coupon in coupons:
            assert coupon.amount == 2_000.0  # 100k * 0.04 / 2
            assert coupon.currency == "USD"
            assert coupon.bond_id == "TEST001"
        
        # Verify coupon dates (every 6 months, but stops before maturity)
        assert coupons[0].date == date(2024, 7, 1)
        assert coupons[1].date == date(2025, 1, 1)
        assert coupons[2].date == date(2025, 7, 1)
        # Next payment would be 2026-01-01 which equals maturity, so not included
        
        # Verify principal cashflow
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        assert len(principals) == 1
        assert principals[0].amount == 100_000
        assert principals[0].date == date(2026, 1, 1)
        assert principals[0].currency == "USD"

    def test_annual_bond_cashflows(self):
        """Annual bond should generate yearly coupon payments."""
        bond = BondHolding(
            id="TEST002",
            issuer="Test Bond 5% 2027",
            currency="USD",
            face_value=50_000,
            coupon_rate=0.05,
            coupon_frequency="ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2027, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Issue 2024-01-01, payments: 2025-01-01, 2026-01-01
        # Next would be 2027-01-01 which equals maturity, so not in loop
        # 2 coupons + 1 principal = 3
        assert len(cashflows) == 3
        
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) == 2
        
        # Verify annual coupon amount (5% of face value)
        for coupon in coupons:
            assert coupon.amount == 2_500.0  # 50k * 0.05
        
        # Verify annual spacing
        assert coupons[0].date == date(2025, 1, 1)
        assert coupons[1].date == date(2026, 1, 1)

    def test_quarterly_bond_cashflows(self):
        """Quarterly bond should generate 4 payments per year."""
        bond = BondHolding(
            id="TEST003",
            issuer="Test Bond 4% 2025 Quarterly",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.04,
            coupon_frequency="QUARTERLY",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2025, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Issue 2024-01-01, payments: Q2, Q3, Q4 (2024-04-01, 2024-07-01, 2024-10-01)
        # Next would be 2025-01-01 which equals maturity, so not in loop
        # 3 coupons + 1 principal = 4
        assert len(cashflows) == 4
        
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) == 3
        
        # Verify quarterly coupon amount (4% / 4 = 1% per quarter)
        for coupon in coupons:
            assert coupon.amount == 1_000.0  # 100k * 0.04 / 4
        
        # Verify quarterly spacing (3 months)
        assert coupons[0].date == date(2024, 4, 1)
        assert coupons[1].date == date(2024, 7, 1)
        assert coupons[2].date == date(2024, 10, 1)

    def test_zero_coupon_bond(self):
        """Zero-coupon bond (0% rate) should only generate principal cashflow."""
        bond = BondHolding(
            id="TEST004",
            issuer="Zero Coupon 2026",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.0,
            coupon_frequency="ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2026, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Zero coupons (0 amount) + 1 principal
        # Note: The function still generates coupon entries with 0 amount
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        for coupon in coupons:
            assert coupon.amount == 0.0
        
        # Principal should still exist
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        assert len(principals) == 1
        assert principals[0].amount == 100_000

    def test_short_term_bond(self):
        """Bond with less than 1 year to maturity."""
        bond = BondHolding(
            id="TEST005",
            issuer="Short Term 4% 2024",
            currency="USD",
            face_value=50_000,
            coupon_rate=0.04,
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2024, 7, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Only 1 coupon (at 6 months) + principal (maturity stops loop)
        # Actually, the loop generates coupons while payment_date < maturity_date
        # So first payment at 2024-07-01 is NOT < 2024-07-01, loop doesn't run
        # Only principal remains
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        # Expected: no coupons because first payment would be AT maturity
        assert len(coupons) == 0
        
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        assert len(principals) == 1

    def test_bond_with_different_currency(self):
        """Bond with EUR currency should preserve currency in cashflows."""
        bond = BondHolding(
            id="TEST006",
            issuer="Euro Bond 3% 2026",
            currency="EUR",
            face_value=100_000,
            coupon_rate=0.03,
            coupon_frequency="ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2026, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Verify all cashflows have EUR currency
        for cf in cashflows:
            assert cf.currency == "EUR"

    def test_cashflow_id_format(self):
        """Cashflow IDs should follow expected format."""
        bond = BondHolding(
            id="BOND123",
            issuer="Test",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.04,
            coupon_frequency="ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2026, 1, 1),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # Coupon IDs: {bond_id}-coupon-{date}
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        for coupon in coupons:
            assert coupon.id.startswith("BOND123-coupon-")
            assert coupon.bond_id == "BOND123"
        
        # Principal ID: {bond_id}-principal-{maturity_date}
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        assert principals[0].id == "BOND123-principal-2026-01-01"

    def test_rung_id_assignment(self):
        """All cashflows should have rung_id based on maturity year."""
        bond = BondHolding(
            id="TEST007",
            issuer="Test",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.04,
            coupon_frequency="ANNUAL",
            issue_date=date(2024, 1, 1),
            maturity_date=date(2037, 6, 30),
        )
        
        cashflows = generate_cashflows_for_bond(bond)
        
        # All cashflows should have rung_id corresponding to maturity year
        for cf in cashflows:
            assert cf.rung_id is not None
            # rung_id_for_year returns str(year), so '2037'
            assert cf.rung_id == "2037"


class TestGenerateAllCashflows:
    """Test suite for generate_all_cashflows function."""

    def test_filters_usd_bonds_only(self):
        """generate_all_cashflows should only process USD bonds."""
        bonds = [
            BondHolding(
                id="USD1",
                issuer="USD Bond",
                currency="USD",
                face_value=100_000,
                coupon_rate=0.04,
                coupon_frequency="ANNUAL",
                issue_date=date(2024, 1, 1),
                maturity_date=date(2026, 1, 1),
            ),
            BondHolding(
                id="EUR1",
                issuer="EUR Bond",
                currency="EUR",
                face_value=100_000,
                coupon_rate=0.03,
                coupon_frequency="ANNUAL",
                issue_date=date(2024, 1, 1),
                maturity_date=date(2026, 1, 1),
            ),
            BondHolding(
                id="USD2",
                issuer="USD Bond 2",
                currency="USD",
                face_value=50_000,
                coupon_rate=0.05,
                coupon_frequency="ANNUAL",
                issue_date=date(2024, 1, 1),
                maturity_date=date(2026, 1, 1),
            ),
        ]
        
        cashflows = generate_all_cashflows(bonds)
        
        # Only USD bonds should be processed
        bond_ids = {cf.bond_id for cf in cashflows}
        assert "USD1" in bond_ids
        assert "USD2" in bond_ids
        assert "EUR1" not in bond_ids

    def test_empty_bond_list(self):
        """Empty bond list should return empty cashflows."""
        cashflows = generate_all_cashflows([])
        assert cashflows == []

    def test_combines_multiple_bonds(self):
        """Multiple bonds should generate combined cashflow list."""
        bonds = [
            BondHolding(
                id="BOND1",
                issuer="Bond 1",
                currency="USD",
                face_value=100_000,
                coupon_rate=0.04,
                coupon_frequency="ANNUAL",
                issue_date=date(2024, 1, 1),
                maturity_date=date(2026, 1, 1),
            ),
            BondHolding(
                id="BOND2",
                issuer="Bond 2",
                currency="USD",
                face_value=50_000,
                coupon_rate=0.05,
                coupon_frequency="ANNUAL",
                issue_date=date(2024, 1, 1),
                maturity_date=date(2027, 1, 1),
            ),
        ]
        
        cashflows = generate_all_cashflows(bonds)
        
        # BOND1: issue 2024-01-01, payments 2025-01-01 (2026 = maturity, excluded)
        #        1 coupon + 1 principal = 2
        # BOND2: issue 2024-01-01, payments 2025-01-01, 2026-01-01 (2027 = maturity, excluded)
        #        2 coupons + 1 principal = 3
        # Total: 5
        assert len(cashflows) == 5
        
        bond1_cashflows = [cf for cf in cashflows if cf.bond_id == "BOND1"]
        bond2_cashflows = [cf for cf in cashflows if cf.bond_id == "BOND2"]
        
        assert len(bond1_cashflows) == 2
        assert len(bond2_cashflows) == 3
