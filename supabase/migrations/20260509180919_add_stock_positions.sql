-- ================================================================
-- Migration: stock_positions table + account_type constraint
-- Issue: #340 Phase 2 — trading accounts + stock positions
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================

-- ----------------------------------------------------------------
-- 1. trading_account_config: convert account_type to text + CHECK
-- ----------------------------------------------------------------

-- Convert the enum column to plain text (lowercasing existing values).
-- This replaces the tradingaccounttype enum ('IBKR','SCHWAB') with a
-- text CHECK constraint that accepts exactly ('ibkr','schwab','ira').
-- CHECK constraints are easier to extend than Postgres enums.

-- Drop the legacy uppercase-only check constraint (allows IBKR/SCHWAB only)
alter table public.trading_account_config
  drop constraint if exists trading_account_config_account_type_check;

-- Lowercase all existing values (IBKR → ibkr, SCHWAB → schwab)
update public.trading_account_config
   set account_type = lower(account_type)
 where account_type != lower(account_type);

-- Set default to lowercase
alter table public.trading_account_config
  alter column account_type set default 'ibkr';

-- Add new check constraint accepting exactly ibkr / schwab / ira
alter table public.trading_account_config
  drop constraint if exists chk_account_type;

alter table public.trading_account_config
  add constraint chk_account_type
  check (account_type in ('ibkr', 'schwab', 'ira'));

-- ----------------------------------------------------------------
-- 2. stock_positions: new table
-- ----------------------------------------------------------------

create table if not exists public.stock_positions (
  id                  uuid          primary key default gen_random_uuid(),
  household_id        uuid          not null
                                    references public.households(id) on delete cascade,
  account_id          integer       not null
                                    references public.trading_account_config(id),
  ticker              text          not null,
  quantity            numeric(18,6) not null,
  cost_basis          numeric(18,4) null,         -- per-share average; NULL = unknown
  currency            text          not null default 'USD',
  as_of_date          date          not null,
  source              text          not null
                                    check (source in ('flex', 'manual')),
  con_id              integer       null,          -- IBKR contract ID (STK only)

  -- Extended fields from McManus Flex investigation
  description         text          null,          -- e.g. "DEUTSCHE BANK AG-REGISTERED"
  sub_category        text          null,          -- e.g. COMMON, ETF, REIT, PREFERENCE
  mark_price          numeric(18,4) null,
  market_value        numeric(18,4) null,
  unrealized_pnl      numeric(18,4) null,
  raw_payload         jsonb         null,          -- full Flex row for audit/debug
  last_broker_sync_at timestamptz   null,

  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  created_by          uuid          null references auth.users(id)
);

-- Indexes
create index if not exists stock_positions_household_account_idx
  on public.stock_positions (household_id, account_id);

create index if not exists stock_positions_household_ticker_idx
  on public.stock_positions (household_id, ticker);

-- Idempotency key for Flex snapshots (one position per ticker per snapshot date)
create unique index if not exists stock_positions_flex_snapshot_key
  on public.stock_positions (account_id, ticker, as_of_date)
  where source = 'flex';

-- ----------------------------------------------------------------
-- 3. updated_at trigger
-- ----------------------------------------------------------------

drop trigger if exists trg_stock_positions_updated_at on public.stock_positions;
create trigger trg_stock_positions_updated_at
  before update on public.stock_positions
  for each row execute function public.tg_update_timestamp();

-- ----------------------------------------------------------------
-- 4. RLS — household-scoped (matching options_positions pattern)
-- ----------------------------------------------------------------

alter table public.stock_positions enable row level security;

revoke all on public.stock_positions from anon;
grant select on public.stock_positions to authenticated;
grant insert, update, delete on public.stock_positions to authenticated;
grant all on public.stock_positions to service_role;

drop policy if exists stock_positions_select on public.stock_positions;
create policy stock_positions_select on public.stock_positions
  for select to authenticated
  using (household_id is not null and public.is_household_member(household_id));

drop policy if exists stock_positions_insert on public.stock_positions;
create policy stock_positions_insert on public.stock_positions
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists stock_positions_update on public.stock_positions;
create policy stock_positions_update on public.stock_positions
  for update to authenticated
  using  (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists stock_positions_delete on public.stock_positions;
create policy stock_positions_delete on public.stock_positions
  for delete to authenticated
  using (household_id is not null and public.is_household_writer(household_id));

-- Add to realtime publication (idempotent: handles missing publication on shadow/CI DBs)
do $$
begin
  alter publication supabase_realtime add table public.stock_positions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
