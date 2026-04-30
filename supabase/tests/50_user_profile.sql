-- =============================================================================
-- supabase/tests/50_user_profile.sql
-- pgTAP tests: public.user_profile RLS policies + auth trigger (TJ-013 / GH #88)
--
-- Coverage:
--   • handle_new_auth_user() trigger — fires on auth.users INSERT
--   • user_profile_owner_select  — id = auth.uid()
--   • user_profile_owner_update  — id = auth.uid()
--   • user_profile_owner_delete  — id = auth.uid()
--   • ON CONFLICT DO NOTHING — trigger is idempotent
--   • SECURITY DEFINER + SET search_path = public, auth
--
-- Status: CONCRETE — all policies and trigger are live after migration
--         20260430130400_user_to_user_profile.sql (merged via PR #85).
--
-- Policy names (from migration):
--   user_profile_owner_select, user_profile_owner_insert,
--   user_profile_owner_update, user_profile_owner_delete
--
-- Trigger name: trg_auth_users_create_profile (fires handle_new_auth_user())
--
-- NOTE on 'admin' role: user_profile has no household scoping — it is purely
-- owner-private (id = auth.uid()). There is no 'admin' role concept here.
--
-- NOTE on search_path security: handle_new_auth_user() is SECURITY DEFINER
-- with SET search_path = public, auth — this prevents a malicious caller from
-- prepending a rogue schema to shadow pg functions. We verify the function
-- definition contains the expected search_path annotation.
--
-- Dependencies:
--   • supabase/tests/00_setup.sql must be loaded first
--   • Migrations: 20260430120000, 20260430130400
--
-- Idempotency: wrapped in BEGIN … ROLLBACK.
-- =============================================================================

BEGIN;

SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture setup  (postgres/superuser — bypasses RLS)
--
-- Scenario: two independent users (User A and User B).
-- User A is the subject; User B is the cross-profile attacker.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
BEGIN
  -- create_test_user fires the auth.users INSERT trigger automatically,
  -- so user_profile rows should be auto-provisioned here.
  v_user_a := tests.create_test_user('test-profile-a@rls-test.invalid');
  v_user_b := tests.create_test_user('test-profile-b@rls-test.invalid');

  CREATE TEMP TABLE _profile_ids (
    user_a uuid,
    user_b uuid
  ) ON COMMIT DROP;

  INSERT INTO _profile_ids VALUES (v_user_a, v_user_b);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: Trigger fires — inserting into auth.users creates a user_profile row
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = (SELECT user_a FROM _profile_ids)
  ),
  'Trigger (trg_auth_users_create_profile): auth.users INSERT creates user_profile row for User A'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: Trigger fires for User B as well (both users have profiles)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = (SELECT user_b FROM _profile_ids)
  ),
  'Trigger (trg_auth_users_create_profile): auth.users INSERT creates user_profile row for User B'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: Trigger is idempotent — inserting same user_id twice via ON CONFLICT DO NOTHING
-- Direct insert of a profile row that already exists must not error.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_a uuid := (SELECT user_a FROM _profile_ids);
  v_count  int;
BEGIN
  -- Re-insert using the same conflict-safe logic the trigger uses
  INSERT INTO public.user_profile (id) VALUES (v_user_a) ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO v_count
  FROM public.user_profile
  WHERE id = v_user_a;

  CREATE TEMP TABLE _idempotent_ok (cnt int) ON COMMIT DROP;
  INSERT INTO _idempotent_ok VALUES (v_count);
EXCEPTION WHEN OTHERS THEN
  CREATE TEMP TABLE _idempotent_ok (cnt int) ON COMMIT DROP;
  INSERT INTO _idempotent_ok VALUES (-1);  -- signals error
END;
$$;

SELECT ok(
  (SELECT cnt FROM _idempotent_ok) = 1,
  'Trigger idempotency: ON CONFLICT DO NOTHING — re-inserting same user_id leaves exactly 1 profile row'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: SECURITY DEFINER trigger has search_path = public, auth
-- Verify that the function definition mentions SET search_path to prevent
-- search-path injection (see migration security note).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname    = 'public'
      AND  p.proname    = 'handle_new_auth_user'
      AND  p.prosecdef  = true           -- SECURITY DEFINER
      AND  p.proconfig IS NOT NULL
      AND  p.proconfig::text ILIKE '%search_path%public%auth%'
  ),
  'handle_new_auth_user(): is SECURITY DEFINER and has SET search_path = public, auth'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: User A can SELECT their own profile (RLS: id = auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = (SELECT user_a FROM _profile_ids)
  ),
  'user_profile_owner_select: User A can SELECT their own profile'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: User A CANNOT SELECT User B's profile (cross-profile isolation)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = (SELECT user_b FROM _profile_ids)
  ),
  'user_profile_owner_select: User A CANNOT SELECT User B''s profile'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: User A can UPDATE their own profile
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.user_profile
  SET    display_name = 'User A Display Name'
  WHERE  id = (SELECT user_a FROM _profile_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _upd_own (rows int) ON COMMIT DROP;
  INSERT INTO _upd_own VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _upd_own) = 1,
  'user_profile_owner_update: User A can UPDATE their own profile (1 row affected)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: User A CANNOT UPDATE User B's profile
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.user_profile
  SET    display_name = 'Hacked by A'
  WHERE  id = (SELECT user_b FROM _profile_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _upd_other (rows int) ON COMMIT DROP;
  INSERT INTO _upd_other VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _upd_other) = 0,
  'user_profile_owner_update: User A CANNOT UPDATE User B''s profile (0 rows affected)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 9: User A can DELETE their own profile
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.user_profile
  WHERE id = (SELECT user_a FROM _profile_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _del_own (rows int) ON COMMIT DROP;
  INSERT INTO _del_own VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _del_own) = 1,
  'user_profile_owner_delete: User A can DELETE their own profile (1 row affected)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 10: User A CANNOT DELETE User B's profile
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT user_a FROM _profile_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.user_profile
  WHERE id = (SELECT user_b FROM _profile_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _del_other (rows int) ON COMMIT DROP;
  INSERT INTO _del_other VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _del_other) = 0,
  'user_profile_owner_delete: User A CANNOT DELETE User B''s profile (0 rows affected)'
);

-- ─────────────────────────────────────────────────────────────────────────────

SELECT finish();
ROLLBACK;
