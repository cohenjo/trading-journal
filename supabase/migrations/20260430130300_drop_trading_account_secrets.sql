-- Migration: 20260430130300_drop_trading_account_secrets
-- Created: 2026-04-30 (rewritten from sketch; original: split_trading_account_config)
-- Author: McManus (Data Architecture) — addresses Decision #3 (2026-04-30)
--
-- DECISION #3: DROP public.trading_account_secrets entirely.
-- No broker-API integration is in scope; only manual trade entries.
-- trading_account_config is now purely household-scoped configuration
-- (account labels, currency, opening balance). The three-option split sketch
-- (Options A/B/C in the original 20260430130300 sketch) is superseded by this
-- decision: no secrets table is needed or wanted.
--
-- CHANGES IN THIS MIGRATION:
--   1. DROP TABLE IF EXISTS public.trading_account_secrets CASCADE (idempotent
--      safety net — the table was only in a commented sketch; never created)
--   2. DROP broker-credential columns from trading_account_config (out of scope
--      for manual-entry mode): app_key, app_secret, account_hash, tokens_path
--   3. ADD household_id to trading_account_config (was explicitly excluded from
--      20260430130100 pending this user decision)
--   4. ADD audit columns (trading_account_config was not covered by 20260430130000)
--   5. ENABLE RLS on trading_account_config
--   6. ADD household-scoped RLS policies (read/write for members, owner hard-delete)
--
-- FUTURE: if broker integrations are added, a new migration will design proper
-- secret storage (Supabase Vault or a dedicated owner-private credentials table).

-- ================================================================
-- Step 1: Precautionary drop of trading_account_secrets
-- (was never created — this DROP is idempotent)
-- ================================================================
drop table if exists public.trading_account_secrets cascade;

-- ================================================================
-- Step 2: Remove out-of-scope broker credential columns
-- ================================================================
alter table public.trading_account_config
  drop column if exists app_key,
  drop column if exists app_secret,
  drop column if exists account_hash,
  drop column if exists tokens_path;

-- ================================================================
-- Step 3: Add household_id (nullable for backfill; NOT NULL deferred)
-- ================================================================
alter table public.trading_account_config
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists trading_account_config_household_id_idx
  on public.trading_account_config (household_id);

-- ================================================================
-- Step 4: Add audit columns (not covered by 20260430130000)
-- Reuse tg_update_timestamp() defined in 20260430130000.
-- ================================================================
alter table public.trading_account_config
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists deleted_at  timestamptz;

drop trigger if exists trg_trading_account_config_updated_at on public.trading_account_config;
create trigger trg_trading_account_config_updated_at
  before update on public.trading_account_config
  for each row execute function public.tg_update_timestamp();

-- ================================================================
-- Step 5: Enable RLS
-- ================================================================
alter table public.trading_account_config enable row level security;

-- ================================================================
-- Step 6: RLS policies — household-scoped
-- ================================================================

-- Active household members can read all account configs for their household.
drop policy if exists trading_account_config_member_read on public.trading_account_config;
create policy trading_account_config_member_read
  on public.trading_account_config
  for select
  using (
    household_id is not null
    and public.is_household_member(household_id)
  );

-- Active household members may create new account configs within their household.
drop policy if exists trading_account_config_member_insert on public.trading_account_config;
create policy trading_account_config_member_insert
  on public.trading_account_config
  for insert
  with check (
    household_id is not null
    and public.is_household_member(household_id)
  );

-- Active household members may update account configs in their household.
drop policy if exists trading_account_config_member_update on public.trading_account_config;
create policy trading_account_config_member_update
  on public.trading_account_config
  for update
  using (
    household_id is not null
    and public.is_household_member(household_id)
  );

-- Only the household owner (role='owner') may hard-delete account configs.
-- Per Decision #1: hard-delete is permitted for the household owner.
drop policy if exists trading_account_config_owner_delete on public.trading_account_config;
create policy trading_account_config_owner_delete
  on public.trading_account_config
  for delete
  using (
    household_id is not null
    and public.is_household_owner(household_id)
  );

-- end of migration
