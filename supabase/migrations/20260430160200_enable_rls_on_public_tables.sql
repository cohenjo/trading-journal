-- Migration: 20260430160200_enable_rls_on_public_tables
-- Author: Rabin (Security Engineer)
-- Purpose: Close Supabase advisor finding rls_disabled_in_public for issue #97.
--
-- Threat model:
--   * The anon API key is intentionally public. Any table in public with RLS disabled
--     is effectively exposed through PostgREST once a route or grant permits access.
--   * Authenticated users must only see household data they are active members of,
--     owner-private rows they own, or global reference/market data.
--   * Market data is read-only to authenticated clients. Writes are reserved for
--     service_role jobs; service_role bypasses RLS in Supabase unless FORCE RLS is set.
--
-- Policy shape:
--   * Household-scoped tables with existing household_id: SELECT to active household
--     members; INSERT/UPDATE/DELETE to household writers (owner/member, not viewer).
--   * Owner-private tables from 20260430130200 (note, backtestrun): owner_user_id = auth.uid().
--   * backtesttrade: inherits owner-private access through backtestrun.run_id.
--   * Reference tables: SELECT to authenticated only; no anon or authenticated writes.
--
-- Existing nullable ownership columns are not backfilled here. Legacy rows with NULL
-- household_id/owner_user_id remain hidden from authenticated users until a separate,
-- data-aware backfill assigns ownership. That is safer than guessing tenancy.

-- ============================================================
-- Household-scoped tables: household_id already added in 20260430130100.
-- ============================================================

-- manualtrade: household-scoped via public.manualtrade.household_id.
ALTER TABLE public.manualtrade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manualtrade_select ON public.manualtrade;
DROP POLICY IF EXISTS manualtrade_insert ON public.manualtrade;
DROP POLICY IF EXISTS manualtrade_update ON public.manualtrade;
DROP POLICY IF EXISTS manualtrade_delete ON public.manualtrade;
CREATE POLICY manualtrade_select ON public.manualtrade FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY manualtrade_insert ON public.manualtrade FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY manualtrade_update ON public.manualtrade FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY manualtrade_delete ON public.manualtrade FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- trade: household-scoped via public.trade.household_id.
ALTER TABLE public.trade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_select ON public.trade;
DROP POLICY IF EXISTS trade_insert ON public.trade;
DROP POLICY IF EXISTS trade_update ON public.trade;
DROP POLICY IF EXISTS trade_delete ON public.trade;
CREATE POLICY trade_select ON public.trade FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY trade_insert ON public.trade FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trade_update ON public.trade FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trade_delete ON public.trade FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- execution: household-scoped via public.execution.household_id.
ALTER TABLE public.execution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_select ON public.execution;
DROP POLICY IF EXISTS execution_insert ON public.execution;
DROP POLICY IF EXISTS execution_update ON public.execution;
DROP POLICY IF EXISTS execution_delete ON public.execution;
CREATE POLICY execution_select ON public.execution FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY execution_insert ON public.execution FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY execution_update ON public.execution FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY execution_delete ON public.execution FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- matchedtrade: household-scoped via public.matchedtrade.household_id.
ALTER TABLE public.matchedtrade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matchedtrade_select ON public.matchedtrade;
DROP POLICY IF EXISTS matchedtrade_insert ON public.matchedtrade;
DROP POLICY IF EXISTS matchedtrade_update ON public.matchedtrade;
DROP POLICY IF EXISTS matchedtrade_delete ON public.matchedtrade;
CREATE POLICY matchedtrade_select ON public.matchedtrade FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY matchedtrade_insert ON public.matchedtrade FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY matchedtrade_update ON public.matchedtrade FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY matchedtrade_delete ON public.matchedtrade FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- dailysummary: household-scoped via public.dailysummary.household_id.
ALTER TABLE public.dailysummary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dailysummary_select ON public.dailysummary;
DROP POLICY IF EXISTS dailysummary_insert ON public.dailysummary;
DROP POLICY IF EXISTS dailysummary_update ON public.dailysummary;
DROP POLICY IF EXISTS dailysummary_delete ON public.dailysummary;
CREATE POLICY dailysummary_select ON public.dailysummary FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY dailysummary_insert ON public.dailysummary FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dailysummary_update ON public.dailysummary FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dailysummary_delete ON public.dailysummary FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- trading_account_summary: household-scoped via public.trading_account_summary.household_id.
ALTER TABLE public.trading_account_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_account_summary_select ON public.trading_account_summary;
DROP POLICY IF EXISTS trading_account_summary_insert ON public.trading_account_summary;
DROP POLICY IF EXISTS trading_account_summary_update ON public.trading_account_summary;
DROP POLICY IF EXISTS trading_account_summary_delete ON public.trading_account_summary;
CREATE POLICY trading_account_summary_select ON public.trading_account_summary FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY trading_account_summary_insert ON public.trading_account_summary FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trading_account_summary_update ON public.trading_account_summary FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trading_account_summary_delete ON public.trading_account_summary FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- trading_positions: household-scoped via public.trading_positions.household_id.
ALTER TABLE public.trading_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_positions_select ON public.trading_positions;
DROP POLICY IF EXISTS trading_positions_insert ON public.trading_positions;
DROP POLICY IF EXISTS trading_positions_update ON public.trading_positions;
DROP POLICY IF EXISTS trading_positions_delete ON public.trading_positions;
CREATE POLICY trading_positions_select ON public.trading_positions FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY trading_positions_insert ON public.trading_positions FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trading_positions_update ON public.trading_positions FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY trading_positions_delete ON public.trading_positions FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- finance_snapshots: household-scoped via public.finance_snapshots.household_id.
ALTER TABLE public.finance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_snapshots_select ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_insert ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_update ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_delete ON public.finance_snapshots;
CREATE POLICY finance_snapshots_select ON public.finance_snapshots FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY finance_snapshots_insert ON public.finance_snapshots FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY finance_snapshots_update ON public.finance_snapshots FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY finance_snapshots_delete ON public.finance_snapshots FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- plans: household-scoped via public.plans.household_id.
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_select ON public.plans;
DROP POLICY IF EXISTS plans_insert ON public.plans;
DROP POLICY IF EXISTS plans_update ON public.plans;
DROP POLICY IF EXISTS plans_delete ON public.plans;
CREATE POLICY plans_select ON public.plans FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY plans_insert ON public.plans FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY plans_update ON public.plans FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY plans_delete ON public.plans FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- dividend_positions: household-scoped via public.dividend_positions.household_id.
ALTER TABLE public.dividend_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dividend_positions_select ON public.dividend_positions;
DROP POLICY IF EXISTS dividend_positions_insert ON public.dividend_positions;
DROP POLICY IF EXISTS dividend_positions_update ON public.dividend_positions;
DROP POLICY IF EXISTS dividend_positions_delete ON public.dividend_positions;
CREATE POLICY dividend_positions_select ON public.dividend_positions FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY dividend_positions_insert ON public.dividend_positions FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dividend_positions_update ON public.dividend_positions FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dividend_positions_delete ON public.dividend_positions FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- dividend_accounts: household-scoped via public.dividend_accounts.household_id.
ALTER TABLE public.dividend_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dividend_accounts_select ON public.dividend_accounts;
DROP POLICY IF EXISTS dividend_accounts_insert ON public.dividend_accounts;
DROP POLICY IF EXISTS dividend_accounts_update ON public.dividend_accounts;
DROP POLICY IF EXISTS dividend_accounts_delete ON public.dividend_accounts;
CREATE POLICY dividend_accounts_select ON public.dividend_accounts FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY dividend_accounts_insert ON public.dividend_accounts FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dividend_accounts_update ON public.dividend_accounts FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY dividend_accounts_delete ON public.dividend_accounts FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- insurance_policies: household-scoped via public.insurance_policies.household_id.
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insurance_policies_select ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_insert ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_update ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_delete ON public.insurance_policies;
CREATE POLICY insurance_policies_select ON public.insurance_policies FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY insurance_policies_insert ON public.insurance_policies FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY insurance_policies_update ON public.insurance_policies FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY insurance_policies_delete ON public.insurance_policies FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- ============================================================
-- Owner-private tables: no household_id by design in 20260430130200.
-- These tables use owner_user_id rather than a guessed household backfill.
-- ============================================================

-- note: owner-private via public.note.owner_user_id.
ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_select ON public.note;
DROP POLICY IF EXISTS note_insert ON public.note;
DROP POLICY IF EXISTS note_update ON public.note;
DROP POLICY IF EXISTS note_delete ON public.note;
CREATE POLICY note_select ON public.note FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY note_insert ON public.note FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY note_update ON public.note FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY note_delete ON public.note FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- backtestrun: owner-private via public.backtestrun.owner_user_id.
ALTER TABLE public.backtestrun ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backtestrun_select ON public.backtestrun;
DROP POLICY IF EXISTS backtestrun_insert ON public.backtestrun;
DROP POLICY IF EXISTS backtestrun_update ON public.backtestrun;
DROP POLICY IF EXISTS backtestrun_delete ON public.backtestrun;
CREATE POLICY backtestrun_select ON public.backtestrun FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY backtestrun_insert ON public.backtestrun FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY backtestrun_update ON public.backtestrun FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY backtestrun_delete ON public.backtestrun FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- backtesttrade: no household_id/owner_user_id by design; access inherits from parent backtestrun.run_id.
ALTER TABLE public.backtesttrade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backtesttrade_select ON public.backtesttrade;
DROP POLICY IF EXISTS backtesttrade_insert ON public.backtesttrade;
DROP POLICY IF EXISTS backtesttrade_update ON public.backtesttrade;
DROP POLICY IF EXISTS backtesttrade_delete ON public.backtesttrade;
CREATE POLICY backtesttrade_select ON public.backtesttrade FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.backtestrun r
      WHERE r.id = backtesttrade.run_id
        AND r.owner_user_id = auth.uid()
    )
  );
CREATE POLICY backtesttrade_insert ON public.backtesttrade FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.backtestrun r
      WHERE r.id = backtesttrade.run_id
        AND r.owner_user_id = auth.uid()
    )
  );
CREATE POLICY backtesttrade_update ON public.backtesttrade FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.backtestrun r
      WHERE r.id = backtesttrade.run_id
        AND r.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.backtestrun r
      WHERE r.id = backtesttrade.run_id
        AND r.owner_user_id = auth.uid()
    )
  );
CREATE POLICY backtesttrade_delete ON public.backtesttrade FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.backtestrun r
      WHERE r.id = backtesttrade.run_id
        AND r.owner_user_id = auth.uid()
    )
  );

-- ============================================================
-- Reference / market-data tables: authenticated read-only.
-- No write policies for authenticated or anon; ingestion uses service_role.
-- ============================================================

ALTER TABLE public.dailybar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dailybar_select ON public.dailybar;
CREATE POLICY dailybar_select ON public.dailybar FOR SELECT TO authenticated USING (true);

ALTER TABLE public.ndx1m ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ndx1m_select ON public.ndx1m;
CREATE POLICY ndx1m_select ON public.ndx1m FOR SELECT TO authenticated USING (true);

ALTER TABLE public.optioncontract ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS optioncontract_select ON public.optioncontract;
CREATE POLICY optioncontract_select ON public.optioncontract FOR SELECT TO authenticated USING (true);

ALTER TABLE public.historicaloptionbar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS historicaloptionbar_select ON public.historicaloptionbar;
CREATE POLICY historicaloptionbar_select ON public.historicaloptionbar FOR SELECT TO authenticated USING (true);

ALTER TABLE public.dividend_ticker_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dividend_ticker_data_select ON public.dividend_ticker_data;
CREATE POLICY dividend_ticker_data_select ON public.dividend_ticker_data FOR SELECT TO authenticated USING (true);

-- end of migration
