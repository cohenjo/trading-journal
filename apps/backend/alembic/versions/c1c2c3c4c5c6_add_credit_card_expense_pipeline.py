"""add_credit_card_expense_pipeline

Creates 5 tables for the credit-card expense analysis pipeline:
    - expense_inbox           (ingest queue)
    - credit_card_statements  (one row per parsed PDF)
    - credit_card_transactions (one row per line-item)
    - expense_categories      (global hierarchical taxonomy)
    - merchant_category_mappings (learned merchant→category mappings)

AMOUNT CONVENTIONS:
    amount_ils      NUMERIC(12,2)  ILS shekels (NOT agorot). e.g. 126.00 = ₪126.
    amount_original NUMERIC(14,4)  original foreign-currency units
    fx_rate         NUMERIC(12,8)  ILS per 1 unit of original_currency

RLS policies are handled in the Supabase migration only (not applicable here).
Prod uses Supabase migrations; this Alembic file keeps the dev chain valid for
any developer running ``uv run alembic upgrade head``.

Category seeding deferred to CC-3 (McManus, taxonomy YAML).

Revision ID: c1c2c3c4c5c6
Revises: f2a3b4c5d6e7
Create Date: 2026-05-29 12:25:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c1c2c3c4c5c6"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------
    # 1. expense_inbox — ingest queue
    # ----------------------------------------------------------
    op.create_table(
        "expense_inbox",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column(
            "file_hash",
            sa.Text(),
            nullable=False,
            comment="SHA-256 hex digest of raw file bytes. Dedup gate.",
        ),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default="pending",
            comment="pending|processing|completed|errored|duplicate",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "submitted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("processed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("household_id", sa.UUID(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_hash", name="expense_inbox_file_hash_unique"),
        sa.CheckConstraint(
            "status in ('pending', 'processing', 'completed', 'errored', 'duplicate')",
            name="expense_inbox_status_check",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["households.id"],
        ),
        schema="public",
    )
    op.create_index(
        "expense_inbox_status_submitted_at_idx",
        "expense_inbox",
        ["status", "submitted_at"],
        schema="public",
    )

    # ----------------------------------------------------------
    # 2. expense_categories — global hierarchical taxonomy
    #    (created before statements/transactions due to FK dependencies)
    # ----------------------------------------------------------
    op.create_table(
        "expense_categories",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("slug", sa.Text(), nullable=False, comment='Machine key e.g. "travel.flights"'),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_he", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "is_transfer",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment=(
                "When true, transactions in this category are transfers (PayBox etc.) excluded from expense totals."
            ),
        ),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column(
            "color",
            sa.Text(),
            nullable=True,
            comment='Hex color for chart palette, e.g. "#4A90E2".',
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="expense_categories_slug_unique"),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["expense_categories.id"],
        ),
        schema="public",
    )
    op.create_index(
        "expense_categories_parent_order_idx",
        "expense_categories",
        ["parent_id", "display_order"],
        schema="public",
    )

    # ----------------------------------------------------------
    # 3. credit_card_statements — one row per parsed PDF
    # ----------------------------------------------------------
    op.create_table(
        "credit_card_statements",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("inbox_id", sa.UUID(), nullable=True),
        sa.Column(
            "file_hash",
            sa.Text(),
            nullable=False,
            comment="SHA-256 hex digest. Mirrors expense_inbox.file_hash for dedup.",
        ),
        sa.Column("source_file_path", sa.Text(), nullable=False),
        sa.Column(
            "issuer",
            sa.Text(),
            nullable=False,
            comment="cal|cal_paybox|max|isracard|other",
        ),
        sa.Column(
            "cardholder_name",
            sa.Text(),
            nullable=False,
            comment=("Free-text name as extracted from PDF. No FK to household_members (by design, keep simple)."),
        ),
        sa.Column("card_last4", sa.CHAR(4), nullable=False),
        sa.Column("period_from", sa.Date(), nullable=False),
        sa.Column("period_to", sa.Date(), nullable=False),
        sa.Column(
            "total_amount_ils",
            sa.Numeric(12, 2),
            nullable=True,
            comment="Total period charges in ILS (shekels, NOT agorot). NUMERIC(12,2).",
        ),
        sa.Column("txn_count", sa.Integer(), nullable=True),
        sa.Column(
            "parse_warnings",
            sa.JSON(),
            nullable=False,
            server_default="[]",
            comment="Array of parser warning strings.",
        ),
        sa.Column(
            "ingested_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("household_id", sa.UUID(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_hash", name="credit_card_statements_file_hash_unique"),
        sa.CheckConstraint(
            "issuer in ('cal', 'cal_paybox', 'max', 'isracard', 'other')",
            name="credit_card_statements_issuer_check",
        ),
        sa.ForeignKeyConstraint(["inbox_id"], ["expense_inbox.id"]),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"]),
        schema="public",
    )
    op.create_index(
        "credit_card_statements_cardholder_period_idx",
        "credit_card_statements",
        ["cardholder_name", "period_from"],
        schema="public",
    )
    op.create_index(
        "credit_card_statements_issuer_period_idx",
        "credit_card_statements",
        ["issuer", "period_from"],
        schema="public",
    )

    # ----------------------------------------------------------
    # 4. credit_card_transactions — one row per line-item
    # ----------------------------------------------------------
    op.create_table(
        "credit_card_transactions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("statement_id", sa.UUID(), nullable=False),
        sa.Column("txn_date", sa.Date(), nullable=False),
        sa.Column("posting_date", sa.Date(), nullable=True),
        sa.Column("merchant_raw", sa.Text(), nullable=False),
        sa.Column("merchant_normalized", sa.Text(), nullable=False),
        sa.Column(
            "amount_ils",
            sa.Numeric(12, 2),
            nullable=False,
            comment=("Charge in ILS (shekels, NOT agorot). Positive=debit, negative=credit/refund. NUMERIC(12,2)."),
        ),
        sa.Column(
            "amount_original",
            sa.Numeric(14, 4),
            nullable=True,
            comment="Original foreign-currency amount. NUMERIC(14,4).",
        ),
        sa.Column(
            "original_currency",
            sa.CHAR(3),
            nullable=True,
            comment="ISO 4217 currency code, e.g. 'USD', 'EUR'.",
        ),
        sa.Column(
            "fx_rate",
            sa.Numeric(12, 8),
            nullable=True,
            comment="ILS per 1 unit of original_currency. NUMERIC(12,8).",
        ),
        sa.Column(
            "installment_num",
            sa.Integer(),
            nullable=True,
            comment="1-based installment index. NULL for non-installment transactions.",
        ),
        sa.Column(
            "installment_total",
            sa.Integer(),
            nullable=True,
            comment="Total installments for this purchase. NULL if not installment.",
        ),
        sa.Column(
            "sector_raw",
            sa.Text(),
            nullable=True,
            comment="Raw Hebrew ענף (sector) field from Cal/Isracard. NULL for Max.",
        ),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("subcategory_id", sa.UUID(), nullable=True),
        sa.Column(
            "resolution_status",
            sa.Text(),
            nullable=False,
            server_default="unresolved",
            comment=(
                "auto|user_confirmed|unresolved|transfer. transfer = PayBox/UP transfers excluded from expense totals."
            ),
        ),
        sa.Column(
            "resolution_source",
            sa.Text(),
            nullable=True,
            comment="sector|rule|mapping|user — how the category was determined.",
        ),
        sa.Column("household_id", sa.UUID(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "resolution_status in ('auto', 'user_confirmed', 'unresolved', 'transfer')",
            name="credit_card_transactions_resolution_status_check",
        ),
        sa.CheckConstraint(
            "resolution_source is null or resolution_source in ('sector', 'rule', 'mapping', 'user')",
            name="credit_card_transactions_resolution_source_check",
        ),
        sa.CheckConstraint(
            "original_currency is null or length(original_currency) = 3",
            name="credit_card_transactions_currency_length_check",
        ),
        sa.ForeignKeyConstraint(
            ["statement_id"],
            ["credit_card_statements.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"]),
        sa.ForeignKeyConstraint(["subcategory_id"], ["expense_categories.id"]),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"]),
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_txn_date_idx",
        "credit_card_transactions",
        ["txn_date"],
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_merchant_normalized_idx",
        "credit_card_transactions",
        ["merchant_normalized"],
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_unresolved_idx",
        "credit_card_transactions",
        ["resolution_status"],
        postgresql_where=sa.text("resolution_status = 'unresolved'"),
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_category_txn_date_idx",
        "credit_card_transactions",
        ["category_id", "txn_date"],
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_statement_id_idx",
        "credit_card_transactions",
        ["statement_id"],
        schema="public",
    )
    op.create_index(
        "credit_card_transactions_household_txn_date_idx",
        "credit_card_transactions",
        ["household_id", "txn_date"],
        schema="public",
    )

    # ----------------------------------------------------------
    # 5. merchant_category_mappings — learned merchant→category
    # ----------------------------------------------------------
    op.create_table(
        "merchant_category_mappings",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "merchant_normalized",
            sa.Text(),
            nullable=False,
            comment="Normalized merchant name matching credit_card_transactions.merchant_normalized.",
        ),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("subcategory_id", sa.UUID(), nullable=True),
        sa.Column(
            "confidence",
            sa.Numeric(3, 2),
            nullable=False,
            server_default="1.00",
            comment="0.00–1.00. 1.00 = user-confirmed or deterministic rule.",
        ),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            comment="rule|user|inferred",
        ),
        sa.Column(
            "match_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Times this mapping was applied during auto-categorization.",
        ),
        sa.Column(
            "created_by",
            sa.Text(),
            nullable=True,
            comment="User id (text) when source='user'.",
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "household_id",
            sa.UUID(),
            nullable=True,
            comment="NULL=global fallback. Non-NULL=household-scoped, takes precedence.",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "confidence >= 0.00 and confidence <= 1.00",
            name="merchant_category_mappings_confidence_range",
        ),
        sa.CheckConstraint(
            "source in ('rule', 'user', 'inferred')",
            name="merchant_category_mappings_source_check",
        ),
        sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"]),
        sa.ForeignKeyConstraint(["subcategory_id"], ["expense_categories.id"]),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"]),
        schema="public",
    )
    # Partial unique indexes: one canonical mapping per merchant per household,
    # and one global fallback per merchant.
    op.create_index(
        "merchant_category_mappings_merchant_household_idx",
        "merchant_category_mappings",
        ["merchant_normalized", "household_id"],
        unique=True,
        postgresql_where=sa.text("household_id is not null"),
        schema="public",
    )
    op.create_index(
        "merchant_category_mappings_merchant_global_idx",
        "merchant_category_mappings",
        ["merchant_normalized"],
        unique=True,
        postgresql_where=sa.text("household_id is null"),
        schema="public",
    )
    op.create_index(
        "merchant_category_mappings_merchant_idx",
        "merchant_category_mappings",
        ["merchant_normalized"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_table("merchant_category_mappings", schema="public")
    op.drop_table("credit_card_transactions", schema="public")
    op.drop_table("credit_card_statements", schema="public")
    op.drop_table("expense_categories", schema="public")
    op.drop_table("expense_inbox", schema="public")
