-- =============================================================================
-- supabase/tests/10_household_membership.sql
-- pgTAP tests: households + household_members RLS policies (TJ-013 / GH #66)
--
-- Coverage:
--   • households    — SELECT (member), INSERT (authed), UPDATE (owner-only),
--                     DELETE (blocked via USING false)
--   • household_members — SELECT (member), INSERT (owner-only),
--                         UPDATE (owner-only), DELETE (blocked)
--   • Auto-owner trigger (trg_households_add_creator)
--
-- Status: CONCRETE — all policies are live in PR #85.
--         These tests should PASS after applying PR #85 migrations.
--
-- Note: household_invitations table does NOT exist in the PR #85 migrations.
--       Tests for invitation flows are skipped; see README for details.
--
-- Dependencies:
--   • supabase/tests/00_setup.sql must be loaded first
--   • Migrations: 20260430120000, 20260430120100, 20260430120200
--
-- Idempotency: entire test body is wrapped in BEGIN … ROLLBACK so no data
--              persists after the run.
-- =============================================================================

BEGIN;

SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture setup  (runs as postgres/superuser — bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- Three users: owner, plain member, and an outsider
DO $$
DECLARE
  v_owner_id   uuid;
  v_member_id  uuid;
  v_viewer_id  uuid;
  v_outsider_id uuid;
  v_hh1_id     uuid;
  v_hh2_id     uuid;
BEGIN
  -- Create users
  v_owner_id    := tests.create_test_user('test-owner@rls-test.invalid');
  v_member_id   := tests.create_test_user('test-member@rls-test.invalid');
  v_viewer_id   := tests.create_test_user('test-viewer@rls-test.invalid');
  v_outsider_id := tests.create_test_user('test-outsider@rls-test.invalid');

  -- Create two households (trigger auto-inserts owner as 'owner' member)
  v_hh1_id := tests.create_test_household('Test HH1', v_owner_id);
  v_hh2_id := tests.create_test_household('Test HH2 (outsider owns)', v_outsider_id);

  -- Add member and viewer to HH1
  PERFORM tests.add_household_member(v_hh1_id, v_member_id, 'member');
  PERFORM tests.add_household_member(v_hh1_id, v_viewer_id, 'viewer');

  -- Stash IDs for test body via temp table
  CREATE TEMP TABLE _test_hm_ids (
    owner_id    uuid,
    member_id   uuid,
    viewer_id   uuid,
    outsider_id uuid,
    hh1_id      uuid,
    hh2_id      uuid
  ) ON COMMIT DROP;

  INSERT INTO _test_hm_ids
  VALUES (v_owner_id, v_member_id, v_viewer_id, v_outsider_id, v_hh1_id, v_hh2_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: Auto-owner trigger — creator is added as 'owner' in household_members
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1
    FROM   public.household_members hm
    JOIN   _test_hm_ids t ON hm.household_id = t.hh1_id AND hm.user_id = t.owner_id
    WHERE  hm.role = 'owner'
      AND  hm.left_at IS NULL
  ),
  'Auto-owner trigger: creator is inserted into household_members as owner'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: Owner can SELECT their household (authenticated + jwt claim)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_owner_id uuid := (SELECT owner_id FROM _test_hm_ids);
  v_hh1_id   uuid := (SELECT hh1_id   FROM _test_hm_ids);
BEGIN
  PERFORM tests.set_session_user(v_owner_id);
END;
$$;
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Owner (role=authenticated, jwt=owner) can SELECT their household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: Member (role='member') can SELECT the household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Member (role=member) can SELECT the household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: Viewer (role='viewer') can SELECT the household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT viewer_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Viewer (role=viewer) can SELECT the household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: Non-member (outsider) CANNOT SELECT HH1
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT outsider_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Non-member (outsider) cannot SELECT HH1 — RLS filters the row'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: Non-member can SELECT their OWN household (HH2) but not HH1
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT outsider_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh2_id FROM _test_hm_ids)
  ),
  'Outsider (owner of HH2) can SELECT their own household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: Owner can UPDATE (rename) the household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

UPDATE public.households
SET    name = 'Test HH1 Renamed'
WHERE  id = (SELECT hh1_id FROM _test_hm_ids);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households
    WHERE id = (SELECT hh1_id FROM _test_hm_ids)
      AND name = 'Test HH1 Renamed'
  ),
  'Owner can UPDATE (rename) their household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: Non-owner member CANNOT UPDATE the household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

UPDATE public.households
SET    name = 'Hacked Name'
WHERE  id = (SELECT hh1_id FROM _test_hm_ids);

RESET ROLE;

-- Verify name was NOT changed (update was silently blocked by RLS USING)
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.households
    WHERE id   = (SELECT hh1_id FROM _test_hm_ids)
      AND name = 'Hacked Name'
  ),
  'Non-owner member cannot UPDATE household — USING(is_household_owner) blocks it'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 9: Hard DELETE is blocked for ALL users (USING false policy)
-- Rabin deviation #1: policy uses `using (false)` not owner-only delete.
-- Behaviour: DELETE returns 0 rows; no error raised; row still exists.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

DELETE FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Hard DELETE on households is blocked for all users (USING false — Rabin deviation #1)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 10: Owner can soft-delete (set deleted_at) via UPDATE policy
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

UPDATE public.households
SET    deleted_at = now()
WHERE  id = (SELECT hh1_id FROM _test_hm_ids);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.households
    WHERE id         = (SELECT hh1_id FROM _test_hm_ids)
      AND deleted_at IS NOT NULL
  ),
  'Owner can soft-delete household by setting deleted_at via UPDATE policy'
);

-- Reset deleted_at for subsequent tests
UPDATE public.households SET deleted_at = NULL WHERE id = (SELECT hh1_id FROM _test_hm_ids);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 11: Member can SELECT the household_members list for their household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  (SELECT count(*)::int
   FROM   public.household_members
   WHERE  household_id = (SELECT hh1_id FROM _test_hm_ids)) >= 2,
  'Member can SELECT household_members for their own household (sees at least owner + self)'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 12: Non-member CANNOT SELECT household_members of HH1
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT outsider_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int
   FROM   public.household_members
   WHERE  household_id = (SELECT hh1_id FROM _test_hm_ids)),
  0,
  'Non-member cannot SELECT household_members of HH1 — returns empty set'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 13: Owner can INSERT a new member into household_members
-- (Policy: household_members_owner_insert WITH CHECK (is_household_owner()))
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_new_user_id uuid;
BEGIN
  -- Create a new user to add (SECURITY DEFINER, ok from authenticated block)
  v_new_user_id := tests.create_test_user('test-newmember@rls-test.invalid');
  -- Store for assertion
  CREATE TEMP TABLE IF NOT EXISTS _test_new_member (uid uuid) ON COMMIT DROP;
  TRUNCATE _test_new_member;
  INSERT INTO _test_new_member VALUES (v_new_user_id);

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (
    (SELECT hh1_id FROM _test_hm_ids),
    v_new_user_id,
    'viewer'
  );
END;
$$;

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.household_members hm
    JOIN _test_new_member nm ON hm.user_id = nm.uid
    WHERE hm.household_id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Owner can INSERT new member into household_members'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 14: Non-owner member CANNOT INSERT into household_members
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (
      (SELECT hh1_id FROM _test_hm_ids),
      gen_random_uuid(),
      'viewer'
    )
  $$,
  '42501',   -- insufficient_privilege / RLS WITH CHECK violation
  NULL,
  'Non-owner member cannot INSERT into household_members — WITH CHECK(is_household_owner) blocks'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 15: Hard DELETE on household_members is blocked (USING false)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

DELETE FROM public.household_members
WHERE  household_id = (SELECT hh1_id FROM _test_hm_ids)
  AND  user_id      = (SELECT viewer_id FROM _test_hm_ids);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.household_members
    WHERE  household_id = (SELECT hh1_id  FROM _test_hm_ids)
      AND  user_id      = (SELECT viewer_id FROM _test_hm_ids)
  ),
  'Hard DELETE on household_members blocked for all — use left_at for soft-remove'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 16: Owner can soft-remove a member by setting left_at
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

UPDATE public.household_members
SET    left_at = now()
WHERE  household_id = (SELECT hh1_id   FROM _test_hm_ids)
  AND  user_id      = (SELECT viewer_id FROM _test_hm_ids);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.household_members
    WHERE  household_id = (SELECT hh1_id   FROM _test_hm_ids)
      AND  user_id      = (SELECT viewer_id FROM _test_hm_ids)
      AND  left_at      IS NOT NULL
  ),
  'Owner can soft-remove member by setting left_at via UPDATE policy'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 17: Soft-removed member (left_at IS NOT NULL) can no longer see household
-- (is_household_member() filters on left_at IS NULL)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT viewer_id FROM _test_hm_ids)); END; $$;
SET LOCAL ROLE authenticated;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.households WHERE id = (SELECT hh1_id FROM _test_hm_ids)
  ),
  'Soft-removed member (left_at set) loses SELECT access to household'
);

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup and finish
-- ─────────────────────────────────────────────────────────────────────────────
SELECT finish();
ROLLBACK;

-- end of 10_household_membership.sql
