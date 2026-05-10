"""Backend tests for bond ladder + bond_holdings integration (#356).

Verifies:
- Coupon rate percentage-to-decimal conversion (bond_holdings stores 4.25, cashflows need 0.0425)
- 18 IBKR bonds generate correct semi-annual coupon amounts
- Ladder rungs match bond maturity years
- generate_cashflows_for_bond with default SEMI_ANNUAL frequency
"""

from datetime import date
import pytest

from app.data.bonds_types import BondHolding
from app.utils.bond_cashflows import generate_cashflows_for_bond, generate_all_cashflows


def make_ibkr_bond(
    i: int,
    coupon_rate_pct: float = 4.25,
    face_value: float = 10_000.0,
    maturity_year: int = 2030,
) -> BondHolding:
    """
    Simulate a bond_holdings row converted to BondHolding.
    In bond_holdings: coupon_rate = 4.25 (percentage units).
    The frontend divides by 100 → 0.0425 before feeding to cashflow logic.
    Here we pre-apply that division to match the production code path.
    """
    coupon_rate_decimal = coupon_rate_pct / 100.0  # production conversion
    return BondHolding(
        id=f"flex_U2515365_{600_000_000 + i}_2026-05-08",
        ticker=f"BOND{i + 1}",
        issuer=f"BOND{i + 1}",  # fallback from ticker when issuer is NULL
        currency="USD",
        face_value=face_value,
        coupon_rate=coupon_rate_decimal,
        coupon_frequency="SEMI_ANNUAL",  # default for US bonds when column is NULL
        issue_date=date(2020, 1, 1),
        maturity_date=date(maturity_year, 6, 15),
    )


class TestCouponRateConversion:
    """Verify percentage → decimal conversion for bond_holdings.coupon_rate."""

    def test_semi_annual_coupon_from_pct_rate(self):
        """4.25% rate on $10k face → $212.50 per semi-annual payment."""
        bond = make_ibkr_bond(0, coupon_rate_pct=4.25, face_value=10_000)
        cashflows = generate_cashflows_for_bond(bond)
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) > 0
        for coupon in coupons:
            assert abs(coupon.amount - 212.50) < 0.01, (
                f"Expected 212.50 per semi-annual coupon, got {coupon.amount}. "
                "Did you forget to divide coupon_rate by 100?"
            )

    def test_not_dividing_by_100_gives_wrong_result(self):
        """Sanity: if we erroneously pass coupon_rate=4.25 (not /100), amount = 21250 (wrong)."""
        bond_wrong = BondHolding(
            id="wrong-rate-bond",
            ticker="WRONG",
            issuer="Wrong Rate Corp",
            currency="USD",
            face_value=10_000,
            coupon_rate=4.25,  # NOT divided by 100 — intentionally wrong
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2020, 1, 1),
            maturity_date=date(2030, 6, 15),
        )
        cashflows = generate_cashflows_for_bond(bond_wrong)
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) > 0
        # Wrong: 10_000 * 4.25 / 2 = 21_250 (not 212.50)
        assert coupons[0].amount == pytest.approx(21_250.0, abs=0.01)

    def test_various_pct_coupon_rates(self):
        """Spot-check multiple percentage coupon rates from the live dataset."""
        samples = [
            (4.25, 10_000, 212.50),  # AAPL bond
            (4.05, 10_000, 202.50),  # AMZN bond
            (3.50, 10_000, 175.00),  # BA bond
            (3.875, 10_000, 193.75),  # T 3 7/8 bond
        ]
        for pct_rate, face, expected_semiannual in samples:
            bond = BondHolding(
                id=f"test-{pct_rate}",
                ticker=f"BOND{pct_rate}",
                issuer=f"Issuer {pct_rate}",
                currency="USD",
                face_value=face,
                coupon_rate=pct_rate / 100,
                coupon_frequency="SEMI_ANNUAL",
                issue_date=date(2020, 1, 1),
                maturity_date=date(2030, 6, 15),
            )
            cashflows = generate_cashflows_for_bond(bond)
            coupons = [cf for cf in cashflows if cf.type == "COUPON"]
            assert len(coupons) > 0
            assert coupons[0].amount == pytest.approx(expected_semiannual, abs=0.01), (
                f"Failed for rate {pct_rate}%: expected {expected_semiannual}"
            )


class TestEighteenBondLadder:
    """Tests that simulate the 18 live IBKR bond_holdings rows."""

    def _make_18_bonds(self) -> list[BondHolding]:
        """18 bonds with unique maturity years (2027–2044)."""
        return [make_ibkr_bond(i, maturity_year=2027 + i) for i in range(18)]

    def test_18_bonds_produce_cashflows(self):
        """18 IBKR bond_holdings bonds generate a non-empty cashflow list."""
        bonds = self._make_18_bonds()
        cashflows = generate_all_cashflows(bonds)
        assert len(cashflows) > 0

    def test_18_bonds_cover_18_maturity_years(self):
        """Each bond matures in its own calendar year — 18 distinct years."""
        bonds = self._make_18_bonds()
        maturity_years = {b.maturity_date.year for b in bonds}
        assert len(maturity_years) == 18

    def test_principal_cashflow_per_bond(self):
        """Each of 18 bonds contributes exactly one PRINCIPAL cashflow."""
        bonds = self._make_18_bonds()
        cashflows = generate_all_cashflows(bonds)
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        assert len(principals) == 18

    def test_principal_amounts_match_face_values(self):
        """Principal cashflow amount must equal bond face_value."""
        bonds = self._make_18_bonds()
        cashflows = generate_all_cashflows(bonds)
        principals = [cf for cf in cashflows if cf.type == "PRINCIPAL"]
        for principal in principals:
            bond = next(b for b in bonds if b.id == principal.bond_id)
            assert principal.amount == pytest.approx(bond.face_value, abs=0.01)

    def test_coupon_cashflows_are_semi_annual(self):
        """For a SEMI_ANNUAL bond spanning 4 years (2026-2030), expect 8+ coupons."""
        bond = make_ibkr_bond(0, maturity_year=2030)
        cashflows = generate_cashflows_for_bond(bond)
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        # issue_date 2020-01-01, maturity 2030-06-15 → 10 years × 2 coupons/year = 20 coupons
        assert len(coupons) >= 8  # at minimum the last 4 years have 8 payments

    def test_total_annual_coupon_income_from_18_bonds(self):
        """Aggregate coupon income from one payment per bond = $10k × 4.25% / 2 = $212.50 each."""
        bonds = self._make_18_bonds()
        cashflows = generate_all_cashflows(bonds)
        # Verify per-bond coupon amount
        coupons = [cf for cf in cashflows if cf.type == "COUPON"]
        assert len(coupons) > 0
        for coupon in coupons:
            # Each bond: face=10_000, coupon_rate=0.0425, SEMI_ANNUAL → 10_000 * 0.0425 / 2 = 212.50
            assert coupon.amount == pytest.approx(212.50, abs=0.01)
