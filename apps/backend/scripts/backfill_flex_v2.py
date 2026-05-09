#!/usr/bin/env python3
"""Flex pipeline v2 — Phase 3 backfill.

Populates the 4 new tables (dividend_payments, dividend_accruals,
security_reference, bond_holdings) and updates identifier columns on
stock_positions from existing data sources without a fresh Flex API call.

Data sources:
  - reports/activity/OptionsIncomeDashboard_Master.xml  (Jony's manual export)
  - options_cash_events.raw_payload                     (6028 rows; 5524 dividend-type)
  - stock_positions.raw_payload                         (270 flex rows for cost_basis_total)

Phases:
  A  — stock_positions: update 8 identifier columns from master XML + cost_basis_total from raw_payload
  B  — dividend_payments: re-route dividend CashTransactions from options_cash_events
  C  — dividend_accruals: seed from master XML ChangeInDividendAccruals + OpenDividendAccruals
  D  — security_reference: seed from STK + BOND OpenPositions in master XML
  E  — bond_holdings: seed from BOND OpenPositions in master XML

Usage:
    uv run python scripts/backfill_flex_v2.py [--dry-run] [--phase=A,B,C,D,E]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

# Allow running from apps/backend/ or project root.
_HERE = Path(__file__).resolve()
_BACKEND_ROOT = _HERE.parents[1]  # apps/backend/
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

PROJECT_ROOT = _HERE.parents[3]  # trading-journal/
MASTER_XML = PROJECT_ROOT / "reports" / "activity" / "OptionsIncomeDashboard_Master.xml"

from sqlmodel import Session, text  # noqa: E402

from app.dal.database import engine  # noqa: E402
from app.services.options.flex_parser import (  # noqa: E402
    DIVIDEND_CASH_TYPES,
    FlexSecurityInfo,
    parse_dividend_payment,
    parse_flex_files,
)
from app.worker.handlers.options_sync import (  # noqa: E402
    _load_accounts,
    _sync_dividend_accruals,
    _upsert_security_reference,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Extended set to catch "Payment In Lieu Of Dividend" (singular variant seen in some rows)
_DIVIDEND_ROUTE_TYPES = DIVIDEND_CASH_TYPES | frozenset({"Payment In Lieu Of Dividend"})


# ---------------------------------------------------------------------------
# Phase A — stock_positions identifier columns
# ---------------------------------------------------------------------------


def run_phase_a(session: Session, dry_run: bool) -> dict[str, int]:
    """Update stock_positions identifier columns from master XML + cost_basis_total from raw_payload."""
    result = {"read": 0, "updated_identifiers": 0, "updated_cost_basis": 0, "skipped": 0}

    # Step A1: Update cost_basis_total from raw_payload for all rows where it is NULL.
    upd = session.execute(
        text(
            """
            UPDATE public.stock_positions
               SET cost_basis_total = CAST(raw_payload->>'costBasisMoney' AS NUMERIC)
             WHERE source          = 'flex'
               AND cost_basis_total IS NULL
               AND raw_payload->>'costBasisMoney' IS NOT NULL
               AND raw_payload->>'costBasisMoney' <> ''
            """
        )
    )
    result["updated_cost_basis"] = upd.rowcount if hasattr(upd, "rowcount") else 0

    # Step A2: Parse master XML → build {con_id → position} map for identifier columns.
    if not MASTER_XML.exists():
        logger.warning("Master XML not found at %s — skipping identifier column update", MASTER_XML)
        return result

    parsed = parse_flex_files([MASTER_XML])
    result["read"] = len(parsed.stock_positions)

    for sp in parsed.stock_positions:
        if sp.con_id is None:
            result["skipped"] += 1
            continue
        # Only update if at least one identifier is present in the parsed row.
        if not any([sp.cusip, sp.isin, sp.figi, sp.listing_exchange, sp.security_id, sp.security_id_type]):
            result["skipped"] += 1
            continue
        upd = session.execute(
            text(
                """
                UPDATE public.stock_positions
                   SET listing_exchange  = COALESCE(listing_exchange,  :listing_exchange),
                       cusip             = COALESCE(cusip,             :cusip),
                       isin              = COALESCE(isin,              :isin),
                       figi              = COALESCE(figi,              :figi),
                       security_id       = COALESCE(security_id,       :security_id),
                       security_id_type  = COALESCE(security_id_type,  :security_id_type),
                       accrued_interest  = COALESCE(accrued_interest,  :accrued_interest)
                 WHERE source = 'flex'
                   AND con_id = :con_id
                   AND (
                       listing_exchange  IS NULL OR cusip IS NULL OR isin IS NULL
                       OR figi IS NULL OR security_id IS NULL OR security_id_type IS NULL
                   )
                """
            ),
            {
                "con_id": sp.con_id,
                "listing_exchange": sp.listing_exchange,
                "cusip": sp.cusip,
                "isin": sp.isin,
                "figi": sp.figi,
                "security_id": sp.security_id,
                "security_id_type": sp.security_id_type,
                "accrued_interest": None,  # stocks don't carry accrued_interest in OpenPositions
            },
        )
        if upd.rowcount and upd.rowcount > 0:
            result["updated_identifiers"] += upd.rowcount

    logger.info(
        "Phase A: read=%d updated_identifiers=%d updated_cost_basis=%d skipped=%d",
        result["read"],
        result["updated_identifiers"],
        result["updated_cost_basis"],
        result["skipped"],
    )
    return result


# ---------------------------------------------------------------------------
# Phase B — dividend_payments from options_cash_events
# ---------------------------------------------------------------------------


def run_phase_b(session: Session, dry_run: bool) -> dict[str, int]:
    """Re-route dividend CashTransaction rows from options_cash_events → dividend_payments.

    Uses chunked bulk INSERT ... ON CONFLICT for performance (5 000+ rows; individual
    round-trips to a remote Supabase DB would take 10+ minutes).

    Note: avoids ``::`` cast syntax inside SQLAlchemy text() because the psycopg2 dialect
    interprets ``:name`` as a bind parameter, so ``::timestamptz`` causes a SyntaxError.
    Uses CAST() instead.
    """
    import json as _json

    result: dict[str, int] = {"read": 0, "inserted": 0, "skipped_no_id": 0}

    type_list = ", ".join(f"'{t}'" for t in sorted(_DIVIDEND_ROUTE_TYPES))
    rows = session.execute(
        text(f"SELECT id, raw_payload FROM public.options_cash_events WHERE raw_payload->>'type' IN ({type_list})")
    ).all()

    result["read"] = len(rows)

    payments = []
    for row in rows:
        raw = row[1] if isinstance(row[1], dict) else json.loads(row[1] or "{}")
        dividend = parse_dividend_payment(raw)
        if dividend is None:
            result["skipped_no_id"] += 1
            continue
        payments.append(dividend)

    if not payments:
        logger.info("Phase B: read=%d inserted=0 skipped_no_id=%d", result["read"], result["skipped_no_id"])
        return result

    CHUNK = 300  # Keep parameter count ≤ ~6000 per batch (300 rows × 18 cols = 5400)
    total_affected = 0
    for i in range(0, len(payments), CHUNK):
        chunk = payments[i : i + CHUNK]
        placeholders: list[str] = []
        bind: dict[str, Any] = {}
        for j, d in enumerate(chunk):
            n = i + j  # global index for unique param names
            placeholders.append(
                f"(:ai_{n}, :sym_{n}, :cid_{n}, :desc_{n}, :cur_{n},"
                f" CAST(:dt_{n} AS timestamptz), CAST(:rd_{n} AS date),"
                f" CAST(:sd_{n} AS date), CAST(:xd_{n} AS date),"
                f" CAST(:amt_{n} AS numeric), :typ_{n}, :dtyp_{n},"
                f" :tid_{n}, :txid_{n}, :acid_{n},"
                f" :ss_{n}, :stid_{n}, CAST(:rp_{n} AS jsonb))"
            )
            bind[f"ai_{n}"] = d.account_id
            bind[f"sym_{n}"] = d.symbol
            bind[f"cid_{n}"] = d.con_id
            bind[f"desc_{n}"] = d.description
            bind[f"cur_{n}"] = d.currency
            bind[f"dt_{n}"] = d.date_time.isoformat() if d.date_time else None
            bind[f"rd_{n}"] = d.report_date.isoformat() if d.report_date else None
            bind[f"sd_{n}"] = d.settle_date.isoformat() if d.settle_date else None
            bind[f"xd_{n}"] = d.ex_date.isoformat() if d.ex_date else None
            bind[f"amt_{n}"] = str(d.amount)
            bind[f"typ_{n}"] = d.type
            bind[f"dtyp_{n}"] = d.dividend_type
            bind[f"tid_{n}"] = d.trade_id
            bind[f"txid_{n}"] = d.transaction_id
            bind[f"acid_{n}"] = d.action_id
            bind[f"ss_{n}"] = d.source_section
            bind[f"stid_{n}"] = d.source_transaction_id
            bind[f"rp_{n}"] = _json.dumps(dict(d.raw_payload))

        sql = (
            "INSERT INTO public.dividend_payments ("
            "  account_id, symbol, con_id, description, currency,"
            "  date_time, report_date, settle_date, ex_date,"
            "  amount, type, dividend_type,"
            "  trade_id, transaction_id, action_id,"
            "  source_section, source_transaction_id, raw_payload"
            f") VALUES {', '.join(placeholders)}"
            " ON CONFLICT ON CONSTRAINT dividend_payments_idempotent"
            " DO UPDATE SET"
            "  date_time = excluded.date_time,"
            "  report_date = excluded.report_date,"
            "  settle_date = excluded.settle_date,"
            "  ex_date = excluded.ex_date,"
            "  amount = excluded.amount,"
            "  type = excluded.type,"
            "  dividend_type = excluded.dividend_type,"
            "  raw_payload = excluded.raw_payload"
        )
        upd = session.execute(text(sql), bind)
        total_affected += upd.rowcount if hasattr(upd, "rowcount") else len(chunk)

    result["inserted"] = total_affected
    logger.info(
        "Phase B: read=%d inserted=%d skipped_no_id=%d",
        result["read"],
        result["inserted"],
        result["skipped_no_id"],
    )
    return result


# ---------------------------------------------------------------------------
# Phase C — dividend_accruals from master XML
# ---------------------------------------------------------------------------


def run_phase_c(session: Session, dry_run: bool) -> dict[str, int]:
    """Seed dividend_accruals from ChangeInDividendAccruals + OpenDividendAccruals in master XML."""
    result = {"read": 0, "inserted": 0}

    if not MASTER_XML.exists():
        logger.warning("Master XML not found — skipping Phase C")
        return result

    parsed = parse_flex_files([MASTER_XML])
    result["read"] = len(parsed.dividend_accruals)

    # Group by account_id for _sync_dividend_accruals.
    by_account: dict[str, list[Any]] = {}
    for accrual in parsed.dividend_accruals:
        by_account.setdefault(accrual.account_id, []).append(accrual)

    for account_id_str, accruals in by_account.items():
        # Determine report_date: use the most common report_date in the batch.
        from collections import Counter

        rd_counts: Counter[Any] = Counter(a.report_date for a in accruals if a.report_date)
        report_date = rd_counts.most_common(1)[0][0] if rd_counts else None
        n = _sync_dividend_accruals(session, account_id_str, accruals, report_date)
        result["inserted"] += n

    logger.info("Phase C: read=%d inserted=%d", result["read"], result["inserted"])
    return result


# ---------------------------------------------------------------------------
# Phase D — security_reference from OpenPositions
# ---------------------------------------------------------------------------


def run_phase_d(session: Session, dry_run: bool) -> dict[str, int]:
    """Seed security_reference from STK + BOND OpenPositions in master XML."""
    result = {"read": 0, "upserted": 0}

    if not MASTER_XML.exists():
        logger.warning("Master XML not found — skipping Phase D")
        return result

    parsed = parse_flex_files([MASTER_XML])
    infos: list[FlexSecurityInfo] = []

    for sp in parsed.stock_positions:
        if sp.con_id is None:
            continue
        infos.append(
            FlexSecurityInfo(
                account_id=sp.account_id,
                con_id=sp.con_id,
                symbol=sp.symbol,
                description=sp.description,
                asset_category="STK",
                sub_category=sp.sub_category,
                currency=sp.currency,
                listing_exchange=sp.listing_exchange,
                cusip=sp.cusip,
                isin=sp.isin,
                figi=sp.figi,
                security_id=sp.security_id,
                security_id_type=sp.security_id_type,
                raw_payload=dict(sp.raw_payload),
            )
        )

    for bp in parsed.bond_positions:
        if bp.con_id is None:
            continue
        infos.append(
            FlexSecurityInfo(
                account_id=bp.account_id,
                con_id=bp.con_id,
                symbol=bp.symbol,
                description=bp.description,
                asset_category="BOND",
                sub_category=bp.sub_category,
                currency=bp.currency,
                listing_exchange=bp.listing_exchange,
                cusip=bp.cusip,
                isin=bp.isin,
                figi=bp.figi,
                security_id=bp.security_id,
                security_id_type=bp.security_id_type,
                issuer=bp.issuer,
                maturity=bp.maturity_date,
                raw_payload=dict(bp.raw_payload),
            )
        )

    result["read"] = len(infos)
    if infos:
        result["upserted"] = _upsert_security_reference(session, infos, source="open_positions")

    # FII rows (if present in future XML) take precedence; handled by existing parser routing.
    if parsed.security_infos:
        _upsert_security_reference(session, parsed.security_infos, source="fii")
        result["upserted"] += len(parsed.security_infos)

    logger.info("Phase D: read=%d upserted=%d", result["read"], result["upserted"])
    return result


# ---------------------------------------------------------------------------
# Phase E — bond_holdings from master XML
# ---------------------------------------------------------------------------


def run_phase_e(session: Session, dry_run: bool) -> dict[str, int]:
    """Seed bond_holdings from BOND OpenPositions in master XML.

    Note: ``_sync_bond_positions`` in options_sync.py references ``listing_exchange``
    which is not yet present in the bond_holdings schema (missing from migration
    20260510000200).  This phase implements the INSERT directly against the actual
    schema to work around that bug.  A separate bug note has been filed to track the
    schema gap.
    """
    import json as _json

    result: dict[str, int] = {"read": 0, "inserted": 0}

    if not MASTER_XML.exists():
        logger.warning("Master XML not found — skipping Phase E")
        return result

    parsed = parse_flex_files([MASTER_XML])
    result["read"] = len(parsed.bond_positions)

    if not parsed.bond_positions:
        logger.info("Phase E: no BOND positions found in master XML")
        return result

    # Resolve household_id for each account.
    accounts = _load_accounts(session, account_id=None)
    account_map: dict[str, str] = {}  # account_id → household_id
    for acct in accounts:
        if acct.account_id:
            account_map[acct.account_id] = acct.household_id

    # Group by (account_id, as_of_date) for the delete-then-insert window.
    by_window: dict[tuple[str, str], list[Any]] = {}
    for bp in parsed.bond_positions:
        key = (bp.account_id, bp.as_of_date.isoformat())
        by_window.setdefault(key, []).append(bp)

    inserted = 0
    for (account_id_str, as_of_date_str), bond_rows in by_window.items():
        household_id = account_map.get(account_id_str)
        if not household_id:
            logger.warning("No config for account %s — skipping bond_holdings", account_id_str)
            result["read"] -= len(bond_rows)
            continue

        # Delete existing flex rows for this (household, account, date) window.
        session.execute(
            text(
                "DELETE FROM public.bond_holdings"
                " WHERE household_id = :hid"
                "   AND account_id   = :aid"
                "   AND as_of_date   = :aod"
                "   AND source       = 'flex'"
            ),
            {"hid": household_id, "aid": account_id_str, "aod": as_of_date_str},
        )

        for bp in bond_rows:
            row_id = f"flex_{account_id_str}_{bp.con_id}_{as_of_date_str}"
            session.execute(
                text(
                    "INSERT INTO public.bond_holdings ("
                    "  household_id, id, account_id, as_of_date, source,"
                    "  ticker, con_id, description, sub_category, currency,"
                    "  face_value, maturity_date, coupon_rate,"
                    "  mark_price, market_value, cost_basis_price, cost_basis_total,"
                    "  unrealized_pnl, accrued_interest,"
                    "  cusip, isin, figi, security_id, security_id_type,"
                    "  issuer, raw_payload"
                    ") VALUES ("
                    "  :hid, :id, :aid, :aod, 'flex',"
                    "  :ticker, :con_id, :desc, :sub_cat, :cur,"
                    "  :face_val, :mat_date, :coupon,"
                    "  :mark_px, :mkt_val, :cb_px, :cb_tot,"
                    "  :upnl, :acc_int,"
                    "  :cusip, :isin, :figi, :sec_id, :sec_id_type,"
                    "  :issuer, CAST(:rp AS jsonb)"
                    ") ON CONFLICT (household_id, id) DO UPDATE SET"
                    "  as_of_date       = excluded.as_of_date,"
                    "  mark_price       = excluded.mark_price,"
                    "  market_value     = excluded.market_value,"
                    "  cost_basis_price = excluded.cost_basis_price,"
                    "  cost_basis_total = excluded.cost_basis_total,"
                    "  unrealized_pnl   = excluded.unrealized_pnl,"
                    "  accrued_interest = excluded.accrued_interest,"
                    "  raw_payload      = excluded.raw_payload,"
                    "  updated_at       = now()"
                ),
                {
                    "hid": household_id,
                    "id": row_id,
                    "aid": account_id_str,
                    "aod": bp.as_of_date,
                    "ticker": bp.symbol,
                    "con_id": bp.con_id,
                    "desc": bp.description,
                    "sub_cat": bp.sub_category,
                    "cur": bp.currency,
                    "face_val": bp.quantity,
                    "mat_date": bp.maturity_date,
                    "coupon": bp.coupon_rate,
                    "mark_px": bp.mark_price,
                    "mkt_val": bp.market_value,
                    "cb_px": bp.cost_basis_price,
                    "cb_tot": bp.cost_basis_total,
                    "upnl": bp.unrealized_pnl,
                    "acc_int": bp.accrued_interest,
                    "cusip": bp.cusip,
                    "isin": bp.isin,
                    "figi": bp.figi,
                    "sec_id": bp.security_id,
                    "sec_id_type": bp.security_id_type,
                    "issuer": bp.issuer or "",
                    "rp": _json.dumps(dict(bp.raw_payload)),
                },
            )
            inserted += 1

    result["inserted"] = inserted
    logger.info("Phase E: read=%d inserted=%d", result["read"], result["inserted"])
    return result


# ---------------------------------------------------------------------------
# CLI / orchestration
# ---------------------------------------------------------------------------

PHASE_RUNNERS = {
    "A": run_phase_a,
    "B": run_phase_b,
    "C": run_phase_c,
    "D": run_phase_d,
    "E": run_phase_e,
}

PHASE_DESCRIPTIONS = {
    "A": "stock_positions: update identifier columns + cost_basis_total",
    "B": "dividend_payments: re-route from options_cash_events",
    "C": "dividend_accruals: seed from master XML",
    "D": "security_reference: seed from OpenPositions",
    "E": "bond_holdings: seed from master XML BOND rows",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI flags."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would happen without writing to the database",
    )
    parser.add_argument(
        "--phase",
        default="A,B,C,D,E",
        help="Comma-separated phases to run (default: A,B,C,D,E)",
    )
    return parser.parse_args(argv)


def _print_summary(phase_results: dict[str, dict[str, int] | str]) -> None:
    """Print a summary table of all phase results."""
    header = f"{'Phase':<6} {'Source':<40} {'Read':>8} {'Inserted':>10} {'Updated':>9} {'Skipped':>8}"
    sep = "-" * len(header)
    print()
    print(sep)
    print(header)
    print(sep)
    for phase, result in phase_results.items():
        if isinstance(result, str):
            print(f"{phase:<6} {'ERROR: ' + result[:35]:<40}")
            continue
        read = result.get("read", 0)
        inserted = result.get("inserted", result.get("upserted", 0))
        updated = result.get("updated_identifiers", result.get("updated_cost_basis", 0))
        skipped = result.get("skipped", result.get("skipped_no_id", 0))
        desc = PHASE_DESCRIPTIONS.get(phase, "")
        print(f"{phase:<6} {desc:<40} {read:>8} {inserted:>10} {updated:>9} {skipped:>8}")
    print(sep)
    print()


def main(argv: list[str] | None = None) -> int:
    """Run the backfill and return exit code."""
    args = parse_args(argv)
    phases = [p.strip().upper() for p in args.phase.split(",") if p.strip()]
    unknown = [p for p in phases if p not in PHASE_RUNNERS]
    if unknown:
        logger.error("Unknown phases: %s. Valid: A B C D E", unknown)
        return 1

    if args.dry_run:
        logger.info("=== DRY RUN — no data will be written ===")

    logger.info("Phases to run: %s", phases)
    logger.info("Master XML: %s (exists=%s)", MASTER_XML, MASTER_XML.exists())

    phase_results: dict[str, dict[str, int] | str] = {}

    with Session(engine) as session:
        for phase in phases:
            logger.info("--- Phase %s: %s ---", phase, PHASE_DESCRIPTIONS[phase])
            try:
                result = PHASE_RUNNERS[phase](session, args.dry_run)
                phase_results[phase] = result
            except Exception as exc:
                logger.exception("Phase %s failed: %s", phase, exc)
                phase_results[phase] = str(exc)
                # Rollback the failed transaction so subsequent phases can run.
                try:
                    session.rollback()
                except Exception:
                    pass
                continue

        if args.dry_run:
            session.rollback()
            logger.info("Dry run complete — rolled back all changes")
        else:
            session.commit()
            logger.info("All phases committed")

    _print_summary(phase_results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
