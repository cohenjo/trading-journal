-- Migration: 20260501040000_wave2b_holdings_dividends_db
-- Author: Hockney (Backend Dev)
-- Purpose: Migrate holdings and dividends from in-memory/XLSX storage to DB tables
-- Issues: #119 (holdings), #120 (dividends)
-- Wave: 2b

-- ============================================================
-- PART 1: Bond Holdings Table (#119)
-- ============================================================

-- Create bond_holdings table to replace in-memory mock
create table if not exists public.bond_holdings (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  ticker text,
  issuer text not null,
  currency text not null,
  face_value numeric(18, 6) not null,
  coupon_rate numeric(18, 6) not null,
  coupon_frequency text not null, -- "ANNUAL", "SEMI_ANNUAL", "QUARTERLY"
  issue_date date not null,
  maturity_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Index for household queries
create index if not exists bond_holdings_household_id_idx 
  on public.bond_holdings (household_id);

-- Index for maturity ladder queries
create index if not exists bond_holdings_maturity_date_idx 
  on public.bond_holdings (maturity_date) 
  where deleted_at is null;

-- Trigger for updated_at
drop trigger if exists trg_bond_holdings_update_timestamp on public.bond_holdings;
create trigger trg_bond_holdings_update_timestamp
  before update on public.bond_holdings
  for each row execute function public.tg_update_timestamp();

-- Enable RLS
alter table public.bond_holdings enable row level security;

-- RLS policies: household-scoped pattern
drop policy if exists bond_holdings_select on public.bond_holdings;
create policy bond_holdings_select on public.bond_holdings 
  for select to authenticated
  using (household_id is not null and public.is_household_member(household_id));

drop policy if exists bond_holdings_insert on public.bond_holdings;
create policy bond_holdings_insert on public.bond_holdings 
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists bond_holdings_update on public.bond_holdings;
create policy bond_holdings_update on public.bond_holdings 
  for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists bond_holdings_delete on public.bond_holdings;
create policy bond_holdings_delete on public.bond_holdings 
  for delete to authenticated
  using (household_id is not null and public.is_household_writer(household_id));

-- ============================================================
-- PART 2: Dividends DB Migration (#120)
-- ============================================================

-- dividend_positions and dividend_ticker_data already exist (baseline schema)
-- dividend_positions already has household_id column (from 130100 migration)
-- dividend_positions already has RLS policies (from 160200 migration)

-- Verify dividend_ticker_data has proper structure for market reference data
-- This table is reference data (not household-scoped), so RLS is read-only for authenticated

alter table public.dividend_ticker_data enable row level security;

drop policy if exists dividend_ticker_data_select on public.dividend_ticker_data;
create policy dividend_ticker_data_select on public.dividend_ticker_data 
  for select to authenticated
  using (true);

-- Only service_role can write to market data (no INSERT/UPDATE/DELETE for authenticated users)

-- ============================================================
-- End of migration
-- ============================================================
