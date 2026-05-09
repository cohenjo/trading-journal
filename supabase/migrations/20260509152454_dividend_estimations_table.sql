-- Migration: 20260509151900_dividend_estimations_table
-- Author: Hockney (Backend Dev)
-- Purpose: Create dividend_estimations table for user-entered dividend income overrides
-- Issue: #339 (Part A - CRUD persistence)
-- Wave: 3

-- ============================================================
-- PART 1: dividend_estimations Table
-- ============================================================

-- Create table for user-entered historical/projected dividend income per year
-- This overrides the automatic projection model on a per-year basis
create table if not exists public.dividend_estimations (
  id serial primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  year integer not null,
  amount numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ensure one estimation per (household, year) pair
  constraint dividend_estimations_household_year_unique unique (household_id, year)
);

-- Index for household queries
create index if not exists dividend_estimations_household_id_idx
  on public.dividend_estimations (household_id);

-- Index for year range queries
create index if not exists dividend_estimations_year_idx
  on public.dividend_estimations (year);

-- Trigger for updated_at
drop trigger if exists trg_dividend_estimations_update_timestamp on public.dividend_estimations;
create trigger trg_dividend_estimations_update_timestamp
  before update on public.dividend_estimations
  for each row execute function public.tg_update_timestamp();

-- Enable RLS
alter table public.dividend_estimations enable row level security;

-- RLS policies: household-scoped pattern
drop policy if exists dividend_estimations_select on public.dividend_estimations;
create policy dividend_estimations_select on public.dividend_estimations
  for select to authenticated
  using (household_id is not null and public.is_household_member(household_id));

drop policy if exists dividend_estimations_insert on public.dividend_estimations;
create policy dividend_estimations_insert on public.dividend_estimations
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists dividend_estimations_update on public.dividend_estimations;
create policy dividend_estimations_update on public.dividend_estimations
  for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists dividend_estimations_delete on public.dividend_estimations;
create policy dividend_estimations_delete on public.dividend_estimations
  for delete to authenticated
  using (household_id is not null and public.is_household_writer(household_id));

-- ============================================================
-- End of migration
-- ============================================================
