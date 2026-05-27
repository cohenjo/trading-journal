"""normalize_price_cache_yield_to_percent

One-shot data migration: converts any existing ``price_cache.dividend_yield``
rows that were written in decimal-fraction form (0.0087 for 0.87%) to the
canonical percentage form (0.87 for 0.87%).

CONVENTION (project-wide): ``dividend_yield`` is stored as percentage form.
``plan_components.py`` uses ``acc['value'] * (yield_rate / 100.0)``, treating
the stored value as percentage (0.87 → 0.0087 after /100).  The UI input also
shows percentage form with a "%" label.  yfinance returns decimal fraction
(0.0087) — normalisation happens in ``_yfinance_yield_to_percent()`` inside
``price_cache.py`` before any DB write.

Idempotency: only rows with ``dividend_yield < 1`` are updated.  Any row
already in percentage form (>= 1) is untouched.  Re-running this migration
against an already-migrated database is safe.

Revision ID: f2a3b4c5d6e7
Revises: e5f6a7b8c9d0
Create Date: 2026-05-27 22:15:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "f2a3b4c5d6e7"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Multiply decimal-fraction yields (< 1) by 100 to convert to percentage form.
    # Values already in percentage form (>= 1) are left unchanged (idempotent guard).
    # NULL values are skipped automatically by the WHERE clause.
    op.execute(
        """
        UPDATE public.price_cache
           SET dividend_yield = dividend_yield * 100
         WHERE dividend_yield IS NOT NULL
           AND dividend_yield > 0
           AND dividend_yield < 1
        """
    )

    # Update the column comment to reflect the new convention.
    op.execute(
        """
        COMMENT ON COLUMN public.price_cache.dividend_yield IS
        'Trailing 12-month dividend yield as percentage form (0.87 = 0.87%). '
        'NULL when the symbol pays no dividend or yield is unavailable.'
        """
    )


def downgrade() -> None:
    # Convert percentage form back to decimal fraction for rollback.
    op.execute(
        """
        UPDATE public.price_cache
           SET dividend_yield = dividend_yield / 100
         WHERE dividend_yield IS NOT NULL
           AND dividend_yield > 0
        """
    )
