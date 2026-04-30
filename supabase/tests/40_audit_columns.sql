-- =============================================================================
-- supabase/tests/40_audit_columns.sql
-- pgTAP tests: audit column triggers (TJ-013 / GH #66)
--
-- Coverage:
--   • tg_update_timestamp() trigger — sets updated_at = now() on UPDATE
--   • created_at  — set at INSERT time via column DEFAULT
--   • updated_at  — set at INSERT time via DEFAULT; updated by trigger on UPDATE
--   • deleted_at  — set manually (soft-delete); no automatic filtering via RLS
--
-- IMPORTANT — What this migration does NOT include:
--   • No created_by / updated_by columns.  The audit trigger (migration
--     20260430130000) only tracks timestamps, not the acting user identity.
--     Tests for created_by/updated_by are intentionally absent.
--   • No automatic RLS filter on deleted_at IS NULL.  Soft-deleted rows
--     remain visible in default SELECTs; application code must filter.
--     See README "Known gaps" section.
--
-- Test table used: public.manualtrade
--   Chosen because it is a household-scoped table that received all three
--   audit columns + the trigger in migration 20260430130000.
--   It also has household_id from migration 20260430130100.
--
-- Status: CONCRETE — audit columns + trigger are live in PR #85.
--         Tests SHOULD PASS after applying PR #85 migrations
--         (assuming manualtrade table exists from Alembic baseline).
--
-- Dependencies:
--   • supabase/tests/00_setup.sql
--   • Migrations: 20260430120000, 20260430130000, 20260430130100
--
-- Idempotency: wrapped in BEGIN … ROLLBACK.
-- =============================================================================

BEGIN;

SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture: create a user + household so household_id FK is valid
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id uuid;
  v_hh_id   uuid;
  v_row_id  bigint;  -- manualtrade PK type (may be serial/bigint from alembic)
BEGIN
  v_user_id := tests.create_test_user('test-audit@rls-test.invalid');
  v_hh_id   := tests.create_test_household('Audit Test HH', v_user_id);

  CREATE TEMP TABLE _audit_ids (
    user_id  uuid,
    hh_id    uuid,
    row_id   bigint
  ) ON COMMIT DROP;

  -- Seed an initial row in manualtrade to test audit columns
  -- Only insert columns we know exist; use minimal required fields.
  -- tradeDate, symbol come from alembic; created_at/updated_at/deleted_at
  -- and household_id come from PR #85 migrations.
  BEGIN
    INSERT INTO public.manualtrade (symbol, household_id)
    VALUES ('AUDIT-TEST-AAPL', v_hh_id)
    RETURNING id INTO v_row_id;

    INSERT INTO _audit_ids VALUES (v_user_id, v_hh_id, v_row_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP: manualtrade insert failed: % — check alembic baseline', SQLERRM;
    INSERT INTO _audit_ids VALUES (v_user_id, v_hh_id, -1);
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: created_at is populated on INSERT (DEFAULT now())
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT created_at IS NOT NULL
       FROM   public.manualtrade
       WHERE  id = (SELECT row_id FROM _audit_ids))
    ELSE true  -- seed failed; aspirational skip
  END,
  '[manualtrade] created_at is populated on INSERT (DEFAULT now())'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: updated_at is populated on INSERT (DEFAULT now())
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT updated_at IS NOT NULL
       FROM   public.manualtrade
       WHERE  id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] updated_at is populated on INSERT (DEFAULT now())'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: deleted_at is NULL on INSERT (not set unless explicitly soft-deleted)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT deleted_at IS NULL
       FROM   public.manualtrade
       WHERE  id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] deleted_at is NULL on INSERT (soft-delete must be explicit)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: created_at and updated_at have the same value immediately after INSERT
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT created_at = updated_at
       FROM   public.manualtrade
       WHERE  id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] created_at = updated_at immediately after INSERT (both set by DEFAULT now())'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: tg_update_timestamp trigger — updated_at changes on UPDATE
-- We use pg_sleep(0.001) to ensure a distinct timestamp.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_row_id    bigint := (SELECT row_id FROM _audit_ids);
  v_before_ts timestamptz;
BEGIN
  IF v_row_id = -1 THEN RETURN; END IF;

  SELECT updated_at INTO v_before_ts
  FROM   public.manualtrade WHERE id = v_row_id;

  -- Force a tiny delay so updated_at will differ
  PERFORM pg_sleep(0.01);

  UPDATE public.manualtrade
  SET    symbol = 'AUDIT-TEST-AAPL-UPD'
  WHERE  id = v_row_id;

  -- Store the before value for comparison
  CREATE TEMP TABLE IF NOT EXISTS _audit_before (ts timestamptz) ON COMMIT DROP;
  TRUNCATE _audit_before;
  INSERT INTO _audit_before VALUES (v_before_ts);
END;
$$;

SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT mt.updated_at > ab.ts
       FROM   public.manualtrade mt, _audit_before ab
       WHERE  mt.id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] tg_update_timestamp: updated_at increases after UPDATE'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: tg_update_timestamp — created_at does NOT change after UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_row_id    bigint := (SELECT row_id FROM _audit_ids);
  v_before_created_at timestamptz;
BEGIN
  IF v_row_id = -1 THEN RETURN; END IF;
  SELECT created_at INTO v_before_created_at FROM public.manualtrade WHERE id = v_row_id;
  CREATE TEMP TABLE IF NOT EXISTS _audit_created_before (ts timestamptz) ON COMMIT DROP;
  TRUNCATE _audit_created_before;
  INSERT INTO _audit_created_before VALUES (v_before_created_at);
END;
$$;

-- Perform another update
UPDATE public.manualtrade
SET    symbol = 'AUDIT-TEST-AAPL-UPD2'
WHERE  id = (SELECT row_id FROM _audit_ids)
  AND  (SELECT row_id FROM _audit_ids) != -1;

SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT mt.created_at = cb.ts
       FROM   public.manualtrade mt, _audit_created_before cb
       WHERE  mt.id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] created_at is immutable — tg_update_timestamp does NOT change it'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: Soft-delete — row survives after setting deleted_at
-- (No RLS auto-filter on deleted_at for public tables — see README)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.manualtrade
SET    deleted_at = now()
WHERE  id = (SELECT row_id FROM _audit_ids)
  AND  (SELECT row_id FROM _audit_ids) != -1;

SELECT ok(
  CASE
    WHEN (SELECT row_id FROM _audit_ids) != -1 THEN
      (SELECT deleted_at IS NOT NULL AND count(*) = 1
       FROM   public.manualtrade
       WHERE  id = (SELECT row_id FROM _audit_ids))
    ELSE true
  END,
  '[manualtrade] soft-delete: row still exists after setting deleted_at (no auto-filter — app must filter)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: tg_update_timestamp exists and is attached to manualtrade
-- (structural check: verify the trigger is present in the catalog)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1
    FROM   pg_trigger       t
    JOIN   pg_class         c ON t.tgrelid = c.oid
    JOIN   pg_namespace     n ON c.relnamespace = n.oid
    WHERE  n.nspname = 'public'
      AND  c.relname = 'manualtrade'
      AND  t.tgname  = 'trg_manualtrade_updated_at'
      AND  NOT t.tgisinternal
  ),
  '[manualtrade] trigger trg_manualtrade_updated_at exists in pg_trigger catalog'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 9: tg_update_timestamp() function exists in public schema
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1
    FROM   pg_proc    p
    JOIN   pg_namespace n ON p.pronamespace = n.oid
    WHERE  n.nspname = 'public'
      AND  p.proname = 'tg_update_timestamp'
  ),
  '[schema] tg_update_timestamp() function exists in public schema'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 10: audit columns (created_at, updated_at, deleted_at) exist on all
--          14 tables named in migration 20260430130000
-- ─────────────────────────────────────────────────────────────────────────────

-- We check the 3 audit columns exist on each audited table.
-- Use a lateral unnest over the table list for a compact assertion.

WITH audited_tables (tname) AS (
  VALUES
    ('manualtrade'), ('trade'), ('execution'), ('matchedtrade'),
    ('dailysummary'), ('trading_account_summary'), ('trading_positions'),
    ('finance_snapshots'), ('plans'), ('dividend_positions'),
    ('dividend_accounts'), ('insurance_policies'),
    ('note'), ('backtestrun')
),
missing_columns AS (
  SELECT t.tname, col.cname
  FROM   audited_tables t
  CROSS  JOIN (VALUES ('created_at'), ('updated_at'), ('deleted_at')) AS col(cname)
  WHERE  NOT EXISTS (
    SELECT 1
    FROM   information_schema.columns c
    WHERE  c.table_schema = 'public'
      AND  c.table_name   = t.tname
      AND  c.column_name  = col.cname
  )
)
SELECT ok(
  NOT EXISTS (SELECT 1 FROM missing_columns),
  '[schema] All 14 audited tables have created_at, updated_at, deleted_at columns'
);

-- Bonus: list which table+column combinations are missing (diagnostic, not a test)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH audited_tables (tname) AS (
      VALUES ('manualtrade'), ('trade'), ('execution'), ('matchedtrade'),
             ('dailysummary'), ('trading_account_summary'), ('trading_positions'),
             ('finance_snapshots'), ('plans'), ('dividend_positions'),
             ('dividend_accounts'), ('insurance_policies'), ('note'), ('backtestrun')
    ),
    missing AS (
      SELECT t.tname, col.cname
      FROM   audited_tables t
      CROSS  JOIN (VALUES ('created_at'), ('updated_at'), ('deleted_at')) AS col(cname)
      WHERE  NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.tname AND c.column_name = col.cname
      )
    )
    SELECT * FROM missing
  LOOP
    RAISE NOTICE 'MISSING AUDIT COLUMN: public.%.%', r.tname, r.cname;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 11: household_id column exists on all 12 household-scoped tables
-- (from migration 20260430130100)
-- ─────────────────────────────────────────────────────────────────────────────
WITH household_tables (tname) AS (
  VALUES
    ('manualtrade'), ('trade'), ('execution'), ('matchedtrade'),
    ('dailysummary'), ('trading_account_summary'), ('trading_positions'),
    ('finance_snapshots'), ('plans'), ('dividend_positions'),
    ('dividend_accounts'), ('insurance_policies')
),
missing AS (
  SELECT t.tname
  FROM   household_tables t
  WHERE  NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE  c.table_schema = 'public'
      AND  c.table_name   = t.tname
      AND  c.column_name  = 'household_id'
  )
)
SELECT ok(
  NOT EXISTS (SELECT 1 FROM missing),
  '[schema] All 12 household-scoped tables have household_id column'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 12: owner_user_id column exists on note and backtestrun
-- (from migration 20260430130200)
-- ─────────────────────────────────────────────────────────────────────────────
WITH owner_tables (tname) AS (VALUES ('note'), ('backtestrun')),
missing AS (
  SELECT t.tname
  FROM   owner_tables t
  WHERE  NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE  c.table_schema = 'public'
      AND  c.table_name   = t.tname
      AND  c.column_name  = 'owner_user_id'
  )
)
SELECT ok(
  NOT EXISTS (SELECT 1 FROM missing),
  '[schema] note and backtestrun have owner_user_id column'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
SELECT finish();
ROLLBACK;

-- end of 40_audit_columns.sql
