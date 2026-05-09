-- Migration: 20260502120000_auto_provision_household_on_signup
-- Created: 2026-05-02
-- Author: Hockney (Backend Dev) — fixes production bug: "No active household found for your account"
--
-- ROOT CAUSE:
--   Migration 20260430130400 added a trigger to create a `user_profile` row on
--   auth.users INSERT, but never added an equivalent trigger for
--   `households` + `household_members`. The FastAPI backend's `get_user_household_id()`
--   is a pure lookup with no auto-provisioning, and historically the Python signup
--   handler (or an Alembic migration) created the first household. Once the frontend
--   migrated to direct-Supabase Server Actions (PR #140), that provisioning path was
--   silently dropped, causing `resolveHouseholdId()` to return null for all users
--   who signed up after — or were never backfilled.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates `public.handle_new_user_household()` — SECURITY DEFINER function
--      that inserts a personal `households` row and an `owner` `household_members`
--      row for each new Supabase user.
--   2. Attaches `trg_auth_users_create_household` AFTER INSERT trigger on auth.users.
--      This fires *in addition to* the existing `trg_auth_users_create_profile`.
--   3. Backfills existing auth.users rows that have no active household_members row.
--      The backfill is idempotent (ON CONFLICT DO NOTHING + WHERE NOT EXISTS).
--
-- SECURITY NOTE (mirrors 20260430130400):
--   SECURITY DEFINER is required because auth.users is owned by supabase_auth_admin.
--   Without it the trigger would fail with "insufficient privilege" when fired from
--   the auth schema context.
--   SET search_path = public, auth prevents search-path injection attacks.
--
-- REVERSIBILITY:
--   To roll back:
--     DROP TRIGGER IF EXISTS trg_auth_users_create_household ON auth.users;
--     DROP FUNCTION IF EXISTS public.handle_new_user_household();
--   The backfill rows cannot be automatically reversed (they are real data).
--   Remove them manually if needed during development resets.

-- ================================================================
-- Step 1: Trigger function — provisions personal household + owner membership
-- ================================================================
create or replace function public.handle_new_user_household()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Create a personal household for this user.
  -- Name falls back through: full_name metadata → email → generic default.
  -- The existing `trg_households_add_creator` trigger on public.households
  -- automatically inserts the matching `household_members` owner row, so we
  -- intentionally do NOT insert into household_members here (would dup-key).
  insert into public.households (name, created_by)
  values (
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      new.email,
      'My Household'
    ),
    new.id
  );

  return new;
end;
$$;

-- ================================================================
-- Step 2: Attach trigger to auth.users (safe to re-run — DROP IF EXISTS first)
-- ================================================================
drop trigger if exists trg_auth_users_create_household on auth.users;
create trigger trg_auth_users_create_household
  after insert on auth.users
  for each row execute function public.handle_new_user_household();

-- ================================================================
-- Step 3: Backfill — create a household for each existing auth.users row
-- that currently has no active (left_at IS NULL) household_members row.
--
-- The `trg_households_add_creator` trigger on public.households will then
-- automatically create the matching `household_members` owner row, so we
-- only need to INSERT into public.households here.
--
-- This unblocks any user who signed up before this trigger was installed,
-- including the production account that reported the error.
-- ================================================================
insert into public.households (name, created_by)
select
  coalesce(u.email, 'My Household') as name,
  u.id as created_by
from auth.users u
where not exists (
  select 1
  from public.household_members m
  where m.user_id = u.id
    and m.left_at is null
);

-- end of migration
