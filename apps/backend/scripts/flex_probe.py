"""Probe IBKR Flex Query XML fields for the options income dashboard."""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from xml.etree import ElementTree
from xml.etree.ElementTree import Element, ParseError

import requests

FLEX_BASE_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet"
SEND_REQUEST_URL = f"{FLEX_BASE_URL}/FlexStatementService.SendRequest"
GET_STATEMENT_URL = f"{FLEX_BASE_URL}/FlexStatementService.GetStatement"
OUTPUT_DIR = Path("tmp/flex")
MONEY_DISPLAY = Decimal("0.01")

QUERY_ENV_VARS = {
    "trades": ("IBKR_FLEX_QUERY_ID_TRADES",),
    "option_eae": ("IBKR_FLEX_QUERY_ID_OPTION_EAE", "IBKR_FLEX_QUERY_ID_OPTIONEAE"),
    "cash": ("IBKR_FLEX_QUERY_ID_CASH",),
    "positions": ("IBKR_FLEX_QUERY_ID_POSITIONS",),
    "account_info": ("IBKR_FLEX_QUERY_ID_ACCOUNT_INFO",),
}

SECTION_ROW_NAMES = {
    "TradeConfirms": "TradeConfirm",
    "CashTransactions": "CashTransaction",
    "OpenPositions": "OpenPosition",
    "OptionEAE": "OptionEAE",
    "AccountInformation": "AccountInformation",
}

DATE_ATTRIBUTES = ("dateTime", "tradeDate", "reportDate", "date")
SYMBOL_ATTRIBUTES = ("underlyingSymbol", "symbol")


class FlexProbeError(RuntimeError):
    """Raised when a Flex probe cannot complete safely."""


@dataclass(frozen=True)
class QueryConfig:
    """Configured Flex query name and ID."""

    name: str
    query_id: str


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", help="Filter rows to one IBKR accountId")
    parser.add_argument("--from", dest="from_date", type=parse_iso_date, help="Statement start date, YYYY-MM-DD")
    parser.add_argument("--to", dest="to_date", type=parse_iso_date, help="Statement end date, YYYY-MM-DD")
    parser.add_argument("--synthetic", action="store_true", help="Read tmp/flex/synthetic_*.xml instead of IBKR")
    parser.add_argument("--poll-seconds", type=int, default=5, help="Seconds between GetStatement polls")
    parser.add_argument("--max-polls", type=int, default=24, help="Maximum GetStatement polls before failing")
    return parser.parse_args(argv)


def parse_iso_date(value: str) -> date:
    """Parse an ISO calendar date for CLI flags."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid date {value!r}; expected YYYY-MM-DD") from exc


def warn_if_window_exceeds_limit(start: date | None, end: date | None) -> None:
    """Warn when the requested Flex date range exceeds IBKR's 365-day window."""
    if start and end and (end - start).days > 365:
        print(
            "warning: IBKR Flex date ranges are limited to 365 days; split this request if live probing fails",
            file=sys.stderr,
        )


def query_configs_from_env() -> list[QueryConfig]:
    """Read available Flex query IDs from environment variables."""
    configs: list[QueryConfig] = []
    for name, env_names in QUERY_ENV_VARS.items():
        query_id = next((os.environ.get(env_name) for env_name in env_names if os.environ.get(env_name)), None)
        if query_id:
            configs.append(QueryConfig(name=name, query_id=query_id))
    return configs


def ensure_synthetic_fixtures() -> list[Path]:
    """Return synthetic fixtures, generating them when absent."""
    paths = sorted(OUTPUT_DIR.glob("synthetic_*.xml"))
    if paths:
        return paths
    from flex_synthetic import write_synthetic_files

    print("No synthetic fixtures found; generating tmp/flex/synthetic_*.xml", file=sys.stderr)
    return sorted(write_synthetic_files(OUTPUT_DIR))


def request_xml(url: str, params: dict[str, str], timeout_seconds: int = 30) -> Element:
    """GET a Flex endpoint and return the XML root, raising clear errors."""
    safe_params = {key: ("***" if key == "t" else value) for key, value in params.items()}
    print(f"GET {url}?{urlencode(safe_params)}", file=sys.stderr)
    response = requests.get(url, params=params, timeout=timeout_seconds)
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise FlexProbeError(f"HTTP error from IBKR Flex: {exc}") from exc
    return parse_xml_bytes(response.content, source=url)


def parse_xml_bytes(content: bytes, *, source: str) -> Element:
    """Parse XML bytes and raise a source-qualified error on failure."""
    try:
        return ElementTree.fromstring(content)
    except ParseError as exc:
        raise FlexProbeError(f"XML parse error in {source}: {exc}") from exc


def child_text(root: Element, name: str) -> str | None:
    """Return direct or descendant child text for a Flex response node."""
    child = root.find(f".//{name}")
    if child is None or child.text is None:
        return None
    return child.text.strip()


def flex_error(root: Element) -> tuple[str | None, str | None]:
    """Return Flex error code and message when present."""
    return child_text(root, "ErrorCode"), child_text(root, "ErrorMessage")


def send_flex_request(
    config: QueryConfig,
    token: str,
    start: date | None,
    end: date | None,
    *,
    max_retries: int = 5,
    initial_backoff_seconds: float = 30.0,
    sleep: Any = time.sleep,
) -> str:
    """Call SendRequest and return the Flex reference code.

    When start/end are supplied we also send `period=CustomDate` so IBKR honors
    the override; otherwise the saved query period (e.g. Last365CalendarDays)
    silently overrides the dates and the response is the wrong window.
    See IBKR Flex Web Service Guide.

    Retries with exponential backoff on transient `1001` (statement could not
    be generated) errors, which IBKR returns when the same Query ID is fired
    too frequently. Other Flex error codes fail fast.
    """
    params = {"t": token, "q": config.query_id, "v": "3"}
    if start and end:
        params["period"] = "CustomDate"
    if start:
        params["startdate"] = start.strftime("%Y%m%d")
    if end:
        params["enddate"] = end.strftime("%Y%m%d")
    backoff = initial_backoff_seconds
    last_message = ""
    for attempt in range(1, max_retries + 1):
        root = request_xml(SEND_REQUEST_URL, params)
        error_code, error_message = flex_error(root)
        if error_code == "1001" and attempt < max_retries:
            print(
                f"{config.name}: Flex 1001 throttle (attempt {attempt}/{max_retries}); "
                f"sleeping {backoff:.0f}s before retry",
                file=sys.stderr,
            )
            sleep(backoff)
            backoff = min(backoff * 2, 480.0)
            last_message = error_message or ""
            continue
        if error_code and error_code != "0":
            detail = (error_message or last_message or "").strip()
            raise FlexProbeError(f"SendRequest failed for {config.name}: {error_code} {detail}".strip())
        reference_code = child_text(root, "ReferenceCode")
        if not reference_code:
            raise FlexProbeError(f"SendRequest for {config.name} did not return a ReferenceCode")
        return reference_code
    raise FlexProbeError(f"SendRequest failed for {config.name}: 1001 retries exhausted ({last_message})".strip())


def get_statement(config: QueryConfig, token: str, reference_code: str, poll_seconds: int, max_polls: int) -> bytes:
    """Poll GetStatement until the Flex XML statement is ready."""
    params = {"t": token, "q": reference_code, "v": "3"}
    for attempt in range(1, max_polls + 1):
        response = requests.get(GET_STATEMENT_URL, params=params, timeout=60)
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise FlexProbeError(f"HTTP error from GetStatement for {config.name}: {exc}") from exc
        root = parse_xml_bytes(response.content, source=f"GetStatement {config.name}")
        error_code, error_message = flex_error(root)
        if error_code == "1019":
            print(
                f"{config.name}: statement generation in progress (poll {attempt}/{max_polls}); waiting",
                file=sys.stderr,
            )
            time.sleep(poll_seconds)
            continue
        if error_code and error_code != "0":
            raise FlexProbeError(f"GetStatement failed for {config.name}: {error_code} {error_message or ''}".strip())
        return response.content
    raise FlexProbeError(f"GetStatement timed out for {config.name} after {max_polls} polls")


def fetch_live_xml(configs: list[QueryConfig], token: str, args: argparse.Namespace) -> list[Path]:
    """Fetch configured live Flex queries and dump raw XML to tmp/flex.

    Deduplicates by query_id: when multiple env vars (e.g. trades + cash +
    positions) share a single Flex query, IBKR returns 1001/1018 throttle
    errors on the back-to-back identical SendRequests. The downstream parser
    walks each file's sections by tag name, so one XML covering many sections
    is sufficient.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    paths: list[Path] = []
    seen_query_ids: set[str] = set()
    for config in configs:
        if config.query_id in seen_query_ids:
            print(
                f"Skipping Flex query {config.name} (query_id={config.query_id} already fetched this run)",
                file=sys.stderr,
            )
            continue
        seen_query_ids.add(config.query_id)
        print(f"Requesting Flex query {config.name}", file=sys.stderr)
        reference_code = send_flex_request(config, token, args.from_date, args.to_date)
        content = get_statement(config, token, reference_code, args.poll_seconds, args.max_polls)
        path = OUTPUT_DIR / f"{config.name}_{timestamp}.xml"
        path.write_bytes(content)
        print(f"Wrote raw Flex XML to {path}", file=sys.stderr)
        paths.append(path)
    return paths


def iter_section_rows(root: Element) -> Iterable[tuple[str, Element]]:
    """Yield known Flex section row elements from a parsed document."""
    for section_name, row_name in SECTION_ROW_NAMES.items():
        for section in root.iter(section_name):
            for row in section:
                if row.tag == row_name:
                    yield section_name, row


def row_date(attrs: dict[str, str]) -> date | None:
    """Extract a best-effort date from common Flex attributes."""
    for attr in DATE_ATTRIBUTES:
        raw_value = attrs.get(attr)
        if not raw_value:
            continue
        value = raw_value.split(";", maxsplit=1)[0]
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
    return None


def decimal_attr(attrs: dict[str, str], name: str) -> Decimal:
    """Parse a Decimal XML attribute, returning zero for missing values."""
    value = attrs.get(name)
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(value.replace(",", ""))
    except (InvalidOperation, AttributeError) as exc:
        raise FlexProbeError(f"invalid decimal for {name}: {value!r}") from exc


def display_decimal(value: Decimal) -> str:
    """Format a Decimal for summary display using cents."""
    return str(value.quantize(MONEY_DISPLAY))


def update_scenario_totals(
    scenario_summaries: dict[str, dict[str, Decimal | int]],
    scenario: str,
    cash_flow: Decimal,
    realized_pnl: Decimal,
    row_count_increment: int,
) -> None:
    """Accumulate per-scenario financial totals."""
    summary = scenario_summaries[scenario]
    summary["rows"] = int(summary["rows"]) + row_count_increment
    summary["cash_flow"] = Decimal(summary["cash_flow"]) + cash_flow
    summary["fifoPnlRealized"] = Decimal(summary["fifoPnlRealized"]) + realized_pnl


def summarize_flex_xml(paths: Iterable[Path], account_id: str | None = None) -> dict[str, Any]:
    """Parse Flex XML files and return a dict summary for Phase 0 verification."""
    section_counts: dict[str, int] = defaultdict(int)
    symbols: set[str] = set()
    dates: list[date] = []
    total_notional = Decimal("0")
    fifo_pnl_realized = Decimal("0")
    trade_cash_flow = Decimal("0")
    cash_transaction_amount = Decimal("0")
    scenario_summaries: dict[str, dict[str, Decimal | int]] = defaultdict(
        lambda: {"rows": 0, "cash_flow": Decimal("0"), "fifoPnlRealized": Decimal("0")}
    )
    files: list[str] = []

    for path in paths:
        files.append(str(path))
        try:
            root = ElementTree.parse(path).getroot()
        except ParseError as exc:
            raise FlexProbeError(f"XML parse error in {path}: {exc}") from exc
        for section_name, row in iter_section_rows(root):
            attrs = dict(row.attrib)
            if account_id and attrs.get("accountId") != account_id:
                continue
            section_counts[section_name] += 1
            scenario = attrs.get("scenario", "unclassified")
            for attr in SYMBOL_ATTRIBUTES:
                symbol = attrs.get(attr)
                if symbol:
                    symbols.add(symbol.strip())
                    break
            parsed_date = row_date(attrs)
            if parsed_date:
                dates.append(parsed_date)

            realized = decimal_attr(attrs, "fifoPnlRealized")
            fifo_pnl_realized += realized

            if section_name == "TradeConfirms":
                quantity = abs(decimal_attr(attrs, "quantity"))
                price = abs(decimal_attr(attrs, "tradePrice") or decimal_attr(attrs, "price"))
                multiplier = abs(decimal_attr(attrs, "multiplier") or Decimal("100"))
                row_notional = quantity * price * multiplier
                net_cash = decimal_attr(attrs, "netCash")
                total_notional += row_notional
                trade_cash_flow += net_cash
                update_scenario_totals(scenario_summaries, scenario, net_cash, realized, 1)
            elif section_name == "CashTransactions":
                cash_transaction_amount += decimal_attr(attrs, "amount")
                update_scenario_totals(scenario_summaries, scenario, Decimal("0"), Decimal("0"), 1)
            else:
                update_scenario_totals(scenario_summaries, scenario, Decimal("0"), realized, 1)

    scenario_output = {
        scenario: {
            "rows": totals["rows"],
            "cash_flow": display_decimal(Decimal(totals["cash_flow"])),
            "fifoPnlRealized": display_decimal(Decimal(totals["fifoPnlRealized"])),
        }
        for scenario, totals in sorted(scenario_summaries.items())
    }

    return {
        "files": files,
        "row_counts": dict(sorted(section_counts.items())),
        "distinct_symbols": sorted(symbols),
        "date_range": {
            "from": min(dates).isoformat() if dates else None,
            "to": max(dates).isoformat() if dates else None,
        },
        "total_notional": display_decimal(total_notional),
        "sum_fifoPnlRealized": display_decimal(fifo_pnl_realized),
        "sum_cash_flow": display_decimal(trade_cash_flow),
        "sum_cash_transactions": display_decimal(cash_transaction_amount),
        "scenario_summaries": scenario_output,
    }


def select_input_files(args: argparse.Namespace) -> list[Path]:
    """Return XML files to parse, using synthetic fallback when live credentials are absent."""
    token = os.environ.get("IBKR_FLEX_TOKEN")
    configs = query_configs_from_env()
    if args.synthetic:
        return ensure_synthetic_fixtures()
    if not token or not configs:
        print(
            "IBKR_FLEX_TOKEN or query IDs are not configured; falling back to synthetic fixtures",
            file=sys.stderr,
        )
        return ensure_synthetic_fixtures()
    return fetch_live_xml(configs, token, args)


def main(argv: Iterable[str] | None = None) -> int:
    """Run the Flex probe and print exactly one final summary dict to stdout."""
    args = parse_args(argv)
    warn_if_window_exceeds_limit(args.from_date, args.to_date)
    try:
        paths = select_input_files(args)
        summary = summarize_flex_xml(paths, args.account)
    except (FlexProbeError, requests.RequestException, OSError) as exc:
        print(f"flex_probe error: {exc}", file=sys.stderr)
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
