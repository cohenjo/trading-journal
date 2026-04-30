-- ⚠️ AWAITING USER DECISION (see GH #58 comments and GH #56 Open Question 2).
--    NOT EXECUTED. Sketch only.
--
-- Migration: 20260430130300_split_trading_account_config
-- Created: 2026-04-30
-- Author: Hockney (Backend Dev) for TJ-005 / GH #58
--
-- BACKGROUND
-- ----------
-- trading_account_config mixes two ownership tiers:
--
--   Household-visible metadata:
--     id, name, account_type, host, port, client_id,
--     linked_account_id, account_id, last_synced
--
--   Owner-private secrets:
--     app_key, app_secret, account_hash, tokens_path
--
-- Applying a single RLS policy to this table is not possible without
-- column-level security (complex) or a table split.
-- Jony + Rabin must choose one of the three options below before
-- this migration can be executed.
--
-- ================================================================
-- OPTION A: Split into two tables
-- ================================================================
-- Step 1: Add household_id to the metadata table (rename implied)

/*
begin;

-- 1a. Add household scoping to the config metadata
alter table public.trading_account_config
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists trading_account_config_household_id_idx
  on public.trading_account_config (household_id);

-- 1b. Create owner-private secrets table
create table if not exists public.trading_account_secrets (
  id                  serial primary key,
  account_config_id   int not null references public.trading_account_config(id) on delete cascade,
  owner_user_id       uuid not null references auth.users(id) on delete cascade,
  app_key             text,
  app_secret          text,     -- ⚠️ Consider Supabase Vault instead (see Option C)
  account_hash        text,
  tokens_path         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists trading_account_secrets_config_idx
  on public.trading_account_secrets (account_config_id);
create index if not exists trading_account_secrets_owner_idx
  on public.trading_account_secrets (owner_user_id);

-- 1c. Migrate existing secret values
insert into public.trading_account_secrets
  (account_config_id, owner_user_id, app_key, app_secret, account_hash, tokens_path)
select id, null, app_key, app_secret, account_hash, tokens_path
from   public.trading_account_config
where  app_key is not null or app_secret is not null
    or account_hash is not null or tokens_path is not null;
-- NOTE: owner_user_id will be null until backfill; set NOT NULL only after backfill.

-- 1d. Null out secret columns in original table (keep for backfill verification)
update public.trading_account_config set
  app_key      = null,
  app_secret   = null,
  account_hash = null,
  tokens_path  = null;

-- 1e. (After verification) drop secret columns from config table:
-- alter table public.trading_account_config drop column if exists app_key;
-- alter table public.trading_account_config drop column if exists app_secret;
-- alter table public.trading_account_config drop column if exists account_hash;
-- alter table public.trading_account_config drop column if exists tokens_path;

commit;
*/

-- ================================================================
-- OPTION B: Keep one table, add both FKs, use column-level grants
-- ================================================================
-- (Not recommended — Postgres column-level RLS is cumbersome and
--  does not compose cleanly with row-level policies in Supabase.)

/*
alter table public.trading_account_config
  add column if not exists household_id  uuid references public.households(id)  on delete cascade,
  add column if not exists owner_user_id uuid references auth.users(id)          on delete cascade;

-- RLS would require two separate policies:
-- SELECT policy for household columns: USING (is_household_member(household_id))
-- SELECT policy for secret columns: no standard way; requires views or security barrier
-- → This approach deferred pending Jony + Rabin decision.
*/

-- ================================================================
-- OPTION C: Move secrets to Supabase Vault
-- ================================================================
-- (Cleanest for security; requires Vault extension to be enabled.)

/*
-- Enable vault (if not already):
-- create extension if not exists supabase_vault;

-- For each row in trading_account_config that has secrets:
-- INSERT INTO vault.secrets (secret, name, description)
--   VALUES (<app_secret>, 'tac_' || id::text || '_app_secret', 'Schwab app_secret for config ' || id::text)
-- Then store only the vault secret_id in trading_account_config.
-- Requires application-layer changes to retrieve secrets via vault.decrypted_secrets view.
*/

-- ================================================================
-- USER DECISION REQUIRED
-- ================================================================
-- Please comment on GH #58 with your chosen option (A, B, or C).
-- Hockney will implement once the decision is recorded in .squad/decisions.md.

-- end of migration (SKETCH — not executable)
