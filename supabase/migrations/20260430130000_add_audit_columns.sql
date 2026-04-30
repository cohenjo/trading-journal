-- Migration: 20260430130000_add_audit_columns
-- Created: 2026-04-30
-- Author: Hockney (Backend Dev) for TJ-005 / GH #58
-- Purpose: Add created_at, updated_at, deleted_at audit columns to all household
--          and owner-private tables. Create the tg_update_timestamp() trigger
--          function and attach it to every affected table.
--
-- Fact-check notes (cross-verified against SQLAlchemy models):
--   • plans             — already has created_at + updated_at; IF NOT EXISTS is safe
--   • insurance_policies — already has created_at + updated_at; IF NOT EXISTS is safe
--   • backtestrun       — already has created_at; IF NOT EXISTS is safe
--   • user              — already has created_at; IF NOT EXISTS is safe
--   All other tables have no existing audit columns.
--
-- Tables covered (14 total):
--   Household (12): manualtrade, trade, execution, matchedtrade, dailysummary,
--                   trading_account_summary, trading_positions, finance_snapshots,
--                   plans, dividend_positions, dividend_accounts, insurance_policies
--   Owner-private (2): note, backtestrun
--
-- Global-reference tables (ndx1m, dailybar, dividend_ticker_data, optioncontract,
-- historicaloptionbar) are deliberately excluded — they are service-role-managed
-- reference data with no per-user lifecycle semantics.
-- backtesttrade is excluded: audit lifecycle inherited from parent backtestrun.

-- ============================================================
-- Trigger function: tg_update_timestamp
-- Sets updated_at = now() before every UPDATE.
-- ============================================================
create or replace function public.tg_update_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- Helper macro: attach trigger to a table (idempotent via drop-if-exists)
-- Each table gets its own named trigger so they can be managed independently.
-- ============================================================

-- ----------------------------------------------------------------
-- manualtrade
-- ----------------------------------------------------------------
alter table public.manualtrade
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_manualtrade_updated_at on public.manualtrade;
create trigger trg_manualtrade_updated_at
  before update on public.manualtrade
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- trade
-- ----------------------------------------------------------------
alter table public.trade
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_trade_updated_at on public.trade;
create trigger trg_trade_updated_at
  before update on public.trade
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- execution
-- ----------------------------------------------------------------
alter table public.execution
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_execution_updated_at on public.execution;
create trigger trg_execution_updated_at
  before update on public.execution
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- matchedtrade
-- ----------------------------------------------------------------
alter table public.matchedtrade
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_matchedtrade_updated_at on public.matchedtrade;
create trigger trg_matchedtrade_updated_at
  before update on public.matchedtrade
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- dailysummary
-- ----------------------------------------------------------------
alter table public.dailysummary
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_dailysummary_updated_at on public.dailysummary;
create trigger trg_dailysummary_updated_at
  before update on public.dailysummary
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- trading_account_summary
-- ----------------------------------------------------------------
alter table public.trading_account_summary
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_trading_account_summary_updated_at on public.trading_account_summary;
create trigger trg_trading_account_summary_updated_at
  before update on public.trading_account_summary
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- trading_positions
-- ----------------------------------------------------------------
alter table public.trading_positions
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_trading_positions_updated_at on public.trading_positions;
create trigger trg_trading_positions_updated_at
  before update on public.trading_positions
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- finance_snapshots
-- ----------------------------------------------------------------
alter table public.finance_snapshots
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_finance_snapshots_updated_at on public.finance_snapshots;
create trigger trg_finance_snapshots_updated_at
  before update on public.finance_snapshots
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- plans
-- NOTE: SQLAlchemy model already declares created_at + updated_at.
--       ADD COLUMN IF NOT EXISTS is a no-op if the column exists.
--       deleted_at is new (soft-delete pattern).
-- ----------------------------------------------------------------
alter table public.plans
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
  before update on public.plans
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- dividend_positions
-- ----------------------------------------------------------------
alter table public.dividend_positions
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_dividend_positions_updated_at on public.dividend_positions;
create trigger trg_dividend_positions_updated_at
  before update on public.dividend_positions
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- dividend_accounts
-- ----------------------------------------------------------------
alter table public.dividend_accounts
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_dividend_accounts_updated_at on public.dividend_accounts;
create trigger trg_dividend_accounts_updated_at
  before update on public.dividend_accounts
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- insurance_policies
-- NOTE: SQLAlchemy model already declares created_at + updated_at.
--       deleted_at is new.
-- ----------------------------------------------------------------
alter table public.insurance_policies
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_insurance_policies_updated_at on public.insurance_policies;
create trigger trg_insurance_policies_updated_at
  before update on public.insurance_policies
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- note  (owner-private)
-- ----------------------------------------------------------------
alter table public.note
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_note_updated_at on public.note;
create trigger trg_note_updated_at
  before update on public.note
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- backtestrun  (owner-private)
-- NOTE: SQLAlchemy model already declares created_at.
--       updated_at and deleted_at are new.
-- ----------------------------------------------------------------
alter table public.backtestrun
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_backtestrun_updated_at on public.backtestrun;
create trigger trg_backtestrun_updated_at
  before update on public.backtestrun
  for each row execute function public.tg_update_timestamp();

-- end of migration
