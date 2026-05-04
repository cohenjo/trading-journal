"""Typed IBKR Flex XML parsers for options-income ingestion."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree
from xml.etree.ElementTree import Element, ParseError

from pydantic import BaseModel, ConfigDict, Field

SECTION_ROW_NAMES = {
    "TradeConfirms": "TradeConfirm",
    "CashTransactions": "CashTransaction",
    "OpenPositions": "OpenPosition",
    "OptionEAE": "OptionEAE",
    "AccountInformation": "AccountInformation",
}
MONEY_ZERO = Decimal("0")


class FlexParserError(RuntimeError):
    """Raised when Flex XML cannot be normalized into typed option rows."""


class OptionLegKey(BaseModel):
    """Natural key for one option contract in an account."""

    model_config = ConfigDict(frozen=True)

    account_id: str
    underlying_symbol: str
    option_symbol: str | None = None
    expiry: date
    strike: Decimal
    right: str
    multiplier: Decimal = Decimal("100")
    currency: str = "USD"
    source_conid: int | None = None


class FlexTradeConfirm(BaseModel):
    """Normalized TradeConfirms/OptionEAE execution or lifecycle row."""

    model_config = ConfigDict(frozen=True)

    account_id: str
    leg: OptionLegKey
    source_trade_id: str
    source_transaction_id: str | None = None
    source_exec_id: str | None = None
    event_type: str
    side: str
    trade_time: datetime
    trade_date: date
    quantity: Decimal
    price: Decimal
    gross_amount: Decimal
    commission: Decimal = MONEY_ZERO
    fees: Decimal = MONEY_ZERO
    net_cash_flow: Decimal = MONEY_ZERO
    realized_pnl: Decimal = MONEY_ZERO
    currency: str = "USD"
    raw_payload: dict[str, str] = Field(default_factory=dict)


class FlexCashTransaction(BaseModel):
    """Normalized option-relevant cash transaction row."""

    model_config = ConfigDict(frozen=True)

    account_id: str
    source_transaction_id: str
    event_date: date
    event_time: datetime | None = None
    event_category: str
    description: str | None = None
    amount: Decimal
    currency: str = "USD"
    raw_payload: dict[str, str] = Field(default_factory=dict)


class FlexOpenPosition(BaseModel):
    """Normalized open option position snapshot row."""

    model_config = ConfigDict(frozen=True)

    account_id: str
    leg: OptionLegKey
    as_of_date: date
    opened_at: datetime
    quantity_open: Decimal
    average_open_price: Decimal
    open_cash_flow: Decimal
    ib_margin_requirement: Decimal | None = None
    last_broker_sync_at: datetime
    raw_payload: dict[str, str] = Field(default_factory=dict)


class FlexAccountInformation(BaseModel):
    """Normalized Flex account snapshot metadata."""

    model_config = ConfigDict(frozen=True)

    account_id: str
    as_of: datetime | None = None
    currency: str = "USD"
    raw_payload: dict[str, str] = Field(default_factory=dict)


class FlexParseResult(BaseModel):
    """All normalized rows parsed from one or more Flex XML files."""

    model_config = ConfigDict(frozen=True)

    trades: list[FlexTradeConfirm] = Field(default_factory=list)
    cash_transactions: list[FlexCashTransaction] = Field(default_factory=list)
    open_positions: list[FlexOpenPosition] = Field(default_factory=list)
    option_eae: list[FlexTradeConfirm] = Field(default_factory=list)
    account_information: list[FlexAccountInformation] = Field(default_factory=list)
    section_counts: dict[str, int] = Field(default_factory=dict)


def parse_flex_files(paths: Iterable[Path], account_id: str | None = None) -> FlexParseResult:
    """Parse Flex XML files into typed rows, optionally filtering to one account."""

    trades: list[FlexTradeConfirm] = []
    cash: list[FlexCashTransaction] = []
    positions: list[FlexOpenPosition] = []
    eae_rows: list[FlexTradeConfirm] = []
    account_info: list[FlexAccountInformation] = []
    counts: dict[str, int] = {}
    for path in paths:
        root = _parse_xml_file(path)
        statement_dates = _statement_dates(root)
        for section_name, row in _iter_section_rows(root):
            attrs = dict(row.attrib)
            if account_id and attrs.get("accountId") != account_id:
                continue
            counts[section_name] = counts.get(section_name, 0) + 1
            if section_name == "TradeConfirms":
                trades.append(parse_trade_confirm(attrs, statement_dates[1]))
            elif section_name == "CashTransactions":
                cash.append(parse_cash_transaction(attrs))
            elif section_name == "OpenPositions":
                positions.append(parse_open_position(attrs, statement_dates[1]))
            elif section_name == "OptionEAE":
                eae_rows.append(parse_option_eae(attrs, statement_dates[1]))
            elif section_name == "AccountInformation":
                account_info.append(parse_account_information(attrs))
    return FlexParseResult(
        trades=trades,
        cash_transactions=cash,
        open_positions=positions,
        option_eae=eae_rows,
        account_information=account_info,
        section_counts=counts,
    )


def parse_trade_confirm(attrs: dict[str, str], fallback_date: date | None = None) -> FlexTradeConfirm:
    """Normalize one TradeConfirm row into an options trade model."""

    leg = _leg_from_attrs(attrs)
    trade_time = _datetime_attr(attrs, ("dateTime",), fallback_date=fallback_date)
    side = _normalize_side(attrs.get("buySell"), _decimal_attr(attrs, "quantity"))
    return FlexTradeConfirm(
        account_id=leg.account_id,
        leg=leg,
        source_trade_id=_required_any(attrs, ("tradeID", "transactionID")),
        source_transaction_id=_optional_text(attrs.get("transactionID")),
        source_exec_id=_optional_text(attrs.get("ibExecID")),
        event_type=_event_type_from_open_close(attrs.get("openCloseIndicator")),
        side=side,
        trade_time=trade_time,
        trade_date=_date_attr(attrs, ("tradeDate", "dateTime"), fallback=trade_time.date()),
        quantity=_decimal_attr(attrs, "quantity"),
        price=_first_decimal(attrs, ("tradePrice", "price")),
        gross_amount=_decimal_attr(attrs, "proceeds"),
        commission=_first_decimal(attrs, ("commission", "ibCommission")),
        fees=_first_decimal(attrs, ("taxes", "fees")),
        net_cash_flow=_first_decimal(attrs, ("netCash", "proceeds")),
        realized_pnl=_decimal_attr(attrs, "fifoPnlRealized"),
        currency=_currency(attrs),
        raw_payload=attrs,
    )


def parse_option_eae(attrs: dict[str, str], fallback_date: date | None = None) -> FlexTradeConfirm:
    """Normalize one OptionEAE lifecycle row into a trade-like event model."""

    leg = _leg_from_attrs(attrs)
    trade_time = _datetime_attr(attrs, ("dateTime", "reportDate"), fallback_date=fallback_date)
    event_type = _event_type_from_lifecycle(attrs.get("type") or attrs.get("action"))
    quantity = _decimal_attr(attrs, "quantity")
    return FlexTradeConfirm(
        account_id=leg.account_id,
        leg=leg,
        source_trade_id=_required_any(attrs, ("tradeID", "transactionID")),
        source_transaction_id=_optional_text(attrs.get("transactionID")),
        event_type=event_type,
        side=_normalize_side(attrs.get("buySell"), quantity),
        trade_time=trade_time,
        trade_date=_date_attr(attrs, ("reportDate", "dateTime"), fallback=trade_time.date()),
        quantity=quantity,
        price=_first_decimal(attrs, ("tradePrice", "price")),
        gross_amount=_decimal_attr(attrs, "proceeds"),
        net_cash_flow=_first_decimal(attrs, ("netCash", "proceeds")),
        realized_pnl=_decimal_attr(attrs, "fifoPnlRealized"),
        currency=_currency(attrs),
        raw_payload=attrs,
    )


def parse_cash_transaction(attrs: dict[str, str]) -> FlexCashTransaction:
    """Normalize one CashTransaction row into an options cash event."""

    event_time = _optional_datetime_attr(attrs, ("dateTime",))
    event_date = _date_attr(attrs, ("date", "reportDate", "dateTime"), fallback=(event_time or _utc_now()).date())
    return FlexCashTransaction(
        account_id=_required_any(attrs, ("accountId",)),
        source_transaction_id=_required_any(attrs, ("transactionID", "tradeID")),
        event_date=event_date,
        event_time=event_time,
        event_category=_cash_category(attrs.get("type"), attrs.get("description")),
        description=_optional_text(attrs.get("description")),
        amount=_first_decimal(attrs, ("amount", "netCash")),
        currency=_currency(attrs),
        raw_payload=attrs,
    )


def parse_open_position(attrs: dict[str, str], fallback_date: date | None = None) -> FlexOpenPosition:
    """Normalize one OpenPosition row into a snapshot position model."""

    leg = _leg_from_attrs(attrs)
    sync_time = _optional_datetime_attr(attrs, ("dateTime",)) or datetime.combine(
        fallback_date or date.today(), datetime.min.time(), tzinfo=timezone.utc
    )
    return FlexOpenPosition(
        account_id=leg.account_id,
        leg=leg,
        as_of_date=sync_time.date(),
        opened_at=sync_time,
        quantity_open=_first_decimal(attrs, ("position", "quantity")),
        average_open_price=_first_decimal(attrs, ("costPrice", "avgCost")),
        open_cash_flow=_first_decimal(attrs, ("costBasis", "openCashFlow")),
        ib_margin_requirement=_optional_decimal(attrs, "marginRequirement"),
        last_broker_sync_at=sync_time,
        raw_payload=attrs,
    )


def parse_account_information(attrs: dict[str, str]) -> FlexAccountInformation:
    """Normalize one AccountInformation row into sync metadata."""

    return FlexAccountInformation(
        account_id=_required_any(attrs, ("accountId",)),
        as_of=_optional_datetime_attr(attrs, ("dateTime", "reportDate", "date")),
        currency=attrs.get("baseCurrency") or _currency(attrs),
        raw_payload=attrs,
    )


def _parse_xml_file(path: Path) -> Element:
    try:
        return ElementTree.parse(path).getroot()
    except (OSError, ParseError) as exc:
        raise FlexParserError(f"Could not parse Flex XML {path}: {exc}") from exc


def _iter_section_rows(root: Element) -> Iterable[tuple[str, Element]]:
    for section_name, row_name in SECTION_ROW_NAMES.items():
        for section in root.iter(section_name):
            for row in section:
                if row.tag == row_name:
                    yield section_name, row


def _statement_dates(root: Element) -> tuple[date | None, date | None]:
    statement = root.find(".//FlexStatement")
    if statement is None:
        return None, None
    return _parse_date_value(statement.attrib.get("fromDate")), _parse_date_value(statement.attrib.get("toDate"))


def _leg_from_attrs(attrs: dict[str, str]) -> OptionLegKey:
    return OptionLegKey(
        account_id=_required_any(attrs, ("accountId",)),
        underlying_symbol=_required_any(attrs, ("underlyingSymbol", "symbol")),
        option_symbol=_optional_text(attrs.get("symbol")),
        expiry=_required_date(attrs, "expiry"),
        strike=_decimal_attr(attrs, "strike"),
        right=_normalize_right(attrs.get("putCall")),
        multiplier=_decimal_attr(attrs, "multiplier") or Decimal("100"),
        currency=_currency(attrs),
        source_conid=_optional_int(attrs.get("conid") or attrs.get("conId")),
    )


def _required_any(attrs: dict[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        value = _optional_text(attrs.get(name))
        if value:
            return value
    raise FlexParserError(f"Flex row missing required attribute: {'/'.join(names)}")


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _currency(attrs: dict[str, str]) -> str:
    return _optional_text(attrs.get("currency")) or "USD"


def _decimal_attr(attrs: dict[str, str], name: str) -> Decimal:
    return _optional_decimal(attrs, name) or MONEY_ZERO


def _optional_decimal(attrs: dict[str, str], name: str) -> Decimal | None:
    value = _optional_text(attrs.get(name))
    if value is None:
        return None
    try:
        return Decimal(value.replace(",", ""))
    except InvalidOperation as exc:
        raise FlexParserError(f"Invalid decimal for {name}: {value!r}") from exc


def _first_decimal(attrs: dict[str, str], names: tuple[str, ...]) -> Decimal:
    for name in names:
        value = _optional_decimal(attrs, name)
        if value is not None:
            return value
    return MONEY_ZERO


def _optional_int(value: str | None) -> int | None:
    text = _optional_text(value)
    if text is None:
        return None
    return int(text)


def _required_date(attrs: dict[str, str], name: str) -> date:
    parsed = _parse_date_value(attrs.get(name))
    if parsed is None:
        raise FlexParserError(f"Flex row missing required date: {name}")
    return parsed


def _date_attr(attrs: dict[str, str], names: tuple[str, ...], fallback: date) -> date:
    for name in names:
        parsed = _parse_date_value(attrs.get(name))
        if parsed:
            return parsed
    return fallback


def _optional_datetime_attr(attrs: dict[str, str], names: tuple[str, ...]) -> datetime | None:
    for name in names:
        parsed = _parse_datetime_value(attrs.get(name))
        if parsed:
            return parsed
    return None


def _datetime_attr(attrs: dict[str, str], names: tuple[str, ...], fallback_date: date | None) -> datetime:
    return _optional_datetime_attr(attrs, names) or datetime.combine(
        fallback_date or date.today(), datetime.min.time(), tzinfo=timezone.utc
    )


def _parse_date_value(raw_value: str | None) -> date | None:
    value = _optional_text(raw_value)
    if not value:
        return None
    value = value.split(";", maxsplit=1)[0]
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _parse_datetime_value(raw_value: str | None) -> datetime | None:
    value = _optional_text(raw_value)
    if not value:
        return None
    candidates = [value]
    if ";" in value:
        day, time_part = value.split(";", maxsplit=1)
        if len(time_part) == 6:
            candidates.append(f"{day} {time_part[:2]}:{time_part[2:4]}:{time_part[4:6]}")
    for candidate in candidates:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y%m%d %H:%M:%S", "%Y-%m-%d", "%Y%m%d"):
            try:
                parsed = datetime.strptime(candidate, fmt)
                return parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _normalize_right(value: str | None) -> str:
    normalized = (_optional_text(value) or "").lower()
    if normalized in {"p", "put"}:
        return "put"
    if normalized in {"c", "call"}:
        return "call"
    raise FlexParserError(f"Unsupported option right: {value!r}")


def _normalize_side(value: str | None, quantity: Decimal) -> str:
    normalized = (_optional_text(value) or "").lower()
    if normalized.startswith("b"):
        return "buy"
    if normalized.startswith("s"):
        return "sell"
    return "sell" if quantity < 0 else "buy"


def _event_type_from_open_close(value: str | None) -> str:
    normalized = (_optional_text(value) or "").lower()
    if normalized in {"o", "open"}:
        return "open"
    if normalized in {"c", "close"}:
        return "close"
    return "adjustment"


def _event_type_from_lifecycle(value: str | None) -> str:
    normalized = (_optional_text(value) or "").lower()
    if "expir" in normalized:
        return "expire"
    if "assign" in normalized:
        return "assign"
    if "exercise" in normalized:
        return "exercise"
    if "cash" in normalized:
        return "cash_settle"
    return "adjustment"


def _cash_category(event_type: str | None, description: str | None) -> str:
    text = f"{event_type or ''} {description or ''}".lower()
    if "option" in text or "assign" in text or "exercise" in text:
        return "option_related"
    if "commission" in text or "fee" in text:
        return "commission_fee"
    if "tax" in text:
        return "tax_withholding"
    if "interest" in text:
        return "interest"
    if "dividend" in text:
        return "dividend"
    if "transfer" in text:
        return "transfer"
    return "other"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
