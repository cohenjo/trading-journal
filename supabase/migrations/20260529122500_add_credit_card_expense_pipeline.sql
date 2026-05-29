-- Migration: 20260529122500_add_credit_card_expense_pipeline
-- Author: Hockney (Backend Dev) — CC-1
-- Date: 2026-05-29
-- Purpose: Create the 5-table schema for the credit-card expense analysis pipeline.
--          Tables: expense_inbox, expense_categories, credit_card_statements,
--                  credit_card_transactions, merchant_category_mappings.
--
-- NOTE: Category seeding (28 rows) is deferred to McManus (CC-3), who owns the
--       taxonomy YAML and will author 20260529122501_seed_expense_categories.sql.
--
-- AMOUNT CONVENTIONS:
--   amount_ils         NUMERIC(12,2)  — shekels (ILS). NOT agorot. e.g. 126.00 = ₪126.
--   amount_original    NUMERIC(14,4)  — original foreign-currency units (JPY, EUR, USD …)
--   fx_rate            NUMERIC(12,8)  — ILS per 1 original-currency unit (e.g. 3.75730000)
--
-- IDEMPOTENCY: All DDL uses IF NOT EXISTS / DROP POLICY IF EXISTS so re-applying is safe.
-- TABLE CREATION ORDER: dependency-safe (expense_categories before credit_card_transactions).

-- ============================================================
-- 1. expense_inbox — ingest queue, one row per file submission
-- ============================================================
create table if not exists public.expense_inbox (
    id               uuid        primary key default gen_random_uuid(),
    file_path        text        not null,
    file_hash        text        not null,  -- SHA-256 hex of raw file bytes
    file_size_bytes  bigint,
    status           text        not null default 'pending',
        -- pending | processing | completed | errored | duplicate
    error_message    text,
    retry_count      int         not null default 0,
    submitted_at     timestamptz not null default now(),
    processed_at     timestamptz,
    household_id     uuid        references public.households(id),
    constraint expense_inbox_file_hash_unique unique (file_hash),
    constraint expense_inbox_status_check check (
        status in ('pending', 'processing', 'completed', 'errored', 'duplicate')
    )
);

comment on table  public.expense_inbox                  is 'Ingest queue: one row per submitted PDF file.';
comment on column public.expense_inbox.file_hash        is 'SHA-256 hex digest of raw file bytes. Dedup gate.';
comment on column public.expense_inbox.status           is 'pending|processing|completed|errored|duplicate';
comment on column public.expense_inbox.retry_count      is 'Times this file has been re-queued after an error.';
comment on column public.expense_inbox.submitted_at     is 'When the file was first placed in the queue.';
comment on column public.expense_inbox.processed_at     is 'When status transitioned to completed or errored.';

create index if not exists expense_inbox_status_submitted_at_idx
    on public.expense_inbox (status, submitted_at);

-- ============================================================
-- 2. expense_categories — hierarchical taxonomy (global, no household scope)
--    Created before credit_card_transactions and merchant_category_mappings
--    because both tables carry FKs to this table.
-- ============================================================
create table if not exists public.expense_categories (
    id            uuid     primary key default gen_random_uuid(),
    parent_id     uuid     references public.expense_categories(id),  -- NULL = top-level
    slug          text     not null,
    name          text     not null,     -- English display name
    name_he       text     not null,     -- Hebrew display name
    display_order int      not null default 0,
    is_transfer   boolean  not null default false,
        -- true → this category represents transfers (e.g. PayBox), excluded from expense totals
    icon          text,                  -- emoji or icon identifier for UI
    color         text,                  -- hex color string for chart palette (e.g. '#4A90E2')
    constraint expense_categories_slug_unique unique (slug)
);

comment on table  public.expense_categories              is 'Global hierarchical expense taxonomy. Shared across all households. No household_id — taxonomy is project-level.';
comment on column public.expense_categories.slug         is 'Machine-readable unique key, e.g. "travel.flights". Used in category_rules.yaml and API responses.';
comment on column public.expense_categories.is_transfer  is 'When true, transactions in this category are transfers (PayBox etc.) and excluded from household expense totals.';
comment on column public.expense_categories.color        is 'Hex color for chart palette, e.g. "#4A90E2". NULL = use default palette rotation.';

create index if not exists expense_categories_parent_order_idx
    on public.expense_categories (parent_id, display_order);

-- ============================================================
-- 3. credit_card_statements — one row per successfully parsed PDF
-- ============================================================
create table if not exists public.credit_card_statements (
    id                  uuid        primary key default gen_random_uuid(),
    inbox_id            uuid        references public.expense_inbox(id),
    file_hash           text        not null,
    source_file_path    text        not null,
    issuer              text        not null,
        -- cal | cal_paybox | max | isracard | other
    cardholder_name     text        not null,  -- free-text as extracted from PDF
    card_last4          char(4)     not null,  -- last 4 digits of card number
    period_from         date        not null,
    period_to           date        not null,
    total_amount_ils    numeric(12,2),         -- total charges for the period, in shekels
    txn_count           int,                   -- number of transaction rows extracted
    parse_warnings      jsonb       not null default '[]'::jsonb,
    ingested_at         timestamptz not null default now(),
    household_id        uuid        not null references public.households(id),
    constraint credit_card_statements_file_hash_unique unique (file_hash),
    constraint credit_card_statements_issuer_check check (
        issuer in ('cal', 'cal_paybox', 'max', 'isracard', 'other')
    )
);

comment on table  public.credit_card_statements                     is 'One row per ingested credit-card statement PDF.';
comment on column public.credit_card_statements.file_hash           is 'SHA-256 hex digest — mirrors expense_inbox.file_hash for dedup.';
comment on column public.credit_card_statements.issuer              is 'cal|cal_paybox|max|isracard|other';
comment on column public.credit_card_statements.cardholder_name     is 'Free-text cardholder name as extracted from PDF. No FK to household_members (by design, keep simple).';
comment on column public.credit_card_statements.card_last4          is 'Last 4 digits of the card number.';
comment on column public.credit_card_statements.total_amount_ils    is 'Total period charges in ILS (shekels, NOT agorot). NUMERIC(12,2).';
comment on column public.credit_card_statements.txn_count           is 'Number of transaction line-items extracted from this statement.';
comment on column public.credit_card_statements.parse_warnings      is 'Array of parser warning strings, e.g. skipped rows or ambiguous dates.';

create index if not exists credit_card_statements_cardholder_period_idx
    on public.credit_card_statements (cardholder_name, period_from);
create index if not exists credit_card_statements_issuer_period_idx
    on public.credit_card_statements (issuer, period_from);

-- ============================================================
-- 4. credit_card_transactions — one row per line-item
-- ============================================================
create table if not exists public.credit_card_transactions (
    id                   uuid          primary key default gen_random_uuid(),
    statement_id         uuid          not null references public.credit_card_statements(id) on delete cascade,
    txn_date             date          not null,   -- date of purchase
    posting_date         date,                     -- date charged to account (may differ)
    merchant_raw         text          not null,   -- verbatim from PDF
    merchant_normalized  text          not null,   -- cleaned: uppercase, stripped punctuation
    amount_ils           numeric(12,2) not null,
        -- ILS (shekels). Positive = charge, negative = credit/refund. NOT agorot.
    amount_original      numeric(14,4),            -- original amount in foreign currency if FX
    original_currency    char(3),                  -- ISO 4217 e.g. 'USD', 'EUR', 'GBP'
    fx_rate              numeric(12,8),
        -- ILS per 1 unit of original_currency (e.g. 3.75730000 means 1 EUR = ₪3.757300)
    installment_num      int,                      -- 1-based. NULL if not an installment tx
    installment_total    int,                      -- total number of installments. NULL if not
    sector_raw           text,                     -- issuer-reported Hebrew sector field (Cal/Isracard only)
    category_id          uuid          references public.expense_categories(id),
    subcategory_id       uuid          references public.expense_categories(id),
    resolution_status    text          not null default 'unresolved',
        -- auto | user_confirmed | unresolved | transfer
    resolution_source    text,
        -- sector | rule | mapping | user — how the category was determined
    household_id         uuid          not null references public.households(id),
    constraint credit_card_transactions_resolution_status_check check (
        resolution_status in ('auto', 'user_confirmed', 'unresolved', 'transfer')
    ),
    constraint credit_card_transactions_resolution_source_check check (
        resolution_source is null or
        resolution_source in ('sector', 'rule', 'mapping', 'user')
    ),
    constraint credit_card_transactions_currency_length_check check (
        original_currency is null or length(original_currency) = 3
    )
);

comment on table  public.credit_card_transactions                      is 'One row per transaction line-item extracted from a credit-card statement.';
comment on column public.credit_card_transactions.amount_ils           is 'Charge amount in ILS (shekels, NOT agorot). Positive = debit, negative = credit/refund. NUMERIC(12,2).';
comment on column public.credit_card_transactions.amount_original      is 'Original foreign-currency amount if this was an FX transaction. NUMERIC(14,4).';
comment on column public.credit_card_transactions.fx_rate              is 'Exchange rate: ILS per 1 unit of original_currency at time of transaction. NUMERIC(12,8).';
comment on column public.credit_card_transactions.installment_num      is 'Which installment this row represents (1-based). NULL for non-installment transactions.';
comment on column public.credit_card_transactions.installment_total    is 'Total number of installments for this purchase. NULL for non-installment transactions.';
comment on column public.credit_card_transactions.sector_raw           is 'Raw Hebrew sector field (ענף) as printed by Cal or Isracard. NULL for Max (no sector column).';
comment on column public.credit_card_transactions.resolution_status    is 'auto|user_confirmed|unresolved|transfer. transfer = PayBox/UP transfers excluded from expense totals.';
comment on column public.credit_card_transactions.resolution_source    is 'sector|rule|mapping|user — how the category assignment was derived.';

create index if not exists credit_card_transactions_txn_date_idx
    on public.credit_card_transactions (txn_date);
create index if not exists credit_card_transactions_merchant_normalized_idx
    on public.credit_card_transactions (merchant_normalized);
-- Partial index — only unresolved rows (keeps index small; most rows will resolve over time)
create index if not exists credit_card_transactions_unresolved_idx
    on public.credit_card_transactions (resolution_status)
    where resolution_status = 'unresolved';
create index if not exists credit_card_transactions_category_txn_date_idx
    on public.credit_card_transactions (category_id, txn_date);
create index if not exists credit_card_transactions_statement_id_idx
    on public.credit_card_transactions (statement_id);
create index if not exists credit_card_transactions_household_txn_date_idx
    on public.credit_card_transactions (household_id, txn_date);

-- ============================================================
-- 5. merchant_category_mappings — learned/rule-based merchant → category
-- ============================================================
create table if not exists public.merchant_category_mappings (
    id                  uuid          primary key default gen_random_uuid(),
    merchant_normalized text          not null,
    category_id         uuid          not null references public.expense_categories(id),
    subcategory_id      uuid          references public.expense_categories(id),
    confidence          numeric(3,2)  not null default 1.00,
        -- 0.00–1.00. 1.00 = deterministic rule or user-confirmed. Lower = inferred.
    source              text          not null,
        -- rule | user | inferred
    match_count         int           not null default 0,
        -- times this mapping has been applied during auto-categorization
    created_by          text,         -- user id (text) when source='user'
    created_at          timestamptz   not null default now(),
    last_used_at        timestamptz,
    household_id        uuid          references public.households(id),
        -- NULL = global fallback mapping (applies to all households)
        -- non-NULL = household-scoped mapping (takes precedence over global)
    constraint merchant_category_mappings_confidence_range check (
        confidence >= 0.00 and confidence <= 1.00
    ),
    constraint merchant_category_mappings_source_check check (
        source in ('rule', 'user', 'inferred')
    )
);

comment on table  public.merchant_category_mappings                      is 'Merchant-to-category mappings learned from rules, user confirmation, or inference.';
comment on column public.merchant_category_mappings.merchant_normalized  is 'Normalized merchant name (uppercase, stripped) matching credit_card_transactions.merchant_normalized.';
comment on column public.merchant_category_mappings.confidence           is '0.00–1.00. 1.00 = user-confirmed or deterministic rule. Used to rank competing mappings.';
comment on column public.merchant_category_mappings.match_count          is 'Times this mapping was applied during auto-categorization. Used for ranking inferred mappings.';
comment on column public.merchant_category_mappings.household_id         is 'NULL = global mapping. Non-NULL = household-scoped, takes precedence over global for that household.';

-- One canonical mapping per merchant per household (or per merchant globally if household_id IS NULL).
-- Uses partial unique indexes because (merchant_normalized, NULL) won't satisfy a plain UNIQUE constraint.
create unique index if not exists merchant_category_mappings_merchant_household_idx
    on public.merchant_category_mappings (merchant_normalized, household_id)
    where household_id is not null;

create unique index if not exists merchant_category_mappings_merchant_global_idx
    on public.merchant_category_mappings (merchant_normalized)
    where household_id is null;

create index if not exists merchant_category_mappings_merchant_idx
    on public.merchant_category_mappings (merchant_normalized);

-- ============================================================
-- RLS: expense_inbox
-- ============================================================
alter table public.expense_inbox enable row level security;

revoke all on table public.expense_inbox from anon;
revoke all on table public.expense_inbox from authenticated;
grant select, insert, update on table public.expense_inbox to authenticated;
grant select, insert, update, delete on table public.expense_inbox to service_role;

drop policy if exists expense_inbox_household_select on public.expense_inbox;
create policy expense_inbox_household_select
    on public.expense_inbox
    for select
    to authenticated
    using (
        household_id is null
        or public.is_household_member(household_id)
    );

drop policy if exists expense_inbox_household_insert on public.expense_inbox;
create policy expense_inbox_household_insert
    on public.expense_inbox
    for insert
    to authenticated
    with check (
        household_id is null
        or public.is_household_member(household_id)
    );

drop policy if exists expense_inbox_household_update on public.expense_inbox;
create policy expense_inbox_household_update
    on public.expense_inbox
    for update
    to authenticated
    using (
        household_id is null
        or public.is_household_member(household_id)
    );

drop policy if exists expense_inbox_service_all on public.expense_inbox;
create policy expense_inbox_service_all
    on public.expense_inbox
    for all
    to service_role
    using (true)
    with check (true);

-- ============================================================
-- RLS: expense_categories (global — no household filter, read-only for authenticated)
-- ============================================================
alter table public.expense_categories enable row level security;

revoke all on table public.expense_categories from anon;
revoke all on table public.expense_categories from authenticated;
grant select on table public.expense_categories to authenticated;
grant select, insert, update, delete on table public.expense_categories to service_role;

drop policy if exists expense_categories_authenticated_select on public.expense_categories;
create policy expense_categories_authenticated_select
    on public.expense_categories
    for select
    to authenticated
    using (true);

drop policy if exists expense_categories_service_all on public.expense_categories;
create policy expense_categories_service_all
    on public.expense_categories
    for all
    to service_role
    using (true)
    with check (true);

-- ============================================================
-- RLS: credit_card_statements
-- ============================================================
alter table public.credit_card_statements enable row level security;

revoke all on table public.credit_card_statements from anon;
revoke all on table public.credit_card_statements from authenticated;
grant select on table public.credit_card_statements to authenticated;
grant select, insert, update, delete on table public.credit_card_statements to service_role;

drop policy if exists credit_card_statements_household_select on public.credit_card_statements;
create policy credit_card_statements_household_select
    on public.credit_card_statements
    for select
    to authenticated
    using (public.is_household_member(household_id));

drop policy if exists credit_card_statements_service_all on public.credit_card_statements;
create policy credit_card_statements_service_all
    on public.credit_card_statements
    for all
    to service_role
    using (true)
    with check (true);

-- ============================================================
-- RLS: credit_card_transactions
-- ============================================================
alter table public.credit_card_transactions enable row level security;

revoke all on table public.credit_card_transactions from anon;
revoke all on table public.credit_card_transactions from authenticated;
grant select on table public.credit_card_transactions to authenticated;
grant select, insert, update, delete on table public.credit_card_transactions to service_role;

drop policy if exists credit_card_transactions_household_select on public.credit_card_transactions;
create policy credit_card_transactions_household_select
    on public.credit_card_transactions
    for select
    to authenticated
    using (public.is_household_member(household_id));

drop policy if exists credit_card_transactions_service_all on public.credit_card_transactions;
create policy credit_card_transactions_service_all
    on public.credit_card_transactions
    for all
    to service_role
    using (true)
    with check (true);

-- ============================================================
-- RLS: merchant_category_mappings
-- ============================================================
alter table public.merchant_category_mappings enable row level security;

revoke all on table public.merchant_category_mappings from anon;
revoke all on table public.merchant_category_mappings from authenticated;
grant select on table public.merchant_category_mappings to authenticated;
grant select, insert, update, delete on table public.merchant_category_mappings to service_role;

drop policy if exists merchant_category_mappings_select on public.merchant_category_mappings;
create policy merchant_category_mappings_select
    on public.merchant_category_mappings
    for select
    to authenticated
    using (
        household_id is null
        or public.is_household_member(household_id)
    );

drop policy if exists merchant_category_mappings_service_all on public.merchant_category_mappings;
create policy merchant_category_mappings_service_all
    on public.merchant_category_mappings
    for all
    to service_role
    using (true)
    with check (true);

-- end of migration 20260529122500_add_credit_card_expense_pipeline
