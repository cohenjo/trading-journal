-- Migration: 20260430130100_add_household_id
-- Created: 2026-04-30
-- Author: Hockney (Backend Dev) for TJ-005 / GH #58
-- Purpose: Add household_id FK column to all household-scoped tables.
--          Prerequisite: public.households table (created in 20260430120000).
--
-- IMPORTANT — backfill required before enforcing NOT NULL:
--   After this migration runs, household_id will be nullable to allow existing rows
--   to be backfilled. Once all rows have a valid household_id, run:
--     ALTER TABLE public.<table> ALTER COLUMN household_id SET NOT NULL;
--   A separate migration will enforce NOT NULL after backfill (TJ-006 or later).
--
-- Fact-check: table names verified against SQLAlchemy models in apps/backend/app/schema/.
--
-- Tables covered (12):
--   manualtrade, trade, execution, matchedtrade, dailysummary,
--   trading_account_summary, trading_positions, finance_snapshots,
--   plans, dividend_positions, dividend_accounts, insurance_policies
--
-- trading_account_config is deliberately excluded here — it is under ⚠️ NEEDS REVIEW
-- (see migration 20260430130300). It will receive household_id only after the split decision.

-- ----------------------------------------------------------------
-- manualtrade
-- ----------------------------------------------------------------
alter table public.manualtrade
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists manualtrade_household_id_idx
  on public.manualtrade (household_id);

-- ----------------------------------------------------------------
-- trade
-- ----------------------------------------------------------------
alter table public.trade
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists trade_household_id_idx
  on public.trade (household_id);

-- ----------------------------------------------------------------
-- execution
-- ----------------------------------------------------------------
alter table public.execution
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists execution_household_id_idx
  on public.execution (household_id);

-- ----------------------------------------------------------------
-- matchedtrade
-- ----------------------------------------------------------------
alter table public.matchedtrade
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists matchedtrade_household_id_idx
  on public.matchedtrade (household_id);

-- ----------------------------------------------------------------
-- dailysummary
-- Note: primary key is (date) — household_id makes it a multi-tenant
-- date-keyed rollup. Composite index on (household_id, date) serves
-- most RLS + query patterns.
-- ----------------------------------------------------------------
alter table public.dailysummary
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists dailysummary_household_id_idx
  on public.dailysummary (household_id);

create index if not exists dailysummary_household_date_idx
  on public.dailysummary (household_id, date);

-- ----------------------------------------------------------------
-- trading_account_summary
-- ----------------------------------------------------------------
alter table public.trading_account_summary
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists trading_account_summary_household_id_idx
  on public.trading_account_summary (household_id);

-- ----------------------------------------------------------------
-- trading_positions
-- ----------------------------------------------------------------
alter table public.trading_positions
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists trading_positions_household_id_idx
  on public.trading_positions (household_id);

-- ----------------------------------------------------------------
-- finance_snapshots
-- ----------------------------------------------------------------
alter table public.finance_snapshots
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists finance_snapshots_household_id_idx
  on public.finance_snapshots (household_id);

-- ----------------------------------------------------------------
-- plans
-- ----------------------------------------------------------------
alter table public.plans
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists plans_household_id_idx
  on public.plans (household_id);

-- ----------------------------------------------------------------
-- dividend_positions
-- ----------------------------------------------------------------
alter table public.dividend_positions
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists dividend_positions_household_id_idx
  on public.dividend_positions (household_id);

-- ----------------------------------------------------------------
-- dividend_accounts
-- ----------------------------------------------------------------
alter table public.dividend_accounts
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists dividend_accounts_household_id_idx
  on public.dividend_accounts (household_id);

-- ----------------------------------------------------------------
-- insurance_policies
-- ----------------------------------------------------------------
alter table public.insurance_policies
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists insurance_policies_household_id_idx
  on public.insurance_policies (household_id);

-- end of migration
