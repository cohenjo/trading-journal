-- =============================================================================
-- supabase/tests/00_setup.sql
-- Test helper functions for RLS reconciliation tests (TJ-013 / GH #66)
--
-- Purpose: Provide idempotent, reusable helpers for creating test fixtures and
--          simulating Supabase auth context without real JWT issuance.
--
-- Run order: This file must be sourced FIRST (psql -f 00_setup.sql) before any
--            other test file.  All helpers live in the `tests` schema so they
--            cannot collide with application code.
--
-- Idempotency: CREATE OR REPLACE + DROP SCHEMA … CASCADE on teardown are safe
--              to re-run.  Call tests.teardown() at the end of a CI run.
--
-- Dependencies:
--   • auth.users        — Supabase-managed; requires local Supabase stack
--   • public.households — migration 20260430120000
--   • public.household_members — migration 20260430120000
--   • pgTAP extension   — CREATE EXTENSION IF NOT EXISTS pgtap
-- =============================================================================

-- Ensure pgTAP is available
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test schema
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS tests;

-- Grant pgtap execution to authenticated so RLS-mode assertions work.
-- In Supabase local the pgtap schema is public-accessible; this broadens
-- it to the authenticated role which tests switch into for RLS checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgtap') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA pgtap TO authenticated';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgtap TO authenticated';
  END IF;
  -- pgtap may live in public schema
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not grant pgtap to authenticated — tests must run as superuser';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.create_test_user(email TEXT) → uuid
--
-- Inserts a minimal row into auth.users and returns its id.
-- The id is generated here so callers can reference it before the INSERT.
--
-- Idempotency: subsequent calls with the same email return the existing id
-- (guarded by the ON CONFLICT clause on auth.users.email).
--
-- Requires: superuser or supabase_auth_admin role (SECURITY DEFINER satisfies
--           this when the function owner is postgres/superuser).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.create_test_user(email TEXT)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id,
    email,
    email_confirmed_at,
    created_at,
    updated_at,
    aud,
    role
  )
  VALUES (
    v_id,
    email,
    now(),
    now(),
    now(),
    'authenticated',
    'authenticated'
  )
  ON CONFLICT (email) DO UPDATE
    SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.create_test_household(name TEXT, owner uuid) → uuid
--
-- Inserts a household row as the given owner.  The trigger
-- trg_households_add_creator (migration 20260430120200) automatically inserts
-- the owner into household_members with role = 'owner'.
--
-- Returns the new household id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.create_test_household(name TEXT, owner uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.households (name, created_by)
  VALUES (name, owner)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.add_household_member(hh uuid, user_id uuid, role TEXT) → void
--
-- Directly inserts a membership row, bypassing RLS (SECURITY DEFINER).
-- Use this to set up non-owner members in test fixtures without impersonating
-- an owner.
--
-- role must be one of: 'owner', 'member', 'viewer'  (public.household_role enum)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.add_household_member(
  hh      uuid,
  user_id uuid,
  role    TEXT DEFAULT 'member'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (hh, user_id, role::public.household_role)
  ON CONFLICT (household_id, user_id) DO UPDATE
    SET role = EXCLUDED.role;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.set_session_user(user_id uuid) → void
--
-- Writes the user_id into request.jwt.claims so that auth.uid() (Supabase's
-- JWT-parsing function) returns user_id for the rest of the current
-- transaction (is_local = true).
--
-- Callers MUST also `SET LOCAL ROLE authenticated` BEFORE calling this
-- function so that RLS policies are evaluated.  Example usage:
--
--   SET LOCAL ROLE authenticated;
--   SELECT tests.set_session_user('<uuid>');
--   -- … RLS-protected queries here …
--   RESET ROLE;  -- restore postgres for fixture teardown
--
-- Note: set_config with is_local = true is reset automatically on
-- COMMIT/ROLLBACK, so test transactions using ROLLBACK get cleanup for free.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.set_session_user(user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text)::text,
    true   -- is_local: resets on transaction end
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.clear_session_user() → void
--
-- Clears request.jwt.claims so auth.uid() returns NULL.
-- Useful when switching from an authenticated context back to postgres-superuser
-- mid-test without a full RESET ROLE / ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.clear_session_user()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- tests.teardown() → void
--
-- Drops all test fixtures created in this session.  Call at end of CI run
-- or in a ROLLBACK block to leave the database clean.
--
-- CAUTION: This drops ALL rows inserted into auth.users, households, and
-- household_members by test functions.  Do NOT call against a production DB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tests.teardown()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- auth.users rows created with test email prefix
  DELETE FROM auth.users WHERE email LIKE 'test-%@rls-test.invalid';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Convenience: grant the tests schema to authenticated so it can call helpers
-- from within a SET ROLE authenticated block if needed.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA tests TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO authenticated;

-- end of 00_setup.sql
