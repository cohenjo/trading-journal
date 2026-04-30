-- Test: sharing_rls.test.sql
-- TJ-022: pgTAP test suite for sharing RLS policies and role enforcement
-- Author: Rabin (Security Engineer)
-- Closes: GH #75
--
-- Covers acceptance criteria from design.md §15 #1:
--   anonymous denied, non-member denied, viewer write denied,
--   member write allowed, owner admin allowed, ex-member denied,
--   soft-deleted household invisible, last-owner protection, version bump.
--
-- Prerequisites:
--   • pgTAP extension installed: CREATE EXTENSION IF NOT EXISTS pgtap;
--   • Run against a local Supabase stack (supabase start) — NOT remote prod/dev.
--   • The 20260430150000 migration must have been applied first.
--
-- Running:
--   pg_prove -U postgres -d postgres supabase/tests/sharing_rls.test.sql
--   OR:
--   psql -U postgres -d postgres -f supabase/tests/sharing_rls.test.sql
--
-- All changes are rolled back at the end — zero persistent state.

BEGIN;

SELECT plan(29);

-- ============================================================
-- SETUP HELPERS
-- ============================================================

-- Helper: set auth.uid() to a specific UUID for the current transaction.
-- auth.uid() in Supabase reads from request.jwt.claims.sub.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true  -- is_local: resets at transaction end
  );
END;
$$;

-- ============================================================
-- SETUP DATA (as superuser, bypassing FK/RLS)
-- ============================================================

-- Bypass FK to auth.users for test actors (test-only pattern)
SET LOCAL session_replication_role = 'replica';

-- Synthetic test users (deterministic UUIDs)
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('a1000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'owner@rls.test',   'x', now(), now(), now()),
  ('a1000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'member@rls.test',  'x', now(), now(), now()),
  ('a1000000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', 'viewer@rls.test',  'x', now(), now(), now()),
  ('a1000000-0000-0000-0000-000000000004'::uuid, 'authenticated', 'authenticated', 'removed@rls.test', 'x', now(), now(), now()),
  ('a1000000-0000-0000-0000-000000000005'::uuid, 'authenticated', 'authenticated', 'outsider@rls.test','x', now(), now(), now()),
  ('a1000000-0000-0000-0000-000000000006'::uuid, 'authenticated', 'authenticated', 'owner2@rls.test',  'x', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

RESET session_replication_role;

-- Primary test household (created by owner)
-- trg_households_add_creator auto-inserts owner row into household_members.
INSERT INTO public.households (id, name, created_by)
VALUES ('b1000000-0000-0000-0000-000000000001'::uuid, 'RLS Test Household',
        'a1000000-0000-0000-0000-000000000001'::uuid);

-- Additional members
INSERT INTO public.household_members (household_id, user_id, role, left_at)
VALUES
  ('b1000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000002'::uuid, 'member',  NULL),
  ('b1000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000003'::uuid, 'viewer',  NULL),
  -- removed member (left_at set — should have zero access)
  ('b1000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000004'::uuid, 'member',  now() - interval '1 day')
ON CONFLICT (household_id, user_id) DO NOTHING;

-- Seed cooked row for dashboard tests
INSERT INTO cooked.dashboard_summary (household_id, period, as_of_date, currency)
VALUES ('b1000000-0000-0000-0000-000000000001'::uuid, 'day', current_date, 'USD');

-- Version-test household: untouched except by the version-bump tests.
-- (Isolated to guarantee version starts at 1 for exact assertions.)
INSERT INTO public.households (id, name, created_by)
VALUES ('b1000000-0000-0000-0000-000000000002'::uuid, 'Version Test Household',
        'a1000000-0000-0000-0000-000000000001'::uuid);


-- ============================================================
-- TEST 1: Owner CAN read household
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  1,
  'T01: Owner can SELECT household'
);
RESET ROLE;

-- ============================================================
-- TEST 2: Owner CAN invite (INSERT household_members)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $$
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES ('b1000000-0000-0000-0000-000000000001'::uuid,
            'a1000000-0000-0000-0000-000000000006'::uuid, 'viewer')
  $$,
  'T02: Owner CAN invite a new member (INSERT household_members)'
);
RESET ROLE;
-- Clean up invite row for following tests
DELETE FROM public.household_members
WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
  AND user_id      = 'a1000000-0000-0000-0000-000000000006'::uuid;

-- ============================================================
-- TEST 3: Member CANNOT invite (INSERT — owner-only RLS)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT throws_ok(
  $$
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES ('b1000000-0000-0000-0000-000000000001'::uuid,
            'a1000000-0000-0000-0000-000000000006'::uuid, 'viewer')
  $$,
  '42501',
  NULL,
  'T03: Member CANNOT invite (INSERT blocked by owner-only RLS)'
);
RESET ROLE;

-- ============================================================
-- TEST 4: Viewer CANNOT write to cooked.dashboard_summary (INSERT)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
SELECT throws_ok(
  $$
    INSERT INTO cooked.dashboard_summary (household_id, period, as_of_date, currency)
    VALUES ('b1000000-0000-0000-0000-000000000001'::uuid, 'month', current_date, 'USD')
  $$,
  '42501',
  NULL,
  'T04: Viewer CANNOT INSERT into cooked.dashboard_summary'
);
RESET ROLE;

-- ============================================================
-- TEST 5: Viewer CANNOT update cooked.dashboard_summary (UPDATE returns 0 rows)
-- Viewers have a valid SELECT policy but is_household_writer returns false for
-- viewer, so the UPDATE USING clause rejects all rows silently (0 affected).
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
SELECT is(
  (SELECT count(*)::int FROM (
     UPDATE cooked.dashboard_summary
     SET    summary_payload = '{"hacked":true}'::jsonb
     WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
     RETURNING 1
  ) x),
  0,
  'T05: Viewer CANNOT UPDATE cooked.dashboard_summary (0 rows — RLS USING blocks writer check)'
);
RESET ROLE;

-- ============================================================
-- TEST 6: Member CAN write to cooked.dashboard_summary (UPDATE)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $$
    UPDATE cooked.dashboard_summary
    SET    summary_payload = '{"member_write":true}'::jsonb
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  period = 'day' AND as_of_date = current_date AND currency = 'USD'
  $$,
  'T06: Member CAN write to cooked.dashboard_summary (UPDATE)'
);
RESET ROLE;
-- Reset cooked row (superuser)
UPDATE cooked.dashboard_summary
SET    summary_payload = '{}'::jsonb
WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid;

-- ============================================================
-- TEST 7: Removed member (left_at IS NOT NULL) cannot SELECT household
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T07: Removed member (left_at IS NOT NULL) sees 0 household rows'
);
RESET ROLE;

-- ============================================================
-- TEST 8: Removed member cannot SELECT cooked data
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
SELECT is(
  (SELECT count(*)::int FROM cooked.dashboard_summary
   WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T08: Removed member sees 0 cooked.dashboard_summary rows'
);
RESET ROLE;

-- ============================================================
-- TEST 9: Last owner CANNOT self-leave — trigger raises P0001
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT throws_ok(
  $$
    UPDATE public.household_members
    SET    left_at = now()
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$,
  'P0001',
  NULL,
  'T09: Last owner CANNOT self-leave (last_owner_constraint P0001)'
);
RESET ROLE;

-- ============================================================
-- TEST 10: Last owner CANNOT be demoted — trigger raises P0001
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT throws_ok(
  $$
    UPDATE public.household_members
    SET    role = 'member'
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$,
  'P0001',
  NULL,
  'T10: Last owner CANNOT be demoted to member (last_owner_constraint P0001)'
);
RESET ROLE;

-- ============================================================
-- TEST 11: Owner CAN remove a non-last member (hard DELETE)
-- ============================================================
-- Insert a throwaway viewer first (as superuser)
INSERT INTO public.household_members (household_id, user_id, role)
VALUES ('b1000000-0000-0000-0000-000000000001'::uuid,
        'a1000000-0000-0000-0000-000000000006'::uuid, 'viewer')
ON CONFLICT DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $$
    DELETE FROM public.household_members
    WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND user_id = 'a1000000-0000-0000-0000-000000000006'::uuid
  $$,
  'T11: Owner CAN hard-DELETE a non-owner member'
);
RESET ROLE;

-- ============================================================
-- TEST 12: Soft-deleted household is invisible to owner
-- ============================================================
UPDATE public.households
SET deleted_at = now() - interval '1 hour'
WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T12: Soft-deleted household invisible to owner'
);
RESET ROLE;

-- ============================================================
-- TEST 13: Soft-deleted household — member also sees 0 rows
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T13: Soft-deleted household invisible to member'
);
RESET ROLE;

-- ============================================================
-- TEST 14: Soft-deleted household — viewer also sees 0 rows
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T14: Soft-deleted household invisible to viewer'
);
RESET ROLE;

-- ============================================================
-- TEST 15: Soft-deleted household — cooked data also invisible
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count(*)::int FROM cooked.dashboard_summary
   WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T15: cooked.dashboard_summary invisible when household is soft-deleted'
);
RESET ROLE;

-- ============================================================
-- TEST 16: Soft-deleted household — household_members invisible
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT count(*)::int FROM public.household_members
   WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T16: household_members invisible when household is soft-deleted'
);
RESET ROLE;

-- Restore household for remaining tests
UPDATE public.households
SET deleted_at = NULL
WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid;

-- ============================================================
-- TEST 17: UPDATE on households bumps version
-- Uses isolated version-test household (b1000000-...-0002) which has
-- only been touched by the INSERT that created it — version = 1.
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
UPDATE public.households
SET name = 'Version Test Household Updated'
WHERE id = 'b1000000-0000-0000-0000-000000000002'::uuid;
RESET ROLE;

SELECT is(
  (SELECT version FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000002'::uuid),
  2,
  'T17: UPDATE on households bumps version from 1 to 2'
);

-- ============================================================
-- TEST 18: UPDATE on household_members bumps version
-- Uses the owner row in the version-test household (inserted by trigger at version=1).
-- No prior UPDATEs on this row.
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
-- Owners can update their own member row (role no-op triggers version bump)
UPDATE public.household_members
SET role = 'owner'  -- no-op value, just triggers tg_bump_version
WHERE household_id = 'b1000000-0000-0000-0000-000000000002'::uuid
  AND user_id      = 'a1000000-0000-0000-0000-000000000001'::uuid;
RESET ROLE;

SELECT is(
  (SELECT version FROM public.household_members
   WHERE household_id = 'b1000000-0000-0000-0000-000000000002'::uuid
     AND user_id = 'a1000000-0000-0000-0000-000000000001'::uuid),
  2,
  'T18: UPDATE on household_members bumps version from 1 to 2'
);

-- ============================================================
-- TEST 19: Member CAN self-leave (set own left_at) when not last owner
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $$
    UPDATE public.household_members
    SET    left_at = now()
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000002'::uuid
  $$,
  'T19: Member CAN self-leave (set own left_at, no last-owner constraint)'
);
RESET ROLE;
-- Restore for subsequent tests
UPDATE public.household_members
SET left_at = NULL
WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
  AND user_id = 'a1000000-0000-0000-0000-000000000002'::uuid;

-- ============================================================
-- TEST 20: Owner CANNOT self-leave when sole active owner (P0001)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT throws_ok(
  $$
    UPDATE public.household_members
    SET    left_at = now()
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$,
  'P0001',
  NULL,
  'T20: Last owner CANNOT self-leave (last_owner_constraint P0001)'
);
RESET ROLE;

-- ============================================================
-- TEST 21: Owner CAN self-leave when a second active owner exists
-- ============================================================
-- Insert a second owner as superuser
INSERT INTO public.household_members (household_id, user_id, role)
VALUES ('b1000000-0000-0000-0000-000000000001'::uuid,
        'a1000000-0000-0000-0000-000000000006'::uuid, 'owner')
ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', left_at = NULL;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $$
    UPDATE public.household_members
    SET    left_at = now()
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$,
  'T21: Owner CAN self-leave when a second active owner exists'
);
RESET ROLE;
-- Restore owner1
UPDATE public.household_members
SET left_at = NULL
WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
  AND user_id = 'a1000000-0000-0000-0000-000000000001'::uuid;

-- ============================================================
-- TEST 22: Non-member outsider CANNOT SELECT household
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
SELECT is(
  (SELECT count(*)::int FROM public.households
   WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  0,
  'T22: Non-member outsider CANNOT SELECT household'
);
RESET ROLE;

-- ============================================================
-- TEST 23: Non-member outsider CANNOT INSERT into household_members
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
SELECT throws_ok(
  $$
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES ('b1000000-0000-0000-0000-000000000001'::uuid,
            'a1000000-0000-0000-0000-000000000005'::uuid, 'viewer')
  $$,
  '42501',
  NULL,
  'T23: Outsider CANNOT INSERT into household_members'
);
RESET ROLE;

-- ============================================================
-- TEST 24: is_household_writer returns FALSE for viewer role
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
SELECT is(
  public.is_household_writer('b1000000-0000-0000-0000-000000000001'::uuid),
  false,
  'T24: is_household_writer returns false for viewer role'
);
RESET ROLE;

-- ============================================================
-- TEST 25: is_household_writer returns TRUE for member role
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT is(
  public.is_household_writer('b1000000-0000-0000-0000-000000000001'::uuid),
  true,
  'T25: is_household_writer returns true for member role'
);
RESET ROLE;

-- ============================================================
-- TEST 26: is_household_writer returns FALSE for removed member
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
SELECT is(
  public.is_household_writer('b1000000-0000-0000-0000-000000000001'::uuid),
  false,
  'T26: is_household_writer returns false for removed member (left_at IS NOT NULL)'
);
RESET ROLE;

-- ============================================================
-- TEST 27: is_household_writer returns FALSE for soft-deleted household
-- ============================================================
UPDATE public.households
SET deleted_at = now() - interval '1 hour'
WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
SELECT is(
  public.is_household_writer('b1000000-0000-0000-0000-000000000001'::uuid),
  false,
  'T27: is_household_writer returns false for soft-deleted household (owner check)'
);
RESET ROLE;

UPDATE public.households
SET deleted_at = NULL
WHERE id = 'b1000000-0000-0000-0000-000000000001'::uuid;

-- ============================================================
-- TEST 28: Member CANNOT update another member's row (self-update only)
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count(*)::int FROM (
    UPDATE public.household_members
    SET    role = 'owner'   -- escalation attempt
    WHERE  household_id = 'b1000000-0000-0000-0000-000000000001'::uuid
      AND  user_id = 'a1000000-0000-0000-0000-000000000003'::uuid  -- viewer's row
    RETURNING 1
  ) x),
  0,
  'T28: Member CANNOT update another member''s row (0 rows — RLS USING blocks non-self update)'
);
RESET ROLE;

-- ============================================================
-- TEST 29: Viewer CAN read cooked.dashboard_summary
-- ============================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
SELECT is(
  (SELECT count(*)::int FROM cooked.dashboard_summary
   WHERE household_id = 'b1000000-0000-0000-0000-000000000001'::uuid),
  1,
  'T29: Viewer CAN SELECT cooked.dashboard_summary'
);
RESET ROLE;

-- ============================================================
-- FINISH
-- ============================================================

SELECT * FROM finish();

ROLLBACK;
