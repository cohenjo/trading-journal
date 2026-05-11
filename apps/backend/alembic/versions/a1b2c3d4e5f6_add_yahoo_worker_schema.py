"""add_yahoo_worker_schema

Adds schema support for the Yahoo Finance daily price refresh worker (#395):
  - stock_positions.prices_refreshed_at: tracks when Yahoo last refreshed this row
  - stock_positions.yahoo_ticker: cached resolved Yahoo ticker for debugging
  - tase_yahoo_map: TASE paper number → Yahoo ticker override table with seed data

Revision ID: a1b2c3d4e5f6
Revises: fb4bdd3a199b
Create Date: 2026-05-11 19:41:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "fb4bdd3a199b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to stock_positions
    op.add_column(
        "stock_positions",
        sa.Column("prices_refreshed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "stock_positions",
        sa.Column("yahoo_ticker", sa.Text(), nullable=True),
    )

    # Create TASE → Yahoo override map table
    op.create_table(
        "tase_yahoo_map",
        sa.Column("tase_paper", sa.Text(), primary_key=True, nullable=False),
        sa.Column("yahoo_ticker", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "added_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=True,
        ),
    )

    # Seed known TASE paper → Yahoo ticker mappings
    op.execute(
        """
        INSERT INTO tase_yahoo_map (tase_paper, yahoo_ticker, notes) VALUES
          ('1081843', 'LUMI.TA', 'Bank Leumi le-Israel'),
          ('224014',  'POLI.TA', 'Bank Hapoalim'),
          ('604611',  'MZTF.TA', 'Mizrahi Tefahot Bank'),
          ('475020',  'FTIN.TA', 'First International Bank of Israel'),
          ('662577',  'DSCT.TA', 'Israel Discount Bank'),
          ('394015',  'HARL.TA', 'Harel Insurance'),
          ('1150283', 'MGDL.TA', 'Migdal Insurance Group'),
          ('1146067', 'PHOE.TA', 'Phoenix Holdings'),
          ('1145911', 'ALHE.TA', 'Alony-Hetz Properties & Investments'),
          ('1159169', 'AZRG.TA', 'Azrieli Group'),
          ('1098920', 'JBNK.TA', 'Bank of Jerusalem')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("tase_yahoo_map")
    op.drop_column("stock_positions", "yahoo_ticker")
    op.drop_column("stock_positions", "prices_refreshed_at")
