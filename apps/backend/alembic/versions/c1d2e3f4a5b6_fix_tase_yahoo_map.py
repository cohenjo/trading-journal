"""fix_tase_yahoo_map

Corrects the tase_yahoo_map seed data from PR #400: all 11 original entries
had incorrect paper_id → company assignments. This migration:

  - Updates 7 entries with verified correct Yahoo tickers (confirmed via
    Bizportal and Yahoo Finance API — info.currency == 'ILA' for all TASE tickers)
  - Deletes 4 entries whose paper IDs belong to index-tracking ETFs/funds
    (iShares, Kasam, MTF) that do not have a confirmed individual-stock Yahoo ticker

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-05-11 21:14:00.000000

Verification sources:
  - https://www.bizportal.co.il/capitalmarket/quote/shares/<paper_id>
  - yfinance: all confirmed tickers return info.currency == 'ILA' (agorot)
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "c1d2e3f4a5b6"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Fix 7 entries with verified correct ticker + updated notes
    op.execute(
        """
        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'LUMI.TA',
            notes        = 'Bank Leumi le-Israel (לאומי) — paper 604611 confirmed via Bizportal'
        WHERE tase_paper = '604611';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'POLI.TA',
            notes        = 'Bank Hapoalim (פועלים) — paper 662577 confirmed via Bizportal'
        WHERE tase_paper = '662577';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'MTAV.TA',
            notes        = 'Meitav Investments (מיטב השקעות) — paper 1081843 confirmed via Bizportal'
        WHERE tase_paper = '1081843';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'CLIS.TA',
            notes        = 'Clal Business Insurance (כלל עסקי ביטוח) — paper 224014 confirmed via Bizportal'
        WHERE tase_paper = '224014';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'RATI.TA',
            notes        = 'Ratio Energies (רציו יהש) — paper 394015 confirmed via Bizportal'
        WHERE tase_paper = '394015';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'NWMD.TA',
            notes        = 'NewMed Energy (ניו-מד אנרג) — paper 475020 confirmed via Bizportal'
        WHERE tase_paper = '475020';

        UPDATE tase_yahoo_map
        SET yahoo_ticker = 'RIT1.TA',
            notes        = 'REIT 1 (ריט 1) — paper 1098920 confirmed via Yahoo Finance'
        WHERE tase_paper = '1098920';
        """
    )

    # Delete 4 ETF/fund entries: paper IDs belong to index-tracking instruments
    # (iShares MSCI EM ETF, Kasam ETF x2, MTF TA-125) — no confirmed Yahoo ticker
    op.execute(
        """
        DELETE FROM tase_yahoo_map
        WHERE tase_paper IN ('1145911', '1146067', '1150283', '1159169');
        """
    )

    # Null out the stale yahoo_ticker values stored against the 4 deleted ETF positions
    op.execute(
        """
        UPDATE stock_positions
        SET yahoo_ticker = NULL, prices_refreshed_at = NULL
        WHERE ticker IN ('1145911', '1146067', '1150283', '1159169');
        """
    )


def downgrade() -> None:
    # Restore the original (incorrect) seed values — kept for completeness
    op.execute(
        """
        INSERT INTO tase_yahoo_map (tase_paper, yahoo_ticker, notes) VALUES
          ('1145911', 'ALHE.TA', 'Alony-Hetz Properties & Investments'),
          ('1146067', 'PHOE.TA', 'Phoenix Holdings'),
          ('1150283', 'MGDL.TA', 'Migdal Insurance Group'),
          ('1159169', 'AZRG.TA', 'Azrieli Group')
        ON CONFLICT DO NOTHING;

        UPDATE tase_yahoo_map SET yahoo_ticker = 'MZTF.TA', notes = 'Mizrahi Tefahot Bank'
          WHERE tase_paper = '604611';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'DSCT.TA', notes = 'Israel Discount Bank'
          WHERE tase_paper = '662577';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'LUMI.TA', notes = 'Bank Leumi le-Israel'
          WHERE tase_paper = '1081843';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'POLI.TA', notes = 'Bank Hapoalim'
          WHERE tase_paper = '224014';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'HARL.TA', notes = 'Harel Insurance'
          WHERE tase_paper = '394015';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'FTIN.TA', notes = 'First International Bank of Israel'
          WHERE tase_paper = '475020';
        UPDATE tase_yahoo_map SET yahoo_ticker = 'JBNK.TA', notes = 'Bank of Jerusalem'
          WHERE tase_paper = '1098920';
        """
    )
