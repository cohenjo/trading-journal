-- Migration: options_ladder_schema_close
-- Purpose: Close-out migration for #191 (options schema) and #192 (ladder schema).
--          All major tables landed in earlier migrations; this file addresses the
--          single gap flagged by the Supabase performance advisor: the FK column
--          `options_margin_snapshots.account_config_id` had no covering index.
--
-- Tables already in place (no changes needed here):
--   options (#191):
--     options_income                  — 20260503142446
--     options_flex_sync_state         — 20260504134438
--     options_legs                    — 20260504134438
--     options_strategy_groups         — 20260504134438
--     options_trades                  — 20260504134438
--     options_cash_events             — 20260504134438
--     options_positions               — 20260504134438
--     options_roll_events             — 20260504134438
--     options_dashboard_monthly       — 20260504134438
--     options_strategy_capital_history — 20260504150112
--     options_margin_snapshots        — 20260504150112
--   ladder (#192):
--     ladder_rungs                    — 20260503142507
--     ladder_bonds                    — 20260503142507
--
-- All tables above have RLS enabled and household-scoped member/writer policies.

-- ── options_margin_snapshots: add index for account_config_id FK ─────────────
-- Supabase performance advisor (2026-05-05) flagged this FK as unindexed.
-- account_config_id is nullable (outer-join query path), so a partial index
-- covering non-null values keeps it small while still satisfying the FK scan.
CREATE INDEX IF NOT EXISTS options_margin_snapshots_account_config_id_idx
  ON public.options_margin_snapshots (account_config_id)
  WHERE account_config_id IS NOT NULL;

-- ── Table documentation ───────────────────────────────────────────────────────
-- Options domain (#191)
COMMENT ON TABLE public.options_income IS
  'Yearly options premium income rollup per household. Lightweight dashboard aggregate.';

COMMENT ON TABLE public.options_flex_sync_state IS
  'Per-account IBKR Flex / ib_gateway sync cursor and status. Prevents duplicate ingestion.';

COMMENT ON TABLE public.options_legs IS
  'Canonical option contract definitions (symbol, expiry, strike, right, multiplier). '
  'One row per unique option leg; referenced by options_trades and options_positions.';

COMMENT ON TABLE public.options_strategy_groups IS
  'Groups related option trades into named strategies (CSP, vertical spread, roll chain). '
  'Tracks aggregate P&L, capital-at-risk, and strategy lifecycle status.';

COMMENT ON TABLE public.options_trades IS
  'Individual fill-level option trade events (open, close, expire, assign, exercise). '
  'Source of truth for FIFO lot matching and realized-P&L calculation.';

COMMENT ON TABLE public.options_cash_events IS
  'Non-trade cash movements related to options accounts: commissions, dividends, '
  'interest, transfers, and tax withholding.';

COMMENT ON TABLE public.options_positions IS
  'Current open option positions per account/leg. Rebuilt on each sync pass from trades.';

COMMENT ON TABLE public.options_roll_events IS
  'Detected roll pairs: a closing trade and the opening trade that rolled it. '
  'Classified as positive/negative/neutral; used by roll-efficiency dashboard metrics.';

COMMENT ON TABLE public.options_dashboard_monthly IS
  'Monthly aggregated options dashboard metrics: premium, commissions, roll counts, '
  'capital-at-risk, and margin utilization. Consumed by the frontend chart widgets.';

COMMENT ON TABLE public.options_strategy_capital_history IS
  'Point-in-time capital-at-risk snapshots for each strategy group. '
  'Enables trend charts and time-weighted return-on-capital calculations.';

COMMENT ON TABLE public.options_margin_snapshots IS
  'Account-wide margin/buying-power snapshots captured on each sync pass. '
  'Powers the margin utilization gauge on the options dashboard.';

-- Ladder domain (#192)
COMMENT ON TABLE public.ladder_rungs IS
  'Bond/CD ladder rungs (years). Each rung defines a maturity window, target principal, '
  'and current allocated principal. Parent record for ladder_bonds.';

COMMENT ON TABLE public.ladder_bonds IS
  'Individual bonds or CDs allocated to a ladder rung. Tracks issuer, face value, '
  'coupon rate, coupon frequency, and maturity date.';
