-- =============================================================================
-- supabase/tests/60_hard_delete_policies.sql
-- pgTAP tests: relaxed DELETE policies on households + household_members (TJ-013 / GH #88)
--
-- Coverage:
--   • households_owner_delete policy  (migration 20260430130500)
--   • household_members_owner_delete  (migration 20260430130500)
--
-- Status: CONCRETE — USING (false) DELETE policies replaced by owner-only hard-delete
--         via migration 20260430130500_relax_delete_policies.sql (merged via PR #85).
--
-- Policy names (from migration):
--   households_owner_delete      — on public.households,        USING is_household_owner(id)
--   household_members_owner_delete — on public.household_members, USING is_household_owner(household_id)
--
-- IMPORTANT NOTE on 'admin' role:
--   Migration 20260430130500 explicitly documents: "there is no 'admin' value" in the
--   household_role enum. The enum is ('owner','member','viewer'). The task description
--   mentions "household admin" — this is a misnomer; McManus's policy uses
--   is_household_owner() which checks role='owner' only. Tests reflect the actual
--   migration, not the user-facing terminology.
--
-- Scenarios tested:
--   households table:
--     1. Household owner CAN hard-delete the household
--     2. Household member (role='member') CANNOT hard-delete
--     3. Non-member/outsider CANNOT hard-delete
--   household_members table:
--     4. Household owner CAN hard-delete a member row
--     5. Household member (role='member') CANNOT hard-delete a member row
--     6. Non-member CANNOT hard-delete a member row
--   CASCADE behavior:
--     7. Deleting a household cascades to household_members
--
-- Dependencies:
--   • supabase/tests/00_setup.sql must be loaded first
--   • Migrations: 20260430120000, 20260430120100, 20260430120200, 20260430130500
--
-- Idempotency: wrapped in BEGIN … ROLLBACK.
-- =============================================================================

BEGIN;

SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture setup  (postgres/superuser — bypasses RLS)
--
-- Scenario: 3 households; roles: owner, member, outsider.
-- We create separate households per delete test so each DELETE attempt
-- targets a fresh row and doesn't interfere with other tests.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner_id    uuid;
  v_member_id   uuid;
  v_outsider_id uuid;
  -- Separate households to isolate each test case
  v_hh_owner    uuid;  -- owner will attempt to delete
  v_hh_member   uuid;  -- member will attempt to delete (should fail)
  v_hh_outsider uuid;  -- outsider will attempt to delete (should fail)
  -- Separate households for household_members delete tests
  v_hh_mem_del_owner    uuid;
  v_hh_mem_del_member   uuid;
  v_hh_mem_del_outsider uuid;
  -- A household for CASCADE test
  v_hh_cascade  uuid;
BEGIN
  v_owner_id    := tests.create_test_user('test-hd-owner@rls-test.invalid');
  v_member_id   := tests.create_test_user('test-hd-member@rls-test.invalid');
  v_outsider_id := tests.create_test_user('test-hd-outsider@rls-test.invalid');

  -- Households for household DELETE tests (each has owner as creator → auto owner member)
  v_hh_owner    := tests.create_test_household('HD Del Owner HH',    v_owner_id);
  v_hh_member   := tests.create_test_household('HD Del Member HH',   v_owner_id);
  v_hh_outsider := tests.create_test_household('HD Del Outsider HH', v_owner_id);

  -- Add member to the "member attempts delete" and "outsider" households
  PERFORM tests.add_household_member(v_hh_member,   v_member_id,   'member');
  PERFORM tests.add_household_member(v_hh_outsider, v_member_id,   'member');

  -- Households for household_members DELETE tests
  v_hh_mem_del_owner    := tests.create_test_household('HM Del Owner HH',    v_owner_id);
  v_hh_mem_del_member   := tests.create_test_household('HM Del Member HH',   v_owner_id);
  v_hh_mem_del_outsider := tests.create_test_household('HM Del Outsider HH', v_owner_id);

  -- Seed victim member rows in each household_members test household
  PERFORM tests.add_household_member(v_hh_mem_del_owner,    v_member_id,   'member');
  PERFORM tests.add_household_member(v_hh_mem_del_member,   v_member_id,   'member');
  PERFORM tests.add_household_member(v_hh_mem_del_outsider, v_member_id,   'member');

  -- Household for CASCADE test (has a member row that should disappear on delete)
  v_hh_cascade := tests.create_test_household('HD Cascade HH', v_owner_id);
  PERFORM tests.add_household_member(v_hh_cascade, v_member_id, 'member');

  CREATE TEMP TABLE _hd_ids (
    owner_id    uuid,
    member_id   uuid,
    outsider_id uuid,
    hh_owner    uuid,
    hh_member   uuid,
    hh_outsider uuid,
    hh_mem_del_owner    uuid,
    hh_mem_del_member   uuid,
    hh_mem_del_outsider uuid,
    hh_cascade  uuid
  ) ON COMMIT DROP;

  INSERT INTO _hd_ids VALUES (
    v_owner_id, v_member_id, v_outsider_id,
    v_hh_owner, v_hh_member, v_hh_outsider,
    v_hh_mem_del_owner, v_hh_mem_del_member, v_hh_mem_del_outsider,
    v_hh_cascade
  );
END;
$$;

-- =============================================================================
-- households table — DELETE policy: households_owner_delete
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: Household owner CAN hard-delete the household
-- (was previously blocked by USING (false); now permitted for owner)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.households WHERE id = (SELECT hh_owner FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hh_del_owner (rows int) ON COMMIT DROP;
  INSERT INTO _hh_del_owner VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hh_del_owner) = 1,
  'households_owner_delete: household owner can hard-delete the household (1 row deleted)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: Household member (role='member') CANNOT hard-delete the household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.households WHERE id = (SELECT hh_member FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hh_del_member (rows int) ON COMMIT DROP;
  INSERT INTO _hh_del_member VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hh_del_member) = 0,
  'households_owner_delete: member (role=member) CANNOT hard-delete the household (0 rows deleted)'
);

-- Confirm the household still exists after member's failed attempt
SELECT ok(
  EXISTS (SELECT 1 FROM public.households WHERE id = (SELECT hh_member FROM _hd_ids)),
  'households_owner_delete: household row still exists after member delete attempt'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: Non-member/outsider CANNOT hard-delete a household
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT outsider_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.households WHERE id = (SELECT hh_outsider FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hh_del_outsider (rows int) ON COMMIT DROP;
  INSERT INTO _hh_del_outsider VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hh_del_outsider) = 0,
  'households_owner_delete: outsider (no membership) CANNOT hard-delete the household (0 rows deleted)'
);

-- =============================================================================
-- household_members table — DELETE policy: household_members_owner_delete
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: Household owner CAN hard-delete a member row from household_members
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.household_members
  WHERE household_id = (SELECT hh_mem_del_owner FROM _hd_ids)
    AND user_id      = (SELECT member_id         FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hm_del_owner (rows int) ON COMMIT DROP;
  INSERT INTO _hm_del_owner VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hm_del_owner) = 1,
  'household_members_owner_delete: owner can hard-delete a member row (1 row deleted)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: Member (role='member') CANNOT hard-delete a member row
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT member_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.household_members
  WHERE household_id = (SELECT hh_mem_del_member FROM _hd_ids)
    AND user_id      = (SELECT member_id         FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hm_del_member (rows int) ON COMMIT DROP;
  INSERT INTO _hm_del_member VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hm_del_member) = 0,
  'household_members_owner_delete: member CANNOT hard-delete their own member row (0 rows deleted)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: Non-member/outsider CANNOT hard-delete a member row
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT outsider_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows int;
BEGIN
  DELETE FROM public.household_members
  WHERE household_id = (SELECT hh_mem_del_outsider FROM _hd_ids)
    AND user_id      = (SELECT member_id           FROM _hd_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  CREATE TEMP TABLE _hm_del_outsider (rows int) ON COMMIT DROP;
  INSERT INTO _hm_del_outsider VALUES (v_rows);
END;
$$;

RESET ROLE;

SELECT ok(
  (SELECT rows FROM _hm_del_outsider) = 0,
  'household_members_owner_delete: outsider CANNOT hard-delete a member row (0 rows deleted)'
);

-- =============================================================================
-- CASCADE behavior: deleting a household removes its member rows
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: Member row count before cascade delete (should be 2: owner + member)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT COUNT(*)::int FROM public.household_members
   WHERE household_id = (SELECT hh_cascade FROM _hd_ids)) = 2,
  'CASCADE pre-condition: household has 2 member rows before owner deletes it'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: Owner deletes household; CASCADE removes all household_members rows
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM tests.set_session_user((SELECT owner_id FROM _hd_ids)); END; $$;
SET LOCAL ROLE authenticated;

DELETE FROM public.households WHERE id = (SELECT hh_cascade FROM _hd_ids);

RESET ROLE;

SELECT ok(
  (SELECT COUNT(*)::int FROM public.household_members
   WHERE household_id = (SELECT hh_cascade FROM _hd_ids)) = 0,
  'CASCADE: deleting household removes all household_members rows (ON DELETE CASCADE)'
);

-- ─────────────────────────────────────────────────────────────────────────────

SELECT finish();
ROLLBACK;
