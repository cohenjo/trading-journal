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
