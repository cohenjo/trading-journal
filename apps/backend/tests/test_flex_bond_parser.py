"""Tests for BOND OpenPosition parsing and dividend routing in the Flex parser.

Covers:
- parse_bond_symbol() coupon/maturity extraction (including mixed fractions, two-digit years)
- parse_bond_open_position() model construction
- FlexDividendPayment routing from CashTransaction rows
- FlexParseResult has the new bond/dividend/accrual/security collections
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.options.flex_parser import (
    DIVIDEND_CASH_TYPES,
    FlexBondPosition,
    FlexDividendAccrual,
    FlexDividendPayment,
    FlexParseResult,
    FlexSecurityInfo,
    parse_bond_open_position,
    parse_bond_symbol,
    parse_flex_files,
)


# ---------------------------------------------------------------------------
# parse_bond_symbol — unit tests
# ---------------------------------------------------------------------------


class TestParseBondSymbol:
    def test_mixed_fraction_coupon(self) -> None:
        """AAPL 4 1/4 02/09/47 → 4.25, 2047-02-09"""
        rate, maturity = parse_bond_symbol("AAPL 4 1/4 02/09/47")
        assert rate == Decimal("4.25")
        assert maturity == date(2047, 2, 9)

    def test_integer_coupon(self) -> None:
        """T 5 02/15/34 → 5, 2034-02-15"""
        rate, maturity = parse_bond_symbol("T 5 02/15/34")
        assert rate == Decimal("5")
        assert maturity == date(2034, 2, 15)

    def test_decimal_coupon(self) -> None:
        """AMZN 4.05 08/22/47 → 4.05, 2047-08-22"""
        rate, maturity = parse_bond_symbol("AMZN 4.05 08/22/47")
        assert rate == Decimal("4.05")
        assert maturity == date(2047, 8, 22)

    def test_four_digit_year(self) -> None:
        """Symbol with explicit 4-digit year is parsed correctly."""
        rate, maturity = parse_bond_symbol("MSFT 3 3/8 05/15/2027")
        assert rate == Decimal("3.375")
        assert maturity == date(2027, 5, 15)

    def test_cusip_suffix_after_date_is_ignored(self) -> None:
        """CUSIP-like suffix after the date should not affect parsing."""
        # e.g. "AAPL 4 1/4 02/09/47 5BJ4" — the suffix is after the date
        rate, maturity = parse_bond_symbol("AAPL 4 1/4 02/09/47 5BJ4")
        assert rate == Decimal("4.25")
        assert maturity == date(2047, 2, 9)

    def test_no_date_returns_none(self) -> None:
        """Symbols without a date return (None, None)."""
        rate, maturity = parse_bond_symbol("AAPL BOND")
        assert rate is None
        assert maturity is None

    def test_fraction_only_coupon(self) -> None:
        """A coupon like '3/4' with no integer part is still parsed."""
        rate, maturity = parse_bond_symbol("T 3/4 01/15/30")
        assert rate == Decimal("0.75")
        assert maturity == date(2030, 1, 15)

    def test_empty_string_returns_none(self) -> None:
        rate, maturity = parse_bond_symbol("")
        assert rate is None
        assert maturity is None


# ---------------------------------------------------------------------------
# parse_bond_open_position — integration
# ---------------------------------------------------------------------------


class TestParseBondOpenPosition:
    _BASE_ATTRS: dict[str, str] = {
        "accountId": "U1234567",
        "assetCategory": "BOND",
        "symbol": "AAPL 4 1/4 02/09/47",
        "description": "AAPL 4.25% 02/09/2047 CORP",
        "conid": "123456789",
        "position": "50000",
        "currency": "USD",
        "markPrice": "98.5",
        "positionValue": "49250.00",
        "costBasisPrice": "99.0",
        "fifoPnlUnrealized": "-250.0",
        "reportDate": "2025-01-10",
        "cusip": "037833FJ5",
        "isin": "US037833FJ53",
        "figi": "BBG123456789",
        "listingExchange": "NYSE",
        "subCategory": "Corp",
    }

    def test_basic_fields(self) -> None:
        pos = parse_bond_open_position(self._BASE_ATTRS, date(2025, 1, 10))
        assert pos is not None
        assert pos.account_id == "U1234567"
        assert pos.symbol == "AAPL 4 1/4 02/09/47"
        assert pos.con_id == 123456789
        assert pos.quantity == Decimal("50000")
        assert pos.currency == "USD"
        assert pos.as_of_date == date(2025, 1, 10)

    def test_coupon_and_maturity_parsed(self) -> None:
        pos = parse_bond_open_position(self._BASE_ATTRS, date(2025, 1, 10))
        assert pos is not None
        assert pos.coupon_rate == Decimal("4.25")
        assert pos.maturity_date == date(2047, 2, 9)

    def test_identifiers_populated(self) -> None:
        pos = parse_bond_open_position(self._BASE_ATTRS, date(2025, 1, 10))
        assert pos is not None
        assert pos.cusip == "037833FJ5"
        assert pos.isin == "US037833FJ53"
        assert pos.figi == "BBG123456789"
        assert pos.listing_exchange == "NYSE"

    def test_no_symbol_returns_none(self) -> None:
        attrs = {k: v for k, v in self._BASE_ATTRS.items() if k != "symbol" and k != "description"}
        pos = parse_bond_open_position(attrs, date(2025, 1, 10))
        assert pos is None

    def test_no_position_returns_none(self) -> None:
        attrs = {k: v for k, v in self._BASE_ATTRS.items() if k != "position"}
        pos = parse_bond_open_position(attrs, date(2025, 1, 10))
        assert pos is None

    def test_fallback_date_used_when_no_report_date(self) -> None:
        attrs = {k: v for k, v in self._BASE_ATTRS.items() if k != "reportDate"}
        pos = parse_bond_open_position(attrs, date(2025, 3, 15))
        assert pos is not None
        assert pos.as_of_date == date(2025, 3, 15)


# ---------------------------------------------------------------------------
# DIVIDEND_CASH_TYPES constant
# ---------------------------------------------------------------------------


class TestDividendCashTypes:
    def test_contains_expected_types(self) -> None:
        assert "Dividends" in DIVIDEND_CASH_TYPES
        assert "Withholding Tax" in DIVIDEND_CASH_TYPES
        assert "Payment In Lieu Of Dividends" in DIVIDEND_CASH_TYPES

    def test_excludes_option_events(self) -> None:
        assert "Broker Interest Received" not in DIVIDEND_CASH_TYPES
        assert "Other Fees" not in DIVIDEND_CASH_TYPES


# ---------------------------------------------------------------------------
# FlexParseResult — new collection fields
# ---------------------------------------------------------------------------


class TestFlexParseResultNewFields:
    def test_default_construction_has_empty_collections(self) -> None:
        result = FlexParseResult()
        assert result.bond_positions == []
        assert result.dividend_payments == []
        assert result.dividend_accruals == []
        assert result.security_infos == []

    def test_bond_positions_field_accepts_list(self) -> None:
        pos = FlexBondPosition(
            account_id="U1234567",
            as_of_date=date(2025, 1, 10),
            symbol="AAPL 4 1/4 02/09/47",
            quantity=Decimal("50000"),
            last_broker_sync_at=datetime(2025, 1, 10, tzinfo=timezone.utc),
        )
        result = FlexParseResult(bond_positions=[pos])
        assert len(result.bond_positions) == 1
        assert result.bond_positions[0].symbol == "AAPL 4 1/4 02/09/47"

    def test_dividend_payment_field_accepts_list(self) -> None:
        pmt = FlexDividendPayment(
            account_id="U1234567",
            source_transaction_id="TX123",
            amount=Decimal("42.50"),
            type="Dividends",
        )
        result = FlexParseResult(dividend_payments=[pmt])
        assert len(result.dividend_payments) == 1

    def test_dividend_accrual_field_accepts_list(self) -> None:
        accrual = FlexDividendAccrual(
            account_id="U1234567",
            source_section="change",
        )
        result = FlexParseResult(dividend_accruals=[accrual])
        assert len(result.dividend_accruals) == 1

    def test_security_info_field_accepts_list(self) -> None:
        info = FlexSecurityInfo(
            account_id="U1234567",
            con_id=987654321,
            symbol="AAPL",
        )
        result = FlexParseResult(security_infos=[info])
        assert len(result.security_infos) == 1


# ---------------------------------------------------------------------------
# parse_flex_files — XML round-trip via synthetic fixture
# ---------------------------------------------------------------------------


class TestParseFlexFilesBondRouting:
    def test_synthetic_fixture_parses_without_error(self) -> None:
        """Smoke test: parsing the master activity XML should not raise."""
        master_xml = Path("reports/activity/OptionsIncomeDashboard_Master.xml")
        if not master_xml.exists():
            pytest.skip("Master XML fixture not present")
        result = parse_flex_files([master_xml])
        # BOND rows should land in bond_positions, not stock_positions
        for pos in result.stock_positions:
            assert pos.symbol.upper() not in {"BOND", ""}
        # All bond positions should have a symbol
        for bp in result.bond_positions:
            assert bp.symbol

    def test_bond_rows_routed_to_bond_positions(self) -> None:
        """BOND assetCategory rows must land in FlexParseResult.bond_positions."""
        master_xml = Path("reports/activity/OptionsIncomeDashboard_Master.xml")
        if not master_xml.exists():
            pytest.skip("Master XML fixture not present")
        result = parse_flex_files([master_xml])
        assert len(result.bond_positions) > 0, "Expected at least one BOND OpenPosition"

    def test_dividend_cash_transactions_routed_to_dividend_payments(self) -> None:
        """CashTransaction rows with dividend types go to dividend_payments, not cash_transactions."""
        master_xml = Path("reports/activity/OptionsIncomeDashboard_Master.xml")
        if not master_xml.exists():
            pytest.skip("Master XML fixture not present")
        result = parse_flex_files([master_xml])
        for pmt in result.dividend_payments:
            assert pmt.type in DIVIDEND_CASH_TYPES
        # Confirm no dividend-typed rows leak into cash_transactions
        for ct in result.cash_transactions:
            assert ct.event_category not in {"dividend", "pil_dividend", "tax_withholding"}, (
                f"CashTransaction with dividend category found in cash_transactions: {ct}"
            )

    def test_dividend_accruals_populated(self) -> None:
        """ChangeInDividendAccrual rows should populate dividend_accruals."""
        master_xml = Path("reports/activity/OptionsIncomeDashboard_Master.xml")
        if not master_xml.exists():
            pytest.skip("Master XML fixture not present")
        result = parse_flex_files([master_xml])
        assert len(result.dividend_accruals) > 0, "Expected at least one dividend accrual row"


# ---------------------------------------------------------------------------
# Bug-2 regression guards — bond data quality (2026-05-10)
# ---------------------------------------------------------------------------


class TestBondCouponRateStorageConvention:
    """Verify coupon_rate storage convention: percentage units (e.g. 4.25), not
    decimal fraction (e.g. 0.0425).  Fenster's display layer must NOT multiply
    by 100 to convert — the value is already in display-ready percentage form.

    Ground truth (McManus v2 revalidation): all 18 live bond_holdings rows have
    coupon_rate in the range 2.0–7.0.  A value like 0.04 would indicate a
    parsing bug where the decimal fraction was stored instead.
    """

    def test_parse_bond_open_position_coupon_rate_is_percentage_units(self) -> None:
        """coupon_rate=4.25 for '4 1/4' bond — percentage units, not 0.0425."""
        attrs = {
            "accountId": "U2515365",
            "assetCategory": "BOND",
            "symbol": "AAPL 4 1/4 02/09/47",
            "conid": "264824302",
            "position": "7000",
            "currency": "USD",
            "markPrice": "96.284",
            "positionValue": "6739.88",
            "cusip": "037833CH1",
            "isin": "US037833CH12",
            "reportDate": "2026-05-08",
        }
        pos = parse_bond_open_position(attrs, date(2026, 5, 8))
        assert pos is not None
        assert pos.coupon_rate == Decimal("4.25"), (
            "coupon_rate must be stored as percentage units (4.25), not "
            "decimal fraction (0.0425). Fenster must NOT multiply by 100. Bug-2."
        )
        assert 0 < pos.coupon_rate < 20, (
            "coupon_rate out of the expected 0–20 percentage range. "
            "Possible regression: stored as basis points or raw fraction."
        )

    def test_all_live_bond_coupon_rates_in_valid_range(self) -> None:
        """Coupon rates from all 18 live bond symbols must be in 0–20 pct range."""
        live_bonds = [
            ("AAPL 4 1/4 02/09/47", Decimal("4.25")),
            ("AMZN 4.05 08/22/47 5BJ4", Decimal("4.05")),
            ("AMZN 5.65 03/13/46", Decimal("5.65")),
            ("BA 3 1/2 03/01/45", Decimal("3.5")),
            ("BCRED 6 01/29/32", Decimal("6.0")),
            ("META 5 1/2 11/15/45", Decimal("5.5")),
            ("NFLX 5.4 08/15/54", Decimal("5.4")),
            ("T 3 7/8 08/15/33", Decimal("3.875")),
            ("T 4 02/15/34", Decimal("4.0")),
            ("T 2 1/2 02/15/45", Decimal("2.5")),
            ("T 2 1/2 05/15/46", Decimal("2.5")),
            ("T 2 3/4 08/15/47", Decimal("2.75")),
            ("T 3 05/15/45", Decimal("3.0")),
            ("T 3 1/8 08/15/44", Decimal("3.125")),
            ("T 3 11/15/44", Decimal("3.0")),
        ]

        for symbol, expected_rate in live_bonds:
            attrs = {
                "accountId": "U2515365",
                "assetCategory": "BOND",
                "symbol": symbol,
                "conid": "99999",
                "position": "1000",
                "currency": "USD",
                "markPrice": "98",
                "positionValue": "980",
            }
            pos = parse_bond_open_position(attrs, date(2026, 5, 8))
            assert pos is not None, f"parse_bond_open_position returned None for {symbol!r}"
            assert pos.coupon_rate == expected_rate, (
                f"{symbol}: expected coupon_rate={expected_rate} got {pos.coupon_rate}"
            )
            assert 0 < pos.coupon_rate < 20, f"{symbol}: coupon_rate={pos.coupon_rate} outside valid 0–20 pct range"


class TestFlexSecurityInfoIssueDate:
    """Verify FlexSecurityInfo parses issueDate from FII rows (Bug-2 §3)."""

    def test_parse_security_info_includes_issue_date(self) -> None:
        """parse_security_info() extracts issueDate attribute into issue_date."""
        from app.services.options.flex_parser import parse_security_info

        attrs = {
            "conid": "264824302",
            "symbol": "AAPL 4 1/4 02/09/47",
            "description": "AAPL 4.25% 02/09/2047 CORP",
            "assetCategory": "BOND",
            "currency": "USD",
            "listingExchange": "NYSE",
            "cusip": "037833CH1",
            "isin": "US037833CH12",
            "maturity": "2047-02-09",
            "issueDate": "2017-02-06",
        }
        info = parse_security_info(attrs)
        assert info is not None
        assert info.issue_date == date(2017, 2, 6), (
            "issue_date must be parsed from issueDate FII attribute. "
            "Needed for Bug-2 §3 FII backfill once portal enables the section."
        )
        assert info.maturity == date(2047, 2, 9)

    def test_parse_security_info_missing_issue_date_is_none(self) -> None:
        """issueDate absent from OpenPositions source — must default to None."""
        from app.services.options.flex_parser import parse_security_info

        attrs = {
            "conid": "264824302",
            "symbol": "AAPL 4 1/4 02/09/47",
            "assetCategory": "BOND",
            "currency": "USD",
        }
        info = parse_security_info(attrs)
        assert info is not None
        assert info.issue_date is None
