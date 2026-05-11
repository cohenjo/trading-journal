-- Migration: add_rls_policies_dividend_disable_security_reference
-- Issue: #374 — 3 tables RLS-enabled with zero policies
-- Author: Hockney (Backend Dev)
--
-- security_reference: global reference table (ticker → company/sector metadata).
-- Service role writes only; no per-household data. Disabling RLS is correct:
-- authenticated users should be able to read all tickers without restriction.
ALTER TABLE public.security_reference DISABLE ROW LEVEL SECURITY;

-- dividend_payments and dividend_accruals: household-scoped via trading_account_config.
-- These tables carry account_id TEXT (IBKR broker account number, e.g. 'U2515365').
-- Household scope is resolved by joining through trading_account_config on account_id.
-- The canonical is_household_member() SECURITY DEFINER function is used for consistency
-- with stock_positions, trading_account_config, and all other household-scoped tables.
--
-- Backend worker writes (options_sync.py via SQLAlchemy direct connection) bypass RLS
-- entirely — no INSERT/UPDATE/DELETE policies are needed for the ingest pipeline.
-- Only SELECT policies are added for authenticated frontend reads.

CREATE POLICY "dividend_payments_select"
  ON public.dividend_payments
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM public.trading_account_config
      WHERE account_id IS NOT NULL
        AND is_household_member(household_id)
    )
  );

CREATE POLICY "dividend_accruals_select"
  ON public.dividend_accruals
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM public.trading_account_config
      WHERE account_id IS NOT NULL
        AND is_household_member(household_id)
    )
  );
