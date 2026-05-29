"""One-shot script: backfill category_id / subcategory_id / is_transfer / resolution_status
on credit_card_transactions rows that were inserted before expense_categories was seeded.

Usage (from apps/backend/):
    uv run python scripts/recategorize_credit_card_txns.py

Idempotent: only touches rows where resolution_status = 'unresolved' OR category_id IS NULL.
Safe to re-run.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

# Ensure apps/backend is on sys.path so `app.*` imports resolve when run from repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.services.expenses.categorize import CategoryResolver  # noqa: E402


@dataclass
class _Txn:
    merchant_raw: str
    merchant_normalized: str
    sector_raw: Optional[str]


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DIRECT_SESSION_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("ERROR: set SUPABASE_DIRECT_SESSION_URL or DATABASE_URL")
    return url


def main() -> int:
    household_id_env = os.environ.get("CREDIT_CARD_RECATEGORIZE_HOUSEHOLD_ID")
    if not household_id_env:
        raise SystemExit("ERROR: set CREDIT_CARD_RECATEGORIZE_HOUSEHOLD_ID")
    household_id = UUID(household_id_env)

    engine = create_engine(_db_url(), future=True)
    resolver = CategoryResolver()

    select_sql = text(
        """
        SELECT id, merchant_raw, merchant_normalized, sector_raw, household_id
          FROM credit_card_transactions
         WHERE household_id = :hid
           AND (resolution_status = 'unresolved' OR category_id IS NULL)
        """
    )
    update_sql = text(
        """
        UPDATE credit_card_transactions
           SET category_id = :category_id,
               subcategory_id = :subcategory_id,
               resolution_status = :resolution_status,
               resolution_source = :resolution_source
         WHERE id = :tid
        """
    )

    counts = {"matched": 0, "still_unresolved": 0, "transfer": 0, "auto_rule": 0}

    with Session(engine, future=True) as session:
        rows = session.execute(select_sql, {"hid": str(household_id)}).all()
        print(f"Loaded {len(rows)} candidate transactions to recategorize.")

        for row in rows:
            txn = _Txn(
                merchant_raw=row.merchant_raw or "",
                merchant_normalized=row.merchant_normalized or row.merchant_raw or "",
                sector_raw=row.sector_raw,
            )
            assignment = resolver.resolve(txn, session, household_id)
            session.execute(
                update_sql,
                {
                    "tid": row.id,
                    "category_id": str(assignment.category_id) if assignment.category_id else None,
                    "subcategory_id": str(assignment.subcategory_id) if assignment.subcategory_id else None,
                    "resolution_status": assignment.resolution_status,
                    "resolution_source": assignment.resolution_source,
                },
            )
            if assignment.category_id:
                counts["matched"] += 1
                if assignment.is_transfer:
                    counts["transfer"] += 1
                else:
                    counts["auto_rule"] += 1
            else:
                counts["still_unresolved"] += 1

        session.commit()

    total = counts["matched"] + counts["still_unresolved"]
    print()
    print(f"Recategorization complete. Total examined: {total}")
    print(f"  matched (any category): {counts['matched']}")
    print(f"    of which transfer  : {counts['transfer']}")
    print(f"    of which auto-rule : {counts['auto_rule']}")
    print(f"  still unresolved     : {counts['still_unresolved']}")
    if total:
        pct = 100.0 * counts["matched"] / total
        print(f"  match rate           : {pct:.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
