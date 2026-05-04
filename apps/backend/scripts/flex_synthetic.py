"""Generate synthetic IBKR Flex XML fixtures for options income Phase 0."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path
from typing import Iterable
from xml.etree.ElementTree import Element, ElementTree, SubElement, indent

MONEY = Decimal("0.000001")
DEFAULT_OUTPUT_DIR = Path("tmp/flex")
ACCOUNT_ID = "U1234567"
CURRENCY = "USD"


def decimal_text(value: str | Decimal) -> str:
    """Return a six-decimal string suitable for persisted monetary fixtures."""
    return str(Decimal(value).quantize(MONEY))


def base_attrs(trade_id: str, transaction_id: str) -> dict[str, str]:
    """Return common Flex attributes required on every synthetic row."""
    return {
        "accountId": ACCOUNT_ID,
        "tradeID": trade_id,
        "transactionID": transaction_id,
        "currency": CURRENCY,
    }


def flex_root(statement_name: str) -> Element:
    """Create the shared Flex response/statement envelope."""
    root = Element("FlexQueryResponse", {"queryName": statement_name})
    statements = SubElement(root, "FlexStatements", {"count": "1"})
    SubElement(
        statements,
        "FlexStatement",
        {
            "accountId": ACCOUNT_ID,
            "fromDate": "2025-01-01",
            "toDate": "2025-12-31",
            "period": "YearToDate",
        },
    )
    return root


def statement(root: Element) -> Element:
    """Return the single FlexStatement element from a synthetic root."""
    flex_statements = root.find("FlexStatements")
    if flex_statements is None:
        raise ValueError("synthetic root is missing FlexStatements")
    flex_statement = flex_statements.find("FlexStatement")
    if flex_statement is None:
        raise ValueError("synthetic root is missing FlexStatement")
    return flex_statement


def option_trade(
    *,
    trade_id: str,
    transaction_id: str,
    scenario: str,
    date_time: str,
    symbol: str,
    underlying_symbol: str,
    put_call: str,
    strike: str,
    expiry: str,
    quantity: str,
    trade_price: str,
    proceeds: str,
    commission: str,
    net_cash: str,
    fifo_pnl_realized: str,
    buy_sell: str,
    open_close_indicator: str,
    notes: str = "",
) -> dict[str, str]:
    """Return one TradeConfirm-shaped option row."""
    attrs = base_attrs(trade_id, transaction_id)
    attrs.update(
        {
            "scenario": scenario,
            "assetCategory": "OPT",
            "symbol": symbol,
            "underlyingSymbol": underlying_symbol,
            "putCall": put_call,
            "strike": decimal_text(strike),
            "expiry": expiry,
            "multiplier": decimal_text("100"),
            "quantity": decimal_text(quantity),
            "tradePrice": decimal_text(trade_price),
            "price": decimal_text(trade_price),
            "proceeds": decimal_text(proceeds),
            "commission": decimal_text(commission),
            "ibCommission": decimal_text(commission),
            "netCash": decimal_text(net_cash),
            "fifoPnlRealized": decimal_text(fifo_pnl_realized),
            "buySell": buy_sell,
            "openCloseIndicator": open_close_indicator,
            "dateTime": date_time,
            "tradeDate": date_time[:10].replace("-", ""),
            "tradeTime": date_time[11:].replace(":", ""),
            "description": notes,
        }
    )
    return attrs


def cash_event(
    *,
    trade_id: str,
    transaction_id: str,
    scenario: str,
    date_time: str,
    event_type: str,
    description: str,
    amount: str,
) -> dict[str, str]:
    """Return one CashTransaction-shaped row."""
    attrs = base_attrs(trade_id, transaction_id)
    attrs.update(
        {
            "scenario": scenario,
            "dateTime": date_time,
            "date": date_time[:10].replace("-", ""),
            "type": event_type,
            "description": description,
            "amount": decimal_text(amount),
            "netCash": decimal_text(amount),
        }
    )
    return attrs


def eae_event(
    *,
    trade_id: str,
    transaction_id: str,
    scenario: str,
    date_time: str,
    symbol: str,
    underlying_symbol: str,
    put_call: str,
    strike: str,
    expiry: str,
    quantity: str,
    event_type: str,
    fifo_pnl_realized: str,
    proceeds: str,
    notes: str,
) -> dict[str, str]:
    """Return one OptionEAE-shaped exercise, assignment, or expiration row."""
    attrs = base_attrs(trade_id, transaction_id)
    attrs.update(
        {
            "scenario": scenario,
            "dateTime": date_time,
            "reportDate": date_time[:10].replace("-", ""),
            "symbol": symbol,
            "underlyingSymbol": underlying_symbol,
            "putCall": put_call,
            "strike": decimal_text(strike),
            "expiry": expiry,
            "multiplier": decimal_text("100"),
            "quantity": decimal_text(quantity),
            "type": event_type,
            "action": event_type,
            "fifoPnlRealized": decimal_text(fifo_pnl_realized),
            "proceeds": decimal_text(proceeds),
            "description": notes,
        }
    )
    return attrs


def write_xml(path: Path, root: Element) -> None:
    """Write an XML document with deterministic formatting."""
    indent(root, space="  ")
    ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def write_trades(path: Path) -> None:
    """Write synthetic TradeConfirms covering Phase 0 scenarios."""
    root = flex_root("synthetic_trades")
    section = SubElement(statement(root), "TradeConfirms")
    rows = [
        option_trade(
            trade_id="T-JONY-001",
            transaction_id="X-JONY-001",
            scenario="jony_worked_example",
            date_time="2025-01-17;093000",
            symbol="SPY   250321P00550000",
            underlying_symbol="SPY",
            put_call="P",
            strike="550",
            expiry="20250321",
            quantity="-10",
            trade_price="4.00",
            proceeds="4000",
            commission="0",
            net_cash="4000",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Open short leg of bullish put spread",
        ),
        option_trade(
            trade_id="T-JONY-002",
            transaction_id="X-JONY-002",
            scenario="jony_worked_example",
            date_time="2025-01-17;093002",
            symbol="SPY   250321P00545000",
            underlying_symbol="SPY",
            put_call="P",
            strike="545",
            expiry="20250321",
            quantity="10",
            trade_price="1.00",
            proceeds="-1000",
            commission="0",
            net_cash="-1000",
            fifo_pnl_realized="0",
            buy_sell="BUY",
            open_close_indicator="O",
            notes="Open long leg of bullish put spread",
        ),
        option_trade(
            trade_id="T-JONY-003",
            transaction_id="X-JONY-003",
            scenario="jony_worked_example",
            date_time="2025-02-14;101500",
            symbol="SPY   250321P00550000",
            underlying_symbol="SPY",
            put_call="P",
            strike="550",
            expiry="20250321",
            quantity="10",
            trade_price="5.00",
            proceeds="-5000",
            commission="0",
            net_cash="-5000",
            fifo_pnl_realized="-1000",
            buy_sell="BUY",
            open_close_indicator="C",
            notes="Roll close losing short leg",
        ),
        option_trade(
            trade_id="T-JONY-004",
            transaction_id="X-JONY-004",
            scenario="jony_worked_example",
            date_time="2025-02-14;101501",
            symbol="SPY   250418P00535000",
            underlying_symbol="SPY",
            put_call="P",
            strike="535",
            expiry="20250418",
            quantity="-10",
            trade_price="5.20",
            proceeds="5200",
            commission="0",
            net_cash="5200",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Roll open lower strike short leg for incremental credit",
        ),
        option_trade(
            trade_id="T-JONY-005",
            transaction_id="X-JONY-005",
            scenario="jony_worked_example",
            date_time="2025-03-21;154500",
            symbol="SPY   250418P00535000",
            underlying_symbol="SPY",
            put_call="P",
            strike="535",
            expiry="20250418",
            quantity="10",
            trade_price="3.20",
            proceeds="-3200",
            commission="0",
            net_cash="-3200",
            fifo_pnl_realized="2000",
            buy_sell="BUY",
            open_close_indicator="C",
            notes="Close rolled short leg",
        ),
        option_trade(
            trade_id="T-JONY-006",
            transaction_id="X-JONY-006",
            scenario="jony_worked_example",
            date_time="2025-03-21;154501",
            symbol="SPY   250321P00545000",
            underlying_symbol="SPY",
            put_call="P",
            strike="545",
            expiry="20250321",
            quantity="-10",
            trade_price="2.70",
            proceeds="2700",
            commission="0",
            net_cash="2700",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="C",
            notes="Close long leg; pair leaves final close cash flow at -500",
        ),
        option_trade(
            trade_id="T-CSP-WORTHLESS-001",
            transaction_id="X-CSP-WORTHLESS-001",
            scenario="cash_secured_put_expired_worthless",
            date_time="2025-04-01;100000",
            symbol="MSFT  250516P00390000",
            underlying_symbol="MSFT",
            put_call="P",
            strike="390",
            expiry="20250516",
            quantity="-1",
            trade_price="2.50",
            proceeds="250",
            commission="0",
            net_cash="250",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Open CSP later expiring worthless",
        ),
        option_trade(
            trade_id="T-CSP-WORTHLESS-002",
            transaction_id="X-CSP-WORTHLESS-002",
            scenario="cash_secured_put_expired_worthless",
            date_time="2025-05-16;160000",
            symbol="MSFT  250516P00390000",
            underlying_symbol="MSFT",
            put_call="P",
            strike="390",
            expiry="20250516",
            quantity="1",
            trade_price="0",
            proceeds="0",
            commission="0",
            net_cash="0",
            fifo_pnl_realized="250",
            buy_sell="BUY",
            open_close_indicator="C",
            notes="Expiration realizes the original CSP credit",
        ),
        option_trade(
            trade_id="T-CSP-ASSIGNED-001",
            transaction_id="X-CSP-ASSIGNED-001",
            scenario="cash_secured_put_assigned",
            date_time="2025-06-03;110000",
            symbol="AAPL  250620P00125000",
            underlying_symbol="AAPL",
            put_call="P",
            strike="125",
            expiry="20250620",
            quantity="-1",
            trade_price="1.80",
            proceeds="180",
            commission="0",
            net_cash="180",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Open CSP that is later assigned",
        ),
        option_trade(
            trade_id="T-CSP-ASSIGNED-002",
            transaction_id="X-CSP-ASSIGNED-002",
            scenario="cash_secured_put_assigned",
            date_time="2025-06-20;160000",
            symbol="AAPL  250620P00125000",
            underlying_symbol="AAPL",
            put_call="P",
            strike="125",
            expiry="20250620",
            quantity="1",
            trade_price="125",
            proceeds="-12500",
            commission="0",
            net_cash="-12500",
            fifo_pnl_realized="180",
            buy_sell="BUY",
            open_close_indicator="C",
            notes="Assignment cash flow represents share purchase funding",
        ),
        option_trade(
            trade_id="T-VERTICAL-001",
            transaction_id="X-VERTICAL-001",
            scenario="vertical_spread_max_profit",
            date_time="2025-07-08;103000",
            symbol="NVDA  250815P00100000",
            underlying_symbol="NVDA",
            put_call="P",
            strike="100",
            expiry="20250815",
            quantity="-1",
            trade_price="4.00",
            proceeds="400",
            commission="0",
            net_cash="400",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Open credit spread short leg",
        ),
        option_trade(
            trade_id="T-VERTICAL-002",
            transaction_id="X-VERTICAL-002",
            scenario="vertical_spread_max_profit",
            date_time="2025-07-08;103001",
            symbol="NVDA  250815P00095000",
            underlying_symbol="NVDA",
            put_call="P",
            strike="95",
            expiry="20250815",
            quantity="1",
            trade_price="1.00",
            proceeds="-100",
            commission="0",
            net_cash="-100",
            fifo_pnl_realized="0",
            buy_sell="BUY",
            open_close_indicator="O",
            notes="Open credit spread long leg",
        ),
        option_trade(
            trade_id="T-VERTICAL-003",
            transaction_id="X-VERTICAL-003",
            scenario="vertical_spread_max_profit",
            date_time="2025-08-15;160000",
            symbol="NVDA  250815P00100000",
            underlying_symbol="NVDA",
            put_call="P",
            strike="100",
            expiry="20250815",
            quantity="1",
            trade_price="0",
            proceeds="0",
            commission="0",
            net_cash="0",
            fifo_pnl_realized="300",
            buy_sell="BUY",
            open_close_indicator="C",
            notes="Spread expires at max profit",
        ),
        option_trade(
            trade_id="T-LONE-001",
            transaction_id="X-LONE-001",
            scenario="ungrouped_lone_trade",
            date_time="2025-09-10;143000",
            symbol="TSLA  251017C00300000",
            underlying_symbol="TSLA",
            put_call="C",
            strike="300",
            expiry="20251017",
            quantity="-1",
            trade_price="0.75",
            proceeds="75",
            commission="0",
            net_cash="75",
            fifo_pnl_realized="0",
            buy_sell="SELL",
            open_close_indicator="O",
            notes="Ungrouped lone covered-call candidate",
        ),
    ]
    for row in rows:
        SubElement(section, "TradeConfirm", row)
    write_xml(path, root)


def write_cash(path: Path) -> None:
    """Write synthetic CashTransactions rows."""
    root = flex_root("synthetic_cash")
    section = SubElement(statement(root), "CashTransactions")
    rows = [
        cash_event(
            trade_id="C-JONY-001",
            transaction_id="CX-JONY-001",
            scenario="jony_worked_example",
            date_time="2025-03-21;170000",
            event_type="Broker Interest Received",
            description="Non-trade cash event kept separate from option trade cash flow",
            amount="0",
        ),
        cash_event(
            trade_id="C-ASSIGN-001",
            transaction_id="CX-ASSIGN-001",
            scenario="cash_secured_put_assigned",
            date_time="2025-06-23;090000",
            event_type="Option Assignment",
            description="Assignment funding: 100 AAPL shares purchased at 125.00",
            amount="-12500",
        ),
    ]
    for row in rows:
        SubElement(section, "CashTransaction", row)
    write_xml(path, root)


def write_positions(path: Path) -> None:
    """Write synthetic OpenPositions rows."""
    root = flex_root("synthetic_positions")
    section = SubElement(statement(root), "OpenPositions")
    row = base_attrs("P-LONE-001", "PX-LONE-001")
    row.update(
        {
            "scenario": "ungrouped_lone_trade",
            "symbol": "TSLA  251017C00300000",
            "underlyingSymbol": "TSLA",
            "putCall": "C",
            "strike": decimal_text("300"),
            "expiry": "20251017",
            "multiplier": decimal_text("100"),
            "position": decimal_text("-1"),
            "quantity": decimal_text("-1"),
            "costBasis": decimal_text("-75"),
            "costPrice": decimal_text("0.75"),
            "markPrice": decimal_text("0.80"),
            "fifoPnlUnrealized": decimal_text("-5"),
        }
    )
    SubElement(section, "OpenPosition", row)
    write_xml(path, root)


def write_option_eae(path: Path) -> None:
    """Write synthetic OptionEAE lifecycle events."""
    root = flex_root("synthetic_option_eae")
    section = SubElement(statement(root), "OptionEAE")
    rows = [
        eae_event(
            trade_id="E-CSP-WORTHLESS-001",
            transaction_id="EX-CSP-WORTHLESS-001",
            scenario="cash_secured_put_expired_worthless",
            date_time="2025-05-16;160000",
            symbol="MSFT  250516P00390000",
            underlying_symbol="MSFT",
            put_call="P",
            strike="390",
            expiry="20250516",
            quantity="1",
            event_type="Expiration",
            fifo_pnl_realized="250",
            proceeds="0",
            notes="Short put expired worthless; realized P&L equals opening credit",
        ),
        eae_event(
            trade_id="E-CSP-ASSIGNED-001",
            transaction_id="EX-CSP-ASSIGNED-001",
            scenario="cash_secured_put_assigned",
            date_time="2025-06-20;160000",
            symbol="AAPL  250620P00125000",
            underlying_symbol="AAPL",
            put_call="P",
            strike="125",
            expiry="20250620",
            quantity="1",
            event_type="Assignment",
            fifo_pnl_realized="180",
            proceeds="-12500",
            notes="Assignment creates stock-purchase cash flow; Phase 1 must tag specially",
        ),
        eae_event(
            trade_id="E-VERTICAL-001",
            transaction_id="EX-VERTICAL-001",
            scenario="vertical_spread_max_profit",
            date_time="2025-08-15;160000",
            symbol="NVDA  250815P00100000",
            underlying_symbol="NVDA",
            put_call="P",
            strike="100",
            expiry="20250815",
            quantity="1",
            event_type="Expiration",
            fifo_pnl_realized="300",
            proceeds="0",
            notes="Vertical credit spread expires at max profit",
        ),
    ]
    for row in rows:
        SubElement(section, "OptionEAE", row)
    write_xml(path, root)


def write_account_info(path: Path) -> None:
    """Write synthetic AccountInformation rows."""
    root = flex_root("synthetic_account_info")
    section = SubElement(statement(root), "AccountInformation")
    row = base_attrs("A-INFO-001", "AX-INFO-001")
    row.update(
        {
            "scenario": "account_snapshot",
            "accountType": "INDIVIDUAL",
            "baseCurrency": CURRENCY,
            "currency": CURRENCY,
            "dateTime": "2025-09-10;170000",
            "marginRequirement": decimal_text("15000"),
            "maintenanceMarginRequirement": decimal_text("15000"),
            "buyingPower": decimal_text("85000"),
            "availableFunds": decimal_text("85000"),
            "netLiquidation": decimal_text("100000"),
        }
    )
    SubElement(section, "AccountInformation", row)
    write_xml(path, root)


def write_synthetic_files(output_dir: Path = DEFAULT_OUTPUT_DIR) -> list[Path]:
    """Write all synthetic Flex fixtures and return their paths."""
    output_dir.mkdir(parents=True, exist_ok=True)
    writers = {
        "synthetic_trades.xml": write_trades,
        "synthetic_cash.xml": write_cash,
        "synthetic_positions.xml": write_positions,
        "synthetic_option_eae.xml": write_option_eae,
        "synthetic_account_info.xml": write_account_info,
    }
    paths: list[Path] = []
    for filename, writer in writers.items():
        path = output_dir / filename
        writer(path)
        paths.append(path)
    return paths


def main(argv: Iterable[str] | None = None) -> int:
    """Generate synthetic fixtures under tmp/flex by default."""
    args = list(argv or [])
    output_dir = Path(args[0]) if args else DEFAULT_OUTPUT_DIR
    paths = write_synthetic_files(output_dir)
    print(
        f"Wrote {len(paths)} synthetic Flex XML files to {output_dir}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
