"""Seed manual stock positions for non-Flex accounts (Schwab, LeumiIRA).

Usage
-----
  uv run python scripts/seed_manual_account_positions.py \\
      --csv path/to/holdings.csv \\
      --account-id 71 \\
      --as-of-date 2026-05-10

CSV format (comma-separated, header required)
----------------------------------------------
  ticker,quantity,cost_basis,currency
  SCHD,150.0,26.50,USD
  VYM,200.0,108.35,USD
  AAPL,12.0,,USD      <- cost_basis blank = NULL

Required columns: ticker, quantity
Optional columns: cost_basis (per-share average; omit or leave blank = NULL)
                  currency (default: USD)

Constraints
-----------
- account_id must exist in trading_account_config and must NOT be an 'ibkr'
  account (IBKR positions come from Flex sync).
- Script is idempotent: re-running with the same CSV + as_of_date will DELETE
  any existing manual rows for matching (account_id, ticker, as_of_date) then
  re-INSERT with the new values.  Only source='manual' rows are touched.

Environment
-----------
Requires DATABASE_URL or SUPABASE_DB_URL set in the environment (or .env).
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap project path so we can import app.*
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_env() -> None:
    """Load .env from apps/backend if python-dotenv is available."""
    try:
        from dotenv import load_dotenv

        env_path = Path(__file__).resolve().parent.parent / ".env"
        load_dotenv(env_path)
    except ImportError:
        pass


def _parse_csv(path: str) -> list[dict[str, str | None]]:
    """Read CSV rows; return list of dicts."""
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for lineno, row in enumerate(reader, start=2):
            rows.append({"_lineno": lineno, **row})
    return rows


def _parse_decimal_or_none(value: str | None) -> Decimal | None:
    if not value or not value.strip():
        return None
    try:
        return Decimal(value.strip())
    except InvalidOperation:
        raise ValueError(f"Invalid decimal value: {value!r}")


def _get_engine():  # type: ignore[return]
    """Return a SQLAlchemy engine connected to the Supabase DB."""
    from sqlalchemy import create_engine

    url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("SUPABASE_DB_URL")
        or os.environ.get("SUPABASE_DIRECT_SESSION_URL")
    )
    if not url:
        logger.error(
            "Set DATABASE_URL, SUPABASE_DB_URL, or SUPABASE_DIRECT_SESSION_URL to a direct Postgres connection string."
        )
        sys.exit(1)
    return create_engine(url, echo=False)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def _resolve_household(conn, account_id: int) -> str | None:
    """Return household_id for the account, or None if account not found."""
    from sqlalchemy import text

    row = (
        conn.execute(
            text(
                """
            SELECT household_id, account_type
              FROM public.trading_account_config
             WHERE id = :id AND deleted_at IS NULL
            """
            ),
            {"id": account_id},
        )
        .mappings()
        .first()
    )
    return row  # type: ignore[return-value]


def seed_positions(
    csv_path: str,
    account_id: int,
    as_of_date: date,
    *,
    dry_run: bool = False,
) -> int:
    """Insert/upsert manual stock positions from CSV.

    Returns the number of rows upserted.
    """
    from sqlalchemy import text

    rows = _parse_csv(csv_path)
    if not rows:
        logger.warning("CSV is empty — nothing to insert.")
        return 0

    engine = _get_engine()
    with engine.begin() as conn:
        account_row = _resolve_household(conn, account_id)
        if account_row is None:
            logger.error("Account id=%d not found in trading_account_config.", account_id)
            sys.exit(1)

        account_type = (account_row["account_type"] or "").lower()
        household_id = str(account_row["household_id"])

        if account_type == "ibkr":
            logger.error(
                "Account %d is type 'ibkr' — cannot seed manual positions. IBKR holdings come from the Flex sync.",
                account_id,
            )
            sys.exit(1)

        logger.info(
            "Seeding manual positions: account_id=%d (%s), as_of_date=%s, household=%s",
            account_id,
            account_type,
            as_of_date,
            household_id,
        )

        upserted = 0
        for row in rows:
            lineno = row.pop("_lineno", "?")
            ticker = (row.get("ticker") or "").strip().upper()
            if not ticker:
                logger.warning("Line %s: blank ticker — skipped.", lineno)
                continue

            try:
                quantity = _parse_decimal_or_none(row.get("quantity"))
            except ValueError as exc:
                logger.warning("Line %s ticker=%s: %s — skipped.", lineno, ticker, exc)
                continue

            if quantity is None or quantity <= 0:
                logger.warning("Line %s ticker=%s: quantity must be > 0 — skipped.", lineno, ticker)
                continue

            try:
                cost_basis = _parse_decimal_or_none(row.get("cost_basis"))
            except ValueError as exc:
                logger.warning("Line %s ticker=%s: cost_basis error %s — using NULL.", lineno, ticker, exc)
                cost_basis = None

            currency = (row.get("currency") or "USD").strip().upper() or "USD"

            params = {
                "household_id": household_id,
                "account_id": account_id,
                "ticker": ticker,
                "quantity": str(quantity),
                "cost_basis": str(cost_basis) if cost_basis is not None else None,
                "currency": currency,
                "as_of_date": str(as_of_date),
            }

            if dry_run:
                logger.info(
                    "  DRY-RUN: would upsert %s qty=%s cost=%s %s",
                    ticker,
                    quantity,
                    cost_basis,
                    currency,
                )
                upserted += 1
                continue

            conn.execute(
                text(
                    """
                    WITH del AS (
                      DELETE FROM public.stock_positions
                       WHERE source = 'manual'
                         AND account_id = :account_id
                         AND ticker = :ticker
                         AND as_of_date = :as_of_date
                    )
                    INSERT INTO public.stock_positions
                      (household_id, account_id, ticker, quantity, cost_basis,
                       currency, as_of_date, source)
                    VALUES
                      (:household_id, :account_id, :ticker, :quantity, :cost_basis,
                       :currency, :as_of_date, 'manual')
                    """
                ),
                params,
            )
            upserted += 1
            logger.info("  upserted %s qty=%s cost=%s %s", ticker, quantity, cost_basis, currency)

    if dry_run:
        logger.info("DRY-RUN complete: %d rows would be upserted (no changes made).", upserted)
    else:
        logger.info("Done: %d rows upserted for account_id=%d.", upserted, account_id)

    return upserted


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--csv",
        required=True,
        metavar="FILE",
        help="Path to CSV file with columns: ticker, quantity[, cost_basis][, currency]",
    )
    parser.add_argument(
        "--account-id",
        required=True,
        type=int,
        metavar="ID",
        help="trading_account_config.id of the Schwab or LeumiIRA account",
    )
    parser.add_argument(
        "--as-of-date",
        required=True,
        metavar="YYYY-MM-DD",
        help="Snapshot date for the positions (e.g. 2026-05-10)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would be inserted without writing to the DB",
    )
    return parser.parse_args()


def main() -> None:
    _load_env()
    args = _parse_args()

    try:
        as_of = date.fromisoformat(args.as_of_date)
    except ValueError:
        logger.error("--as-of-date must be YYYY-MM-DD, got: %s", args.as_of_date)
        sys.exit(1)

    seed_positions(args.csv, args.account_id, as_of, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
