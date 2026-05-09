-- ================================================================
-- Migration: seed_canonical_accounts
-- Issue: #340 Phase 2d — pre-create 3 canonical trading accounts
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
--
-- Seed 3 canonical accounts in trading_account_config.
-- Idempotent: uses UPSERT logic to preserve existing connection settings
-- for IBKR and create placeholder entries for Schwab + LeumiIRA.
--
-- Per Jony's directive (copilot-directive-3-account-names.md):
-- - InteractiveBrokers (account_type='ibkr') — canonical IBKR connection
-- - Schwab (account_type='schwab') — manual-only, no broker sync
-- - LeumiIRA (account_type='ira') — manual-only, no broker sync
--
-- Placeholder values for manual-only accounts: host='', port=0, client_id=0

-- ----------------------------------------------------------------
-- 1. Update IBKR: force display name to 'InteractiveBrokers'
-- ----------------------------------------------------------------

update public.trading_account_config
   set name = 'InteractiveBrokers'
 where account_type = 'ibkr';

-- ----------------------------------------------------------------
-- 2. Insert IBKR if it doesn't exist (preserve any existing connection)
-- ----------------------------------------------------------------

insert into public.trading_account_config
  (name, account_type, host, port, client_id, account_id, compute_options_income)
select
  'InteractiveBrokers',
  'ibkr',
  '',
  0,
  0,
  'U2515365',
  true
where not exists (
  select 1 from public.trading_account_config where account_type = 'ibkr'
);

-- ----------------------------------------------------------------
-- 3. Insert Schwab if it doesn't exist (manual-only, no broker connection)
-- ----------------------------------------------------------------

insert into public.trading_account_config
  (name, account_type, host, port, client_id, compute_options_income)
select
  'Schwab',
  'schwab',
  '',
  0,
  0,
  false
where not exists (
  select 1 from public.trading_account_config where account_type = 'schwab'
);

-- ----------------------------------------------------------------
-- 4. Insert LeumiIRA if it doesn't exist (manual-only, no broker connection)
-- ----------------------------------------------------------------

insert into public.trading_account_config
  (name, account_type, host, port, client_id, compute_options_income)
select
  'LeumiIRA',
  'ira',
  '',
  0,
  0,
  false
where not exists (
  select 1 from public.trading_account_config where account_type = 'ira'
);
