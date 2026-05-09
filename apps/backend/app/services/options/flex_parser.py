"""Typed IBKR Flex XML parsers for options-income ingestion."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import logging
from pathlib import Path
from xml.etree import ElementTree
from xml.etree.ElementTree import Element, ParseError

from pydantic import BaseModel, ConfigDict, Field

SECTION_ROW_NAMES = {
    "TradeConfirms": "TradeConfirm",
    "Trades": "Trade",
    "CashTransactions": "CashTransaction",
    "OpenPositions": "OpenPosition",
    "OptionEAE": "OptionEAE",
    "AccountInformation": "AccountInformation",
}
MONEY_ZERO = Decimal("0")
ASSIGNMENT_TRANSACTION_TYPES = {"assignment", "exercise"}
# IBKR notes codes that appear on assignment/exercise legs.
# The `notes` attribute is a semicolon-separated string, e.g. "A;C".
NOTES_CODE_SEPARATOR = ";"
NOTES_ASSIGNMENT_CODES: frozenset[str] = frozenset({"a", "ex"})  # A=Assignment, Ex=Exercise
logger = logging.getLogger(__name__)


def _notes_codes(notes_str: str | None) -> frozenset[str]:
    """Return the normalised (lowercase) set of code tokens from an IBKR notes string."""
    if not notes_str:
        return frozenset()
    return frozenset(tok.strip().lower() for tok in notes_str.split(NOTES_CODE_SEPARATOR) if tok.strip())


def _notes_has_assignment_code(notes_str: str | None) -> bool:
    """Return True if the notes field contains an assignment (A) or exercise (Ex) code."""
    return bool(_notes_codes(notes_str) & NOTES_ASSIGNMENT_CODES)


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


class FlexStockPosition(BaseModel):
    """Normalized STK OpenPosition snapshot row from IBKR Flex XML.

    Parsed from ``<OpenPosition assetCategory="STK" putCall="" .../>`` rows.

    **Note on openDateTime:** IBKR Activity Flex does not populate ``openDateTime``
    for stock positions — only aggregate quantity and average cost basis are
    available. Per-lot holding-period data requires a separate Portfolio Analyst
    query and is out of scope for Phase 2.

    Field mapping from Flex XML attributes:
        position          → quantity
        costBasisPrice    → cost_basis
        positionValue     → market_value
        fifoPnlUnrealized → unrealized_pnl
        costBasisMoney    → cost_basis_total
        subCategory       → sub_category
        conid             → con_id
    """

    model_config = ConfigDict(frozen=True)

    account_id: str
    as_of_date: date
    symbol: str  # ticker
    con_id: int | None = None
    description: str | None = None
    sub_category: str | None = None  # COMMON, ETF, REIT, PREFERENCE, …
    currency: str = "USD"
    quantity: Decimal
    cost_basis: Decimal | None = None  # costBasisPrice (per-share)
    cost_basis_total: Decimal | None = None  # costBasisMoney (total cost)
    mark_price: Decimal | None = None
    market_value: Decimal | None = None  # positionValue
    unrealized_pnl: Decimal | None = None  # fifoPnlUnrealized
    last_broker_sync_at: datetime
    raw_payload: dict[str, str] = Field(default_factory=dict)


class FlexParseResult(BaseModel):
    """All normalized rows parsed from one or more Flex XML files."""

    model_config = ConfigDict(frozen=True)

    trades: list[FlexTradeConfirm] = Field(default_factory=list)
    cash_transactions: list[FlexCashTransaction] = Field(default_factory=list)
    open_positions: list[FlexOpenPosition] = Field(default_factory=list)
    stock_positions: list[FlexStockPosition] = Field(default_factory=list)
    option_eae: list[FlexTradeConfirm] = Field(default_factory=list)
    account_information: list[FlexAccountInformation] = Field(default_factory=list)
    section_counts: dict[str, int] = Field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _AssignmentOptionLeg:
    account_id: str
    underlying_symbol: str
    trade_date: date
    trade_time: datetime
    strike: Decimal
    share_quantity_abs: Decimal
    eae_trade_id: str
    option_trade_id: str
    transaction_type: str
    currency: str
    # Order-level identifiers for hardened pairing (IBKR Phase 1 / Gap #ibOrderID).
    # May be None for legacy data where the field was not included in the Flex query.
    ib_order_id: str | None = None
    # Raw notes string from the OPT or EAE row, e.g. "A;C" for assigned-close.
    opt_notes: str | None = None


def parse_flex_files(paths: Iterable[Path], account_id: str | None = None) -> FlexParseResult:
    """Parse Flex XML files into typed rows, optionally filtering to one account."""

    trades: list[FlexTradeConfirm] = []
    cash: list[FlexCashTransaction] = []
    positions: list[FlexOpenPosition] = []
    stock_positions: list[FlexStockPosition] = []
    eae_rows: list[FlexTradeConfirm] = []
    account_info: list[FlexAccountInformation] = []
    assignment_eae_attrs: list[dict[str, str]] = []
    option_trade_attrs: list[dict[str, str]] = []
    stock_trade_attrs: list[dict[str, str]] = []
    counts: dict[str, int] = {
        "assignment_synthetic_emitted": 0,
        "assignment_synthetic_skipped_no_market": 0,
        "assignment_synthetic_skipped_ambiguous": 0,
    }
    for path in paths:
        root = _parse_xml_file(path)
        statement_dates = _statement_dates(root)
        for section_name, row in _iter_section_rows(root):
            attrs = dict(row.attrib)
            if account_id and attrs.get("accountId") != account_id:
                continue
            counts[section_name] = counts.get(section_name, 0) + 1
            if section_name in {"TradeConfirms", "Trades"}:
                if _is_option_contract_row(attrs):
                    option_trade_attrs.append(attrs)
                    trades.append(parse_trade_confirm(attrs, statement_dates[1]))
                elif attrs.get("assetCategory") == "STK":
                    stock_trade_attrs.append(attrs)
            elif section_name == "CashTransactions":
                cash.append(parse_cash_transaction(attrs))
            elif section_name == "OpenPositions":
                if _is_option_contract_row(attrs):
                    positions.append(parse_open_position(attrs, statement_dates[1]))
                elif attrs.get("assetCategory") == "STK" and attrs.get("putCall", "") == "":
                    # STK open position — parse and collect; BOND/CASH rows are excluded
                    # by the assetCategory check (only "STK" passes).
                    stk = parse_stock_open_position(attrs, statement_dates[1])
                    if stk is not None:
                        stock_positions.append(stk)
            elif section_name == "OptionEAE":
                if _is_assignment_lifecycle_row(attrs):
                    assignment_eae_attrs.append(attrs)
                if _is_option_contract_row(attrs):
                    eae_rows.append(parse_option_eae(attrs, statement_dates[1]))
            elif section_name == "AccountInformation":
                account_info.append(parse_account_information(attrs))
    cash.extend(_assignment_synthetic_cash_events(assignment_eae_attrs, option_trade_attrs, stock_trade_attrs, counts))
    return FlexParseResult(
        trades=trades,
        cash_transactions=cash,
        open_positions=positions,
        stock_positions=stock_positions,
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
        event_type=_event_type_from_trade_attrs(attrs),
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
    event_type = _event_type_from_lifecycle(attrs.get("transactionType") or attrs.get("type") or attrs.get("action"))
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
        average_open_price=_first_decimal(attrs, ("costPrice", "avgCost", "costBasisPrice")),
        open_cash_flow=_first_decimal(attrs, ("costBasis", "openCashFlow", "costBasisMoney")),
        ib_margin_requirement=_optional_decimal(attrs, "marginRequirement"),
        last_broker_sync_at=sync_time,
        raw_payload=attrs,
    )


def parse_stock_open_position(attrs: dict[str, str], fallback_date: date | None = None) -> FlexStockPosition | None:
    """Normalize one STK OpenPosition row into a stock snapshot model.

    Args:
        attrs: Raw XML attribute dict from an ``<OpenPosition assetCategory="STK">`` row.
        fallback_date: Statement end-date used when the row carries no dateTime.

    Returns:
        A ``FlexStockPosition`` instance, or ``None`` if the row cannot be parsed
        (e.g. missing symbol or invalid quantity).
    """
    symbol = _optional_text(attrs.get("symbol")) or _optional_text(attrs.get("underlyingSymbol"))
    if not symbol:
        logger.warning("Skipping STK OpenPosition row with no symbol: %s", attrs)
        return None

    quantity_raw = _optional_decimal(attrs, "position")
    if quantity_raw is None:
        logger.warning("Skipping STK OpenPosition row with no position quantity: symbol=%s", symbol)
        return None

    sync_time: datetime = _optional_datetime_attr(attrs, ("dateTime",)) or datetime.combine(
        fallback_date or date.today(), datetime.min.time(), tzinfo=timezone.utc
    )
    as_of = sync_time.date() if sync_time else (fallback_date or date.today())

    con_id_str = attrs.get("conid") or attrs.get("conId")
    con_id: int | None = None
    if con_id_str:
        try:
            con_id = int(con_id_str)
        except ValueError:
            pass

    return FlexStockPosition(
        account_id=_required_any(attrs, ("accountId",)),
        as_of_date=as_of,
        symbol=symbol,
        con_id=con_id,
        description=_optional_text(attrs.get("description")),
        sub_category=_optional_text(attrs.get("subCategory")),
        currency=_currency(attrs),
        quantity=quantity_raw,
        cost_basis=_optional_decimal(attrs, "costBasisPrice"),
        cost_basis_total=_optional_decimal(attrs, "costBasisMoney"),
        mark_price=_optional_decimal(attrs, "markPrice"),
        market_value=_optional_decimal(attrs, "positionValue"),
        unrealized_pnl=_optional_decimal(attrs, "fifoPnlUnrealized"),
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


def _assignment_synthetic_cash_events(
    eae_rows: list[dict[str, str]],
    option_trade_rows: list[dict[str, str]],
    stock_trade_rows: list[dict[str, str]],
    counts: dict[str, int],
) -> list[FlexCashTransaction]:
    """Create cash-flow adjustments from assigned/exercised stock legs."""

    option_rows_by_trade_id: dict[str, list[dict[str, str]]] = {}
    for row in option_trade_rows:
        trade_id = _optional_text(row.get("tradeID") or row.get("transactionID"))
        if trade_id:
            option_rows_by_trade_id.setdefault(trade_id, []).append(row)

    emitted: list[FlexCashTransaction] = []
    seen_source_ids: set[str] = set()
    for eae in eae_rows:
        option_leg = _assignment_option_leg(eae, option_rows_by_trade_id)
        if option_leg is None:
            continue
        matched_row, tier = _select_best_pairing_with_tier(stock_trade_rows, option_leg, counts)
        if matched_row is None:
            continue
        event = _synthetic_cash_from_stock_row(option_leg, matched_row, counts, pair_method=tier)
        if event is None or event.source_transaction_id in seen_source_ids:
            continue
        seen_source_ids.add(event.source_transaction_id)
        counts["assignment_synthetic_emitted"] += 1
        emitted.append(event)
    return emitted


def _assignment_option_leg(
    eae: dict[str, str], option_rows_by_trade_id: dict[str, list[dict[str, str]]]
) -> _AssignmentOptionLeg | None:
    transaction_type = _optional_text(eae.get("transactionType") or eae.get("type") or eae.get("action"))
    if (transaction_type or "").lower() not in ASSIGNMENT_TRANSACTION_TYPES:
        return None
    eae_trade_id = _optional_text(eae.get("tradeID") or eae.get("transactionID"))
    if not eae_trade_id:
        return None
    option_matches = option_rows_by_trade_id.get(eae_trade_id, [])
    if len(option_matches) != 1:
        if len(option_matches) > 1:
            logger.warning(
                "Skipping assignment synthetic cash event with ambiguous option leg",
                extra={"eae_trade_id": eae_trade_id, "option_match_count": len(option_matches)},
            )
        return None
    option_row = option_matches[0]
    trade_time = _datetime_attr(option_row, ("dateTime",), fallback_date=None)
    # Prefer ibOrderID from the OPT row; fall back to the EAE row.
    # raw_payload["notes"] is available at trade.raw_payload["notes"] per Hockney Phase 0 doc.
    ib_order_id = _optional_text(
        option_row.get("ibOrderID") or option_row.get("orderID") or eae.get("ibOrderID") or eae.get("orderID")
    )
    opt_notes = _optional_text(option_row.get("notes") or eae.get("notes"))
    return _AssignmentOptionLeg(
        account_id=_required_any(option_row, ("accountId",)),
        underlying_symbol=_required_any(option_row, ("underlyingSymbol", "symbol")),
        trade_date=_date_attr(option_row, ("tradeDate", "dateTime"), fallback=trade_time.date()),
        trade_time=trade_time,
        strike=_decimal_attr(option_row, "strike"),
        share_quantity_abs=abs(
            _decimal_attr(option_row, "quantity") * (_decimal_attr(option_row, "multiplier") or Decimal("100"))
        ),
        eae_trade_id=eae_trade_id,
        option_trade_id=_required_any(option_row, ("tradeID", "transactionID")),
        transaction_type=transaction_type or "Assignment",
        currency=_currency(option_row),
        ib_order_id=ib_order_id,
        opt_notes=opt_notes,
    )


def _stock_row_heuristic_match(row: dict[str, str], option_leg: _AssignmentOptionLeg) -> bool:
    """Original date + underlying + strike + quantity heuristic (kept as fallback)."""
    if _optional_text(row.get("assetCategory")) != "STK":
        return False
    account_id = _optional_text(row.get("accountId"))
    underlying = _optional_text(row.get("underlyingSymbol") or row.get("symbol"))
    event_time = _optional_datetime_attr(row, ("dateTime",))
    trade_date = _date_attr(row, ("tradeDate", "dateTime"), fallback=(event_time or option_leg.trade_time).date())
    return (
        account_id == option_leg.account_id
        and underlying == option_leg.underlying_symbol
        and trade_date == option_leg.trade_date
        and _first_decimal(row, ("tradePrice", "price")) == option_leg.strike
        and abs(_decimal_attr(row, "quantity")) == option_leg.share_quantity_abs
    )


def _stock_row_matches_assignment(row: dict[str, str], option_leg: _AssignmentOptionLeg) -> bool:
    """Backwards-compatible shim — delegates to the heuristic tier."""
    return _stock_row_heuristic_match(row, option_leg)


def _select_best_pairing_with_tier(
    stock_trade_rows: list[dict[str, str]],
    option_leg: _AssignmentOptionLeg,
    counts: dict[str, int],
) -> tuple[dict[str, str] | None, str]:
    """Select the best matching STK row for an assignment OPT leg.

    Pairing strategy (in priority order):

    1. **order_id** — Both the OPT row and the STK row carry the same ``ibOrderID``
       (or ``orderID``).  This is a definitive IBKR-level link and requires no
       additional validation.

    2. **heuristic_notes** — The classic date + underlying + strike + quantity
       heuristic returns exactly one candidate *and* that candidate's ``notes``
       field contains an assignment/exercise code (``A`` or ``Ex``).  The notes
       code confirms the heuristic hit is genuinely an assignment leg.

    3. **heuristic** — The classic heuristic returns exactly one candidate (legacy
       behaviour).

    When the heuristic returns multiple candidates the notes field is used to
    *narrow* the set.  If exactly one candidate has a confirming notes code that
    single candidate is chosen (tier ``heuristic_notes_narrowed``).  Otherwise the
    situation is flagged as ambiguous and ``(None, "ambiguous")`` is returned.

    Returns ``(matched_row, tier_name)`` or ``(None, "no_match"|"ambiguous")``.
    """
    # ── Tier 1: ibOrderID match ────────────────────────────────────────────────
    if option_leg.ib_order_id:
        order_matches = [
            row
            for row in stock_trade_rows
            if _optional_text(row.get("assetCategory")) == "STK"
            and _optional_text(row.get("accountId")) == option_leg.account_id
            and _optional_text(row.get("ibOrderID") or row.get("orderID")) == option_leg.ib_order_id
        ]
        if len(order_matches) == 1:
            counts["assignment_paired_by_order_id"] = counts.get("assignment_paired_by_order_id", 0) + 1
            return (order_matches[0], "order_id")
        if len(order_matches) > 1:
            # Multiple STK rows with the same ibOrderID — data anomaly; fall through.
            logger.warning(
                "Multiple STK rows share ibOrderID — falling through to heuristic",
                extra={
                    "account_id": option_leg.account_id,
                    "ib_order_id": option_leg.ib_order_id,
                    "stock_trade_ids": [_optional_text(row.get("tradeID")) for row in order_matches],
                },
            )

    # ── Tiers 2 & 3: heuristic (possibly narrowed by notes) ───────────────────
    heuristic_matches = [row for row in stock_trade_rows if _stock_row_heuristic_match(row, option_leg)]

    if not heuristic_matches:
        return (None, "no_match")

    if len(heuristic_matches) == 1:
        stk_row = heuristic_matches[0]
        if _notes_has_assignment_code(_optional_text(stk_row.get("notes"))):
            counts["assignment_paired_by_notes"] = counts.get("assignment_paired_by_notes", 0) + 1
            return (stk_row, "heuristic_notes")
        counts["assignment_paired_by_heuristic"] = counts.get("assignment_paired_by_heuristic", 0) + 1
        return (stk_row, "heuristic")

    # Multiple heuristic matches — try to narrow by notes code.
    notes_confirmed = [row for row in heuristic_matches if _notes_has_assignment_code(_optional_text(row.get("notes")))]
    if len(notes_confirmed) == 1:
        counts["assignment_paired_by_notes"] = counts.get("assignment_paired_by_notes", 0) + 1
        return (notes_confirmed[0], "heuristic_notes_narrowed")

    # Still ambiguous — flag for manual review.
    counts["assignment_synthetic_skipped_ambiguous"] += 1
    logger.warning(
        "Skipping ambiguous assignment synthetic cash event",
        extra={
            "account_id": option_leg.account_id,
            "underlying": option_leg.underlying_symbol,
            "trade_date": option_leg.trade_date.isoformat(),
            "eae_trade_id": option_leg.eae_trade_id,
            "heuristic_candidate_count": len(heuristic_matches),
            "notes_confirmed_count": len(notes_confirmed),
            "stock_trade_ids": [_optional_text(row.get("tradeID")) for row in heuristic_matches],
        },
    )
    return (None, "ambiguous")


def _synthetic_cash_from_stock_row(
    option_leg: _AssignmentOptionLeg,
    stock_row: dict[str, str],
    counts: dict[str, int],
    *,
    pair_method: str = "heuristic",
) -> FlexCashTransaction | None:
    mtm_pnl = _optional_decimal(stock_row, "mtmPnl")
    close_price = _optional_decimal(stock_row, "closePrice")
    trade_price = _first_decimal(stock_row, ("tradePrice", "price"))
    quantity = _decimal_attr(stock_row, "quantity")
    formula = "mtmPnl"
    if mtm_pnl is not None:
        amount = mtm_pnl
    elif close_price is not None:
        amount = quantity * (close_price - trade_price)
        formula = "computed"
    else:
        counts["assignment_synthetic_skipped_no_market"] += 1
        logger.warning(
            "Skipping assignment synthetic cash event without market price",
            extra={
                "account_id": option_leg.account_id,
                "underlying": option_leg.underlying_symbol,
                "eae_trade_id": option_leg.eae_trade_id,
                "stock_trade_id": _optional_text(stock_row.get("tradeID")),
            },
        )
        return None

    stock_trade_id = _required_any(stock_row, ("tradeID", "transactionID"))
    market_text = str(close_price) if close_price is not None else "unknown"
    raw_payload = {
        "underlying": option_leg.underlying_symbol,
        "eae_trade_id": option_leg.eae_trade_id,
        "option_trade_id": option_leg.option_trade_id,
        "stk_trade_id": stock_trade_id,
        "strike": str(option_leg.strike),
        "close_price": str(close_price) if close_price is not None else "",
        "trade_price": str(trade_price),
        "quantity": str(quantity),
        "formula": formula,
        "transaction_type": option_leg.transaction_type,
        "pair_method": pair_method,
    }
    return FlexCashTransaction(
        account_id=option_leg.account_id,
        source_transaction_id=f"assign_synth:{stock_trade_id}",
        event_date=option_leg.trade_date,
        event_time=_optional_datetime_attr(stock_row, ("dateTime",)) or option_leg.trade_time,
        event_category="assignment_synthetic",
        description=(
            f"{option_leg.underlying_symbol} assignment synthetic "
            f"(strike {option_leg.strike} vs market {market_text}, {abs(quantity)} shares)"
        ),
        amount=amount,
        currency=_currency(stock_row) or option_leg.currency,
        raw_payload=raw_payload,
    )


def _is_assignment_lifecycle_row(attrs: dict[str, str]) -> bool:
    transaction_type = _optional_text(attrs.get("transactionType") or attrs.get("type") or attrs.get("action"))
    return (transaction_type or "").lower() in ASSIGNMENT_TRANSACTION_TYPES


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


def _is_option_contract_row(attrs: dict[str, str]) -> bool:
    if attrs.get("assetCategory") == "OPT":
        return True
    return all(_optional_text(attrs.get(name)) for name in ("expiry", "strike", "putCall"))


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


def _event_type_from_trade_attrs(attrs: dict[str, str]) -> str:
    """Derive event_type from trade attributes with notes/PnL fallback.

    When ``openCloseIndicator`` is absent (common in Activity Statement ``Trades``
    sections that omit that field), falls back to IBKR lifecycle note codes and
    then to realized-PnL sign:

    1. ``openCloseIndicator`` O/C → "open" / "close"
    2. notes ``Ep`` → "expire", ``Ex`` → "exercise", ``A`` → "assign"
    3. ``fifoPnlRealized`` != 0 → "close"  (PnL can only be realized on a close)
    4. default → "open"
    """
    oci = _event_type_from_open_close(attrs.get("openCloseIndicator"))
    if oci != "adjustment":
        return oci
    notes = _notes_codes(attrs.get("notes"))
    if "ep" in notes:
        return "expire"
    if "ex" in notes:
        return "exercise"
    if "a" in notes:
        return "assign"
    realized_pnl = _optional_decimal(attrs, "fifoPnlRealized")
    if realized_pnl is not None and realized_pnl != Decimal("0"):
        return "close"
    return "open"


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
