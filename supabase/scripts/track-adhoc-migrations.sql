-- ================================================================
-- Runbook: track-adhoc-migrations.sql
-- Issue:   #335 — Audit + reconcile Supabase migration drift
-- Author:  Kujan (DevOps/Platform)
-- Date:    2026-05-11
-- ================================================================
--
-- BACKGROUND
-- ----------
-- On 2026-05-10 the Flex pipeline Phase 1 schema was applied directly
-- to the production database (ad-hoc, outside the Supabase CLI migration
-- flow) to meet deployment timing.  The DDL ran successfully and all
-- schema objects exist in prod, but `supabase_migrations.schema_migrations`
-- had no rows for these versions.
--
-- As a result, `supabase db push` treated them as pending and would
-- attempt to re-apply the DDL — which would fail because the objects
-- already exist (particularly the non-idempotent ADD CONSTRAINT in
-- 000200).
--
-- Additionally, 20260511052500 (a data backfill) was applied separately
-- and was also untracked.
--
-- This script registers all 6 migrations as applied WITHOUT re-running
-- any DDL.  It is idempotent: ON CONFLICT (version) DO NOTHING.
--
-- SCHEMA OBJECTS VERIFIED IN PROD BEFORE THIS SCRIPT WAS RUN
-- ----------------------------------------------------------
-- 000100: stock_positions.listing_exchange column (+ 7 other flex cols + index)  ✅
-- 000200: bond_holdings.cusip column (+ 17 other flex cols + index + constraint)  ✅
-- 000300: dividend_payments table (+ indexes + RLS enabled)                       ✅
-- 000400: dividend_accruals table  (+ indexes + RLS enabled)                      ✅
-- 000500: security_reference table (+ indexes + RLS enabled)                      ✅
-- 052500: trading_account_config backfill — zero NULL household_id rows in prod   ✅
--
-- ROLLBACK (no schema change — tracking only)
-- -------------------------------------------
-- DELETE FROM supabase_migrations.schema_migrations
--   WHERE version IN (
--     '20260510000100', '20260510000200', '20260510000300',
--     '20260510000400', '20260510000500', '20260511052500'
--   );
-- ================================================================

BEGIN;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260510000100', 'extend_stock_positions_flex_fields',
   ARRAY['-- ad-hoc applied 2026-05-10; tracked retrospectively 2026-05-11']),

  ('20260510000200', 'flex_bond_holdings_snapshot',
   ARRAY['-- ad-hoc applied 2026-05-10; tracked retrospectively 2026-05-11']),

  ('20260510000300', 'dividend_payments',
   ARRAY['-- ad-hoc applied 2026-05-10; tracked retrospectively 2026-05-11']),

  ('20260510000400', 'dividend_accruals',
   ARRAY['-- ad-hoc applied 2026-05-10; tracked retrospectively 2026-05-11']),

  ('20260510000500', 'security_reference',
   ARRAY['-- ad-hoc applied 2026-05-10; tracked retrospectively 2026-05-11']),

  ('20260511052500', 'backfill_placeholder_account_households',
   ARRAY['-- ad-hoc applied 2026-05-11; tracked retrospectively 2026-05-11'])

ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ================================================================
-- VERIFICATION QUERY (run after to confirm)
-- ================================================================
-- SELECT version, name
--   FROM supabase_migrations.schema_migrations
--  WHERE version IN (
--    '20260510000100', '20260510000200', '20260510000300',
--    '20260510000400', '20260510000500', '20260511052500'
--  )
--  ORDER BY version;
--
-- Expected: 6 rows returned.
-- ================================================================
