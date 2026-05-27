"""add_dividend_yield_to_price_cache

Adds a nullable ``dividend_yield`` column to ``price_cache`` so the RSU plan
hydration worker can persist trailing 12-month yield alongside spot price.

CONVENTION: ``price_cache.dividend_yield`` is stored as percentage form
(0.87 = 0.87%).  See ``apps/backend/app/services/price_cache.py`` for the
boundary helper ``_yfinance_yield_to_percent()`` that normalises yfinance's
decimal fraction (0.0087) before any DB write, and ``plan_components.py:427``
for the consumer (``acc['value'] * (yield_rate / 100.0)``).

NB: ``public.stock_positions.dividend_yield`` uses the older decimal-fraction
convention (canonicalised in Supabase migration 20260511230000).  Different
table, different convention — do NOT change.

Revision ID: e5f6a7b8c9d0
Revises: c1d2e3f4a5b6
Create Date: 2026-05-27 22:00:00.000000
"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "price_cache",
        sa.Column("dividend_yield", sa.Numeric(18, 8), nullable=True),
    )
    op.execute(
        """
        COMMENT ON COLUMN public.price_cache.dividend_yield IS
        'Trailing 12-month dividend yield as percentage form (0.87 = 0.87%). '
        'NULL when the symbol pays no dividend or yield is unavailable.'
        """
    )


def downgrade() -> None:
    op.drop_column("price_cache", "dividend_yield")
