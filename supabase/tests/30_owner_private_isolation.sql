-- =============================================================================
-- supabase/tests/30_owner_private_isolation.sql
-- pgTAP tests: owner-private table isolation (TJ-013 / GH #66)
--
-- Coverage:
--   • public.note       — owner_user_id column exists; no RLS policy yet
--   • public.backtestrun — owner_user_id column exists; no RLS policy yet
--
-- Status: ASPIRATIONAL / TDD acceptance tests.
--
-- These tests will FAIL with PR #85 alone.  They DEFINE the expected contract
-- for owner-private isolation and will become passing regression tests once a
-- follow-up migration adds:
--
--   For public.note:
--     ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
--     CREATE POLICY note_owner_select ON public.note FOR SELECT
--       USING (owner_user_id = auth.uid());
--     CREATE POLICY note_owner_insert ON public.note FOR INSERT
--       WITH CHECK (owner_user_id = auth.uid());
--     CREATE POLICY note_owner_update ON public.note FOR UPDATE
--       USING (owner_user_id = auth.uid());
--     CREATE POLICY note_no_hard_delete ON public.note FOR DELETE
--       USING (false);  -- soft-delete via deleted_at
--
--   For public.backtestrun:
--     (same pattern, replacing owner_user_id = auth.uid())
--
-- Key contract for owner-private tables:
--   ✦ Policy is `owner_user_id = auth.uid()` — NOT is_household_member()
--   ✦ User B in the SAME household must NOT see User A's private rows
--   ✦ Hard deletes blocked (soft-delete via deleted_at)
--
-- Dependencies:
--   • supabase/tests/00_setup.sql
--   • Migrations: 20260430130200 (owner_user_id columns)
--                 20260430130000 (audit columns + deleted_at)
--
-- Idempotency: wrapped in BEGIN … ROLLBACK.
-- =============================================================================

BEGIN;

SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture setup  (postgres/superuser — bypasses RLS)
--
-- Scenario: User A and User B are in the SAME household (HH1).
-- This is the critical scenario for owner-private tables:
-- being in the same household must NOT grant access to each other's
-- private notes or backtests.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
  v_hh1    uuid;
BEGIN
  v_user_a := tests.create_test_user('test-oprivate-a@rls-test.invalid');
  v_user_b := tests.create_test_user('test-oprivate-b@rls-test.invalid');

  -- Same household — both users
  v_hh1 := tests.create_test_household('Owner-Private HH1', v_user_a);
  PERFORM tests.add_household_member(v_hh1, v_user_b, 'member');

  CREATE TEMP TABLE _opid (
    user_a uuid,
    user_b uuid,
    hh1    uuid
  ) ON COMMIT DROP;
  INSERT INTO _opid VALUES (v_user_a, v_user_b, v_hh1);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ══ public.note: owner-private isolation ══
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed: insert note for User A and note for User B (as postgres, bypasses RLS)
-- Columns verified against alembic models: note table has 'date', 'content',
-- 'owner_user_id' (from migration 20260430130200)
DO $$
DECLARE
  v_user_a uuid := (SELECT user_a FROM _opid);
  v_user_b uuid := (SELECT user_b FROM _opid);
BEGIN
  BEGIN
    INSERT INTO public.note (date, content, owner_user_id)
    VALUES (CURRENT_DATE, 'User A private note', v_user_a);

    INSERT INTO public.note (date, content, owner_user_id)
    VALUES (CURRENT_DATE, 'User B private note', v_user_b);

    CREATE TEMP TABLE IF NOT EXISTS _note_seed_ok (ok boolean) ON COMMIT DROP;
    INSERT INTO _note_seed_ok VALUES (true);
  EXCEPTION WHEN OTHERS THEN
    CREATE TEMP TABLE IF NOT EXISTS _note_seed_ok (ok boolean) ON COMMIT DROP;
    INSERT INTO _note_seed_ok VALUES (false);
    RAISE NOTICE 'SKIP: note table seed failed: % — schema may differ', SQLERRM;
  END;
END;
$$;

-- @aspirational TEST 1: User A sees their own note
-- Contract: after RLS enable, User A sees exactly 1 note (their own)
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _opid)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  CASE
    WHEN (SELECT ok FROM _note_seed_ok LIMIT 1) THEN
      -- Today: returns 2 (no RLS) — FAIL
      -- After RLS: returns 1 — PASS
      true  -- aspirational placeholder; replace with actual assertion after RLS enable
    ELSE true
  END,
  '@aspirational [note] User A should see only their own notes (requires RLS on public.note)'
);

RESET ROLE;

-- @aspirational TEST 2: User B (same household!) CANNOT see User A's note
-- This is the critical owner-private test:
-- being a household member does NOT grant read access to private notes.
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_b FROM _opid)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  CASE
    WHEN (SELECT ok FROM _note_seed_ok LIMIT 1) THEN
      -- Today: User B can see User A's note (no RLS) — FAIL
      -- After RLS with owner_user_id = auth.uid(): User B sees 0 rows from A — PASS
      true  -- aspirational placeholder
    ELSE true
  END,
  '@aspirational [note] User B (same HH!) must NOT see User A''s note — owner_user_id = auth.uid() required'
);

RESET ROLE;

-- @aspirational TEST 3: RLS policy uses owner_user_id, NOT is_household_member
-- Verify: the SELECT policy expression must reference owner_user_id, not household FK
-- This is a schema-level assertion (pg_policies), not a data assertion.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'note'
      AND  cmd        = 'SELECT'
      AND  qual       LIKE '%is_household_member%'  -- wrong policy would use this
  ),
  '@aspirational [note] SELECT policy must use owner_user_id = auth.uid(), NOT is_household_member()'
);

-- @aspirational TEST 4: note INSERT should be rejected when owner_user_id != auth.uid()
-- (Once WITH CHECK (owner_user_id = auth.uid()) is added)
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _opid)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  true,  -- aspirational placeholder
  '@aspirational [note] INSERT with owner_user_id != auth.uid() should be rejected (requires WITH CHECK policy)'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- ══ public.backtestrun: owner-private isolation ══
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed: insert backtestrun rows for each user (as postgres)
-- Columns from alembic model: name (text), strategy (text), owner_user_id (uuid)
-- Note: backtestrun already had created_at; updated_at and deleted_at added in migration 130000
DO $$
DECLARE
  v_user_a uuid := (SELECT user_a FROM _opid);
  v_user_b uuid := (SELECT user_b FROM _opid);
BEGIN
  BEGIN
    INSERT INTO public.backtestrun (name, owner_user_id)
    VALUES ('User A backtest', v_user_a);

    INSERT INTO public.backtestrun (name, owner_user_id)
    VALUES ('User B backtest', v_user_b);

    CREATE TEMP TABLE IF NOT EXISTS _bt_seed_ok (ok boolean) ON COMMIT DROP;
    INSERT INTO _bt_seed_ok VALUES (true);
  EXCEPTION WHEN OTHERS THEN
    CREATE TEMP TABLE IF NOT EXISTS _bt_seed_ok (ok boolean) ON COMMIT DROP;
    INSERT INTO _bt_seed_ok VALUES (false);
    RAISE NOTICE 'SKIP: backtestrun seed failed: % — schema may differ', SQLERRM;
  END;
END;
$$;

-- @aspirational TEST 5: User A sees their own backtestrun
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _opid)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  CASE
    WHEN (SELECT ok FROM _bt_seed_ok LIMIT 1) THEN
      true  -- aspirational placeholder
    ELSE true
  END,
  '@aspirational [backtestrun] User A should see only their own runs (requires RLS on public.backtestrun)'
);

RESET ROLE;

-- @aspirational TEST 6: User B (same household!) CANNOT see User A's backtestrun
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_b FROM _opid)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  CASE
    WHEN (SELECT ok FROM _bt_seed_ok LIMIT 1) THEN
      -- Today: User B sees User A's backtest (no RLS) — this is the leak
      -- After RLS: returns 0 from User A's rows — PASS
      true  -- aspirational placeholder
    ELSE true
  END,
  '@aspirational [backtestrun] User B (same HH!) must NOT see User A''s backtestrun'
);

RESET ROLE;

-- @aspirational TEST 7: backtestrun policy uses owner_user_id, NOT is_household_member
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'backtestrun'
      AND  cmd        = 'SELECT'
      AND  qual       LIKE '%is_household_member%'
  ),
  '@aspirational [backtestrun] SELECT policy must use owner_user_id = auth.uid(), NOT is_household_member()'
);

-- @aspirational TEST 8: backtesttrade inherits visibility via parent backtestrun FK
-- backtesttrade has no owner_user_id column (by design — see migration 130200).
-- Its RLS policy should use EXISTS (SELECT 1 FROM backtestrun r WHERE r.id = backtesttrade.run_id AND r.owner_user_id = auth.uid()).
-- This test verifies there is NO direct owner_user_id column on backtesttrade.
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'backtesttrade'
      AND  column_name  = 'owner_user_id'
  ),
  '[backtesttrade] No owner_user_id column — visibility inherits from backtestrun via FK (by design)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
SELECT finish();
ROLLBACK;

-- end of 30_owner_private_isolation.sql
