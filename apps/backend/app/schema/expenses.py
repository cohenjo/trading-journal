"""SQLModel ORM classes for the credit-card expense analysis pipeline.

Tables:
    - ExpenseInbox               (expense_inbox)
    - CreditCardStatement        (credit_card_statements)
    - CreditCardTransaction      (credit_card_transactions)
    - ExpenseCategory            (expense_categories)
    - MerchantCategoryMapping    (merchant_category_mappings)

AMOUNT CONVENTIONS:
    amount_ils      Decimal  NUMERIC(12,2)  — shekels (ILS). NOT agorot.
    amount_original Decimal  NUMERIC(14,4)  — original foreign-currency units
    fx_rate         Decimal  NUMERIC(12,8)  — ILS per 1 unit of original_currency
"""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import Column, JSON, Numeric, text
from sqlmodel import Field, SQLModel


class ExpenseInbox(SQLModel, table=True):
    """Ingest queue: one row per submitted PDF file.

    Provides dedup via ``file_hash`` (SHA-256 hex of raw bytes) before any
    parsing work is attempted.  Status transitions:
    pending → processing → completed | errored | duplicate
    """

    __tablename__ = "expense_inbox"

    id: UUID = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"server_default": text("gen_random_uuid()")},
    )
    file_path: str = Field(nullable=False)
    file_hash: str = Field(
        nullable=False,
        description="SHA-256 hex digest of raw file bytes.  Dedup gate.",
    )
    file_size_bytes: Optional[int] = Field(default=None)
    status: str = Field(
        default="pending",
        description="pending|processing|completed|errored|duplicate",
    )
    error_message: Optional[str] = Field(default=None)
    retry_count: int = Field(default=0)
    submitted_at: datetime = Field(
        default=None,
        sa_column_kwargs={"server_default": text("now()")},
    )
    processed_at: Optional[datetime] = Field(default=None)
    household_id: Optional[UUID] = Field(
        default=None,
        foreign_key="households.id",
        index=True,
    )


class CreditCardStatement(SQLModel, table=True):
    """One row per successfully parsed credit-card statement PDF.

    ``file_hash`` mirrors ``expense_inbox.file_hash`` and enforces a unique
    constraint so re-ingesting the same PDF is a safe no-op.

    ``cardholder_name`` is stored as free text extracted from the PDF — no FK
    to ``household_members`` (by design, keep simple; FK can be added later).
    """

    __tablename__ = "credit_card_statements"

    id: UUID = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"server_default": text("gen_random_uuid()")},
    )
    inbox_id: Optional[UUID] = Field(default=None, foreign_key="expense_inbox.id")
    file_hash: str = Field(
        nullable=False,
        description="SHA-256 hex digest — mirrors expense_inbox.file_hash.",
    )
    source_file_path: str = Field(nullable=False)
    issuer: str = Field(
        nullable=False,
        description="cal|cal_paybox|max|isracard|other",
    )
    cardholder_name: str = Field(
        nullable=False,
        description="Free-text name as extracted from PDF.",
    )
    card_last4: str = Field(
        nullable=False,
        max_length=4,
        description="Last 4 digits of the card number.",
    )
    period_from: datetime = Field(nullable=False)  # stores as DATE in DB
    period_to: datetime = Field(nullable=False)  # stores as DATE in DB
    total_amount_ils: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(
            Numeric(12, 2),
            comment="Total period charges in ILS (shekels, NOT agorot). NUMERIC(12,2).",
        ),
    )
    txn_count: Optional[int] = Field(default=None)
    parse_warnings: Optional[List[str]] = Field(
        default=None,
        sa_column=Column(
            JSON,
            nullable=True,
            comment="Array of parser warning strings.",
        ),
    )
    ingested_at: datetime = Field(
        default=None,
        sa_column_kwargs={"server_default": text("now()")},
    )
    household_id: UUID = Field(nullable=False, foreign_key="households.id", index=True)


class CreditCardTransaction(SQLModel, table=True):
    """One row per transaction line-item extracted from a credit-card statement.

    ``amount_ils`` is always in ILS shekels (NOT agorot) — NUMERIC(12,2).
    Positive values are charges; negative values are credits or refunds.

    For FX transactions, ``amount_original`` + ``original_currency`` +
    ``fx_rate`` capture the source-currency details.  ``fx_rate`` is expressed
    as ILS per 1 unit of ``original_currency`` (e.g. 3.75730000 for 1 EUR).

    Installment transactions split a single purchase across multiple months.
    ``installment_num`` / ``installment_total`` identify which slice this row is.
    ``amount_ils`` always reflects **this month's charge only**.
    """

    __tablename__ = "credit_card_transactions"

    id: UUID = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"server_default": text("gen_random_uuid()")},
    )
    statement_id: UUID = Field(nullable=False, foreign_key="credit_card_statements.id", index=True)
    txn_date: datetime = Field(nullable=False)  # date of purchase — stores as DATE
    posting_date: Optional[datetime] = Field(default=None)  # date charged — stores as DATE
    merchant_raw: str = Field(nullable=False, description="Verbatim merchant string from PDF.")
    merchant_normalized: str = Field(
        nullable=False,
        index=True,
        description="Cleaned merchant: uppercase, stripped punctuation and Ltd suffixes.",
    )
    amount_ils: Decimal = Field(
        sa_column=Column(
            Numeric(12, 2),
            nullable=False,
            comment=("Charge in ILS shekels (NOT agorot). Positive=debit, negative=credit/refund. NUMERIC(12,2)."),
        ),
    )
    amount_original: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(
            Numeric(14, 4),
            nullable=True,
            comment="Original foreign-currency amount if FX transaction. NUMERIC(14,4).",
        ),
    )
    original_currency: Optional[str] = Field(
        default=None,
        max_length=3,
        description="ISO 4217 currency code, e.g. 'USD', 'EUR', 'GBP'.",
    )
    fx_rate: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(
            Numeric(12, 8),
            nullable=True,
            comment="ILS per 1 unit of original_currency. NUMERIC(12,8).",
        ),
    )
    installment_num: Optional[int] = Field(
        default=None,
        description="1-based installment index. NULL for non-installment transactions.",
    )
    installment_total: Optional[int] = Field(
        default=None,
        description="Total number of installments for this purchase. NULL if not installment.",
    )
    sector_raw: Optional[str] = Field(
        default=None,
        description="Raw Hebrew ענף (sector) field from Cal/Isracard. NULL for Max.",
    )
    category_id: Optional[UUID] = Field(default=None, foreign_key="expense_categories.id")
    subcategory_id: Optional[UUID] = Field(default=None, foreign_key="expense_categories.id")
    resolution_status: str = Field(
        default="unresolved",
        description=(
            "auto|user_confirmed|unresolved|transfer. transfer = PayBox/UP transfers excluded from expense totals."
        ),
    )
    resolution_source: Optional[str] = Field(
        default=None,
        description="sector|rule|mapping|user — how the category was determined.",
    )
    household_id: UUID = Field(nullable=False, foreign_key="households.id", index=True)


class ExpenseCategory(SQLModel, table=True):
    """Global hierarchical expense taxonomy.

    Shared across all households — no ``household_id``.  Top-level categories
    have ``parent_id = NULL``.  Subcategories reference their parent via
    ``parent_id``.

    ``is_transfer`` marks categories like "transfers" (PayBox, UP App) whose
    transactions are excluded from household expense totals.

    Rows are seeded by McManus (CC-3) from the taxonomy YAML.  This class
    provides the ORM layer only.
    """

    __tablename__ = "expense_categories"

    id: UUID = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"server_default": text("gen_random_uuid()")},
    )
    parent_id: Optional[UUID] = Field(
        default=None,
        foreign_key="expense_categories.id",
        description="NULL = top-level category.",
    )
    slug: str = Field(
        nullable=False,
        description='Machine-readable unique key, e.g. "travel.flights".',
    )
    name: str = Field(nullable=False, description="English display name.")
    name_he: str = Field(nullable=False, description="Hebrew display name.")
    display_order: int = Field(default=0)
    is_transfer: bool = Field(
        default=False,
        description=(
            "When True, transactions in this category are transfers "
            "(PayBox etc.) and excluded from household expense totals."
        ),
    )
    icon: Optional[str] = Field(default=None, description="Emoji or icon identifier for UI.")
    color: Optional[str] = Field(
        default=None,
        description='Hex color for chart palette, e.g. "#4A90E2".',
    )


class MerchantCategoryMapping(SQLModel, table=True):
    """Learned and rule-based merchant→category mappings.

    ``household_id = NULL``  → global fallback (applies to all households).
    ``household_id = <uuid>`` → household-scoped (takes precedence over global).

    ``confidence`` is 0.00–1.00.  User-confirmed and deterministic rules are
    1.00.  Inferred mappings start lower and may be promoted via user
    confirmation.

    ``match_count`` tracks how often a mapping has been applied during
    auto-categorization — used to rank competing inferred mappings.
    """

    __tablename__ = "merchant_category_mappings"

    id: UUID = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"server_default": text("gen_random_uuid()")},
    )
    merchant_normalized: str = Field(
        nullable=False,
        index=True,
        description="Normalized merchant name matching credit_card_transactions.merchant_normalized.",
    )
    category_id: UUID = Field(nullable=False, foreign_key="expense_categories.id")
    subcategory_id: Optional[UUID] = Field(default=None, foreign_key="expense_categories.id")
    confidence: Decimal = Field(
        default=Decimal("1.00"),
        sa_column=Column(
            Numeric(3, 2),
            nullable=False,
            server_default="1.00",
            comment="0.00–1.00. 1.00 = user-confirmed or deterministic rule.",
        ),
    )
    source: str = Field(nullable=False, description="rule|user|inferred")
    match_count: int = Field(
        default=0,
        description="Times this mapping was applied during auto-categorization.",
    )
    created_by: Optional[str] = Field(
        default=None,
        description="User id (text) when source='user'.",
    )
    created_at: datetime = Field(
        default=None,
        sa_column_kwargs={"server_default": text("now()")},
    )
    last_used_at: Optional[datetime] = Field(default=None)
    household_id: Optional[UUID] = Field(
        default=None,
        foreign_key="households.id",
        index=True,
        description="NULL=global fallback. Non-NULL=household-scoped, takes precedence.",
    )
