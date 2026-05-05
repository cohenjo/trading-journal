"""Tests for typed IBKR Flex options parser."""

from __future__ import annotations

import shutil
import textwrap
from decimal import Decimal
from pathlib import Path

from app.services.options.flex_parser import parse_flex_files, parse_open_position, parse_trade_confirm
from scripts.flex_synthetic import write_synthetic_files


def test_parse_synthetic_flex_rows_into_typed_models() -> None:
    """Synthetic Phase 0 fixtures decode key financial fields as Decimals."""

    output_dir = Path("tmp/test-options-flex-parser")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    try:
        paths = write_synthetic_files(output_dir)
        parsed = parse_flex_files(paths)
        assert len(parsed.trades) == 18
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


def test_parse_live_flex_trade_and_open_position_aliases() -> None:
    """Live Activity Flex rows use Trade tags and cost-basis aliases."""

    trade = parse_trade_confirm(
        {
            "accountId": "U1234567",
            "assetCategory": "OPT",
            "conid": "123456789",
            "currency": "USD",
            "dateTime": "20260504;153000",
            "expiry": "20260619",
            "fifoPnlRealized": "12.34",
            "ibCommission": "-1.05",
            "ibExecID": "exec-1",
            "multiplier": "100",
            "netCash": "198.95",
            "proceeds": "200.00",
            "putCall": "P",
            "quantity": "-1",
            "strike": "450",
            "symbol": "SPY",
            "tradeID": "trade-1",
            "tradePrice": "2.00",
            "underlyingSymbol": "SPY",
        }
    )
    position = parse_open_position(
        {
            "accountId": "U1234567",
            "assetCategory": "OPT",
            "conid": "123456789",
            "costBasisMoney": "-198.95",
            "costBasisPrice": "1.9895",
            "currency": "USD",
            "expiry": "20260619",
            "multiplier": "100",
            "openDateTime": "20260504;153000",
            "position": "-1",
            "putCall": "P",
            "strike": "450",
            "symbol": "SPY",
            "underlyingSymbol": "SPY",
        }
    )

    assert trade.source_trade_id == "trade-1"
    assert trade.side == "sell"
    assert trade.leg.expiry.isoformat() == "2026-06-19"
    assert position.average_open_price == Decimal("1.9895")
    assert position.open_cash_flow == Decimal("-198.95")


def test_assignment_synthetic_cash_events_cover_all_sign_cases() -> None:
    """Assigned/exercised stock legs create correctly signed synthetic cash flow."""

    output_dir = Path("tmp/test-options-assignment-synthetic")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "assignments.xml"
    path.write_text(
        _flex_xml(
            [
                _assignment_rows(
                    "short-put",
                    transaction="Assignment",
                    right="P",
                    opt_qty="10",
                    stk_qty="1000",
                    strike="112",
                    close="83",
                    mtm="-29000",
                ),
                _assignment_rows(
                    "short-call",
                    transaction="Assignment",
                    right="C",
                    opt_qty="-10",
                    stk_qty="-1000",
                    strike="80",
                    close="110",
                    mtm="-30000",
                ),
                _assignment_rows(
                    "long-call",
                    transaction="Exercise",
                    right="C",
                    opt_qty="10",
                    stk_qty="1000",
                    strike="80",
                    close="110",
                    mtm="30000",
                ),
                _assignment_rows(
                    "long-put",
                    transaction="Exercise",
                    right="P",
                    opt_qty="-10",
                    stk_qty="-1000",
                    strike="112",
                    close="83",
                    mtm="29000",
                ),
            ]
        )
    )

    parsed = parse_flex_files([path])
    synthetics = [cash for cash in parsed.cash_transactions if cash.event_category == "assignment_synthetic"]

    assert [cash.amount for cash in synthetics] == [
        Decimal("-29000"),
        Decimal("-30000"),
        Decimal("30000"),
        Decimal("29000"),
    ]
    assert parsed.section_counts["assignment_synthetic_emitted"] == 4
    assert synthetics[0].source_transaction_id == "assign_synth:short-put-stk"
    assert synthetics[0].raw_payload["option_trade_id"] == "short-put-opt"


def test_assignment_synthetic_computes_amount_without_mtm_pnl() -> None:
    """When mtmPnl is absent, use signed stock quantity × (market − strike)."""

    output_dir = Path("tmp/test-options-assignment-computed")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "computed.xml"
    path.write_text(
        _flex_xml(
            [
                _assignment_rows(
                    "computed",
                    transaction="Assignment",
                    right="P",
                    opt_qty="1",
                    stk_qty="100",
                    strike="112",
                    close="83",
                )
            ]
        )
    )

    parsed = parse_flex_files([path])
    synthetic = next(cash for cash in parsed.cash_transactions if cash.event_category == "assignment_synthetic")

    assert synthetic.amount == Decimal("-2900")
    assert synthetic.raw_payload["formula"] == "computed"


def test_cash_settled_option_without_stock_leg_emits_no_assignment_synthetic() -> None:
    """Cash-settled products without a stock leg keep existing cash flow only."""

    output_dir = Path("tmp/test-options-cash-settled")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "cash-settled.xml"
    rows = _assignment_rows(
        "spx", transaction="Exercise", right="P", opt_qty="1", stk_qty="100", strike="5000", close="4990"
    )
    path.write_text(_flex_xml([rows[: rows.index('<Trade accountId="U1234567" assetCategory="STK"')]]))

    parsed = parse_flex_files([path])

    assert [cash for cash in parsed.cash_transactions if cash.event_category == "assignment_synthetic"] == []
    assert parsed.section_counts["assignment_synthetic_emitted"] == 0


def test_ambiguous_assignment_stock_match_skips_and_logs(caplog) -> None:  # type: ignore[no-untyped-def]
    """If two stock rows match one EAE row, the parser skips rather than guessing."""

    output_dir = Path("tmp/test-options-assignment-ambiguous")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "ambiguous.xml"
    rows = _assignment_rows(
        "ambiguous",
        transaction="Assignment",
        right="P",
        opt_qty="1",
        stk_qty="100",
        strike="112",
        close="83",
        mtm="-2900",
    )
    duplicate = rows.replace('tradeID="ambiguous-stk"', 'tradeID="ambiguous-stk-2"')
    duplicate = duplicate[duplicate.index('<Trade accountId="U1234567" assetCategory="STK"') :]
    path.write_text(_flex_xml([rows + duplicate]))

    with caplog.at_level("WARNING", logger="app.services.options.flex_parser"):
        parsed = parse_flex_files([path])

    assert [cash for cash in parsed.cash_transactions if cash.event_category == "assignment_synthetic"] == []
    assert parsed.section_counts["assignment_synthetic_skipped_ambiguous"] == 1
    assert "ambiguous assignment synthetic" in caplog.text


def _flex_xml(row_groups: list[str]) -> str:
    return (
        '<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1234567" '
        'fromDate="20260101" toDate="20260131"><Trades>'
        + "".join(row_groups)
        + "</Trades><OptionEAE>"
        + "".join(_eae_row(group) for group in row_groups)
        + "</OptionEAE></FlexStatement></FlexStatements></FlexQueryResponse>"
    )


def _assignment_rows(
    prefix: str,
    *,
    transaction: str,
    right: str,
    opt_qty: str,
    stk_qty: str,
    strike: str,
    close: str,
    mtm: str | None = None,
) -> str:
    mtm_attr = f' mtmPnl="{mtm}"' if mtm is not None else ""
    return f'''
<Trade accountId="U1234567" assetCategory="OPT" currency="USD" symbol="{prefix} OPT" underlyingSymbol="{prefix.upper()}" tradeID="{prefix}-opt" multiplier="100" strike="{strike}" expiry="2026-01-17" dateTime="2026-01-17;120000" putCall="{right}" quantity="{opt_qty}" tradePrice="0" proceeds="0" netCash="0" fifoPnlRealized="0" />
<Trade accountId="U1234567" assetCategory="STK" currency="USD" symbol="{prefix.upper()}" underlyingSymbol="{prefix.upper()}" tradeID="{prefix}-stk" multiplier="1" dateTime="2026-01-17;120000" quantity="{stk_qty}" tradePrice="{strike}" closePrice="{close}" proceeds="0" netCash="0"{mtm_attr} />
<!--EAE {prefix}-opt {transaction}-->
'''


def _eae_row(group: str) -> str:
    marker = "<!--EAE "
    if marker not in group:
        return ""
    start = group.index(marker) + len(marker)
    end = group.index("-->", start)
    trade_id, transaction = group[start:end].strip().split()
    symbol = trade_id.removesuffix("-opt").upper()
    return (
        f'<OptionEAE accountId="U1234567" currency="USD" symbol="{symbol} OPT" '
        f'underlyingSymbol="{symbol}" transactionType="{transaction}" tradeID="{trade_id}" />'
    )


def test_live_nflx_assignment_fixture_emits_expected_synthetic_amount() -> None:
    """Cached live Flex XML emits the verified NFLX assignment adjustment."""

    parsed = parse_flex_files([Path("tmp/flex/trades_20260504T160341Z.xml")], account_id="U2515365")
    nflx = [
        cash
        for cash in parsed.cash_transactions
        if cash.event_category == "assignment_synthetic" and cash.raw_payload.get("stk_trade_id") == "8869640568"
    ]

    assert len(nflx) == 1
    assert nflx[0].amount == Decimal("-28460")
    assert nflx[0].raw_payload["eae_trade_id"] == "8869640563"
    assert nflx[0].raw_payload["option_trade_id"] == "8869640563"


# ---------------------------------------------------------------------------
# Phase 0 validator — Issue #245
# Asserts that all options-income-critical OPT fields are correctly extracted
# from a single assignment XML stub (synthesised from IBKR Flex docs).
# ---------------------------------------------------------------------------

_ASSIGNMENT_STUB = textwrap.dedent("""\
    <FlexQueryResponse queryName="Trades" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U9999999"
                       fromDate="2026-01-17" toDate="2026-01-17">
          <TradeConfirms>
            <TradeConfirm
              accountId="U9999999"
              assetCategory="OPT"
              currency="USD"
              symbol="SPY  260117P00450000"
              underlyingSymbol="SPY"
              conid="123456789"
              underlyingConid="756733"
              putCall="P"
              strike="450"
              expiry="2026-01-17"
              multiplier="100"
              tradeID="T-PHASE0-OPT"
              transactionID="TX-PHASE0-OPT"
              ibExecID="exec-phase0"
              dateTime="2026-01-17;090000"
              tradeDate="2026-01-17"
              buySell="BUY"
              openCloseIndicator="C"
              notes="A;C"
              quantity="1"
              tradePrice="0"
              proceeds="0"
              ibCommission="0"
              taxes="0"
              netCash="0"
              fifoPnlRealized="400"
              levelOfDetail="EXECUTION"
            />
            <TradeConfirm
              accountId="U9999999"
              assetCategory="STK"
              currency="USD"
              symbol="SPY"
              underlyingSymbol="SPY"
              conid="756733"
              tradeID="T-PHASE0-STK"
              transactionID="TX-PHASE0-STK"
              dateTime="2026-01-17;090000"
              tradeDate="2026-01-17"
              buySell="BUY"
              openCloseIndicator="O"
              notes="A"
              quantity="100"
              tradePrice="450"
              closePrice="442"
              proceeds="-45000"
              ibCommission="0"
              netCash="-45000"
              fifoPnlRealized="0"
              mtmPnl="-800"
              levelOfDetail="EXECUTION"
            />
          </TradeConfirms>
          <OptionEAE>
            <OptionEAE
              accountId="U9999999"
              currency="USD"
              symbol="SPY  260117P00450000"
              underlyingSymbol="SPY"
              conid="123456789"
              assetCategory="OPT"
              putCall="P"
              strike="450"
              expiry="2026-01-17"
              multiplier="100"
              transactionType="Assignment"
              tradeID="T-PHASE0-OPT"
              transactionID="TX-PHASE0-OPT"
              quantity="1"
              tradePrice="0"
              proceeds="0"
              netCash="0"
              fifoPnlRealized="400"
              reportDate="2026-01-17"
              dateTime="2026-01-17;090000"
            />
          </OptionEAE>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>
""")


def test_phase0_opt_fields_extracted_from_assignment_stub(tmp_path: Path) -> None:
    """Phase 0 validator: all options-income-critical fields parse correctly.

    Covers: assetCategory OPT filter, underlyingSymbol, strike, expiry, putCall,
    multiplier, fifoPnlRealized, notes in raw_payload, OptionEAE transactionType,
    and synthetic assignment cash event from mtmPnl.

    See apps/backend/docs/ibkr-flex-options-mapping.md for full field mapping.
    """
    stub = tmp_path / "phase0_assignment.xml"
    stub.write_text(_ASSIGNMENT_STUB)
    result = parse_flex_files([stub], account_id="U9999999")

    # --- OPT trade row ---
    assert len(result.trades) == 1, "Expected exactly one OPT trade row"
    trade = result.trades[0]
    assert trade.account_id == "U9999999"
    assert trade.leg.underlying_symbol == "SPY"
    assert trade.leg.option_symbol == "SPY  260117P00450000"
    assert trade.leg.right == "put"
    assert trade.leg.strike == Decimal("450")
    assert trade.leg.expiry.isoformat() == "2026-01-17"
    assert trade.leg.multiplier == Decimal("100")
    assert trade.leg.source_conid == 123456789
    assert trade.source_trade_id == "T-PHASE0-OPT"
    assert trade.source_exec_id == "exec-phase0"
    assert trade.side == "buy"
    assert trade.event_type == "close"
    assert trade.realized_pnl == Decimal("400")
    assert trade.currency == "USD"
    # notes preserved in raw_payload even though not yet a typed field (Gap #2)
    assert trade.raw_payload.get("notes") == "A;C", "notes attribute must be preserved in raw_payload"

    # --- OptionEAE lifecycle row ---
    assert len(result.option_eae) == 1, "Expected exactly one OptionEAE row"
    eae = result.option_eae[0]
    assert eae.event_type == "assign"
    assert eae.source_trade_id == "T-PHASE0-OPT"

    # --- Synthetic assignment cash event from STK mtmPnl ---
    synthetics = [c for c in result.cash_transactions if c.event_category == "assignment_synthetic"]
    assert len(synthetics) == 1, "Expected one synthetic assignment cash event"
    synth = synthetics[0]
    assert synth.amount == Decimal("-800")
    assert synth.raw_payload["underlying"] == "SPY"
    assert synth.raw_payload["strike"] == "450"
    assert result.section_counts["assignment_synthetic_emitted"] == 1
