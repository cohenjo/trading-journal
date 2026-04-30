-- Migration: 20260430130400_user_to_user_profile
-- Created: 2026-04-30 (rewritten from sketch; original: retire_local_user_table)
-- Author: McManus (Data Architecture) — addresses Decision #4 (2026-04-30)
--
-- ⚠️ DESTRUCTIVE — This migration drops public."user" with CASCADE.
--    Run only after confirming no application code reads/writes public.user.
--
-- DECISION #4: Convert public.user to public.user_profile.
-- The local public.user table (pre-Supabase username/password store) cannot
-- simply be retired — per-user app data (UI prefs, filter prefs, default household)
-- must live in a relational table. Approved approach: destructively replace with
-- public.user_profile (1:1 with auth.users).
--
-- DESTRUCTIVE ACTIONS:
--   - DROP TABLE public."user" CASCADE: removes the pre-Supabase password table.
--     Expected CASCADE casualties:
--       • public.user_legacy (if created by an earlier partial run of the old sketch)
--       • Any FK columns in other tables pointing to public."user".id — none found
--         in the Supabase migration chain as of 2026-04-30 (see FK audit below).
--
-- FK AUDIT RESULT (grep of supabase/migrations/ on 2026-04-30):
--   No Supabase migration file contains a FOREIGN KEY constraint referencing
--   public."user"(id). The table is a leaf node in the migration graph.
--   Any SQLAlchemy/Alembic-managed FKs must be removed from the Alembic migration
--   history before running this migration in a live environment.
--   See migration 20260430130600 for FK repoint record (no-op — none found).
--
-- WHAT THIS MIGRATION CREATES:
--   1. DROP public."user" (and user_legacy if it exists)
--   2. public.user_profile — owner-only app profile table (1:1 auth.users)
--   3. tg_update_timestamp trigger on user_profile (reuses fn from 20260430130000)
--   4. RLS: owner-only SELECT/INSERT/UPDATE/DELETE (id = auth.uid())
--   5. auth.users AFTER INSERT trigger — auto-creates a user_profile row for
--      every new Supabase user (SECURITY DEFINER + explicit search_path — see note)
--   6. Backfill: inserts user_profile rows for all pre-existing auth.users
--
-- SECURITY NOTE on trigger (handle_new_auth_user):
--   SECURITY DEFINER is required because auth.users is owned by supabase_auth_admin,
--   not the service role that owns public.* tables. Without it, the trigger would
--   fail with "insufficient privilege" when fired from the auth schema context.
--   SET search_path = public, auth prevents search-path injection attacks — a
--   malicious role could otherwise shadow pg functions by prepending a rogue schema.
--   This is the same pattern used by add_creator_as_owner() in 20260430120200.
--   ON CONFLICT DO NOTHING handles any race where the profile row already exists
--   (e.g., manual insert during backfill or testing).
--
-- NOTE: Audit created_by/updated_by columns reference auth.users(id) everywhere
--   else in this codebase (per Decision #4 supplementary). user_profile itself
--   does not need these because it IS the user identity row.

-- ================================================================
-- Step 1: Drop public."user" (and user_legacy if it exists from old sketch)
-- ================================================================
drop table if exists public.user_legacy cascade;
drop table if exists public."user" cascade;

-- ================================================================
-- Step 2: Create public.user_profile
-- ================================================================
create table if not exists public.user_profile (
  id                    uuid        primary key references auth.users(id) on delete cascade,
  display_name          text,
  default_household_id  uuid        references public.households(id) on delete set null,
  ui_preferences        jsonb       not null default '{}'::jsonb,
  filter_prefs          jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ================================================================
-- Step 3: Audit trigger (reuse tg_update_timestamp from 20260430130000)
-- ================================================================
drop trigger if exists trg_user_profile_updated_at on public.user_profile;
create trigger trg_user_profile_updated_at
  before update on public.user_profile
  for each row execute function public.tg_update_timestamp();

-- ================================================================
-- Step 4: Enable RLS and apply owner-only policies
-- ================================================================
alter table public.user_profile enable row level security;

-- Users can only read their own profile.
drop policy if exists user_profile_owner_select on public.user_profile;
create policy user_profile_owner_select
  on public.user_profile
  for select
  using (id = auth.uid());

-- Users can insert their own profile row.
-- (The auth trigger in Step 5 handles the typical creation path;
--  this policy also permits direct INSERT from application code.)
drop policy if exists user_profile_owner_insert on public.user_profile;
create policy user_profile_owner_insert
  on public.user_profile
  for insert
  with check (id = auth.uid());

-- Users can update their own profile.
drop policy if exists user_profile_owner_update on public.user_profile;
create policy user_profile_owner_update
  on public.user_profile
  for update
  using (id = auth.uid());

-- Users can delete their own profile row.
-- auth.users ON DELETE CASCADE will also clean up when the Supabase account is deleted.
drop policy if exists user_profile_owner_delete on public.user_profile;
create policy user_profile_owner_delete
  on public.user_profile
  for delete
  using (id = auth.uid());

-- ================================================================
-- Step 5: auth.users AFTER INSERT trigger
-- Automatically provisions a user_profile row for every new Supabase user.
-- See SECURITY NOTE in migration header for rationale on SECURITY DEFINER
-- and SET search_path.
-- ================================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_profile (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ================================================================
-- Step 6: Backfill — create user_profile rows for all pre-existing auth.users
-- This ensures no existing authenticated users are left without a profile.
-- ON CONFLICT DO NOTHING is safe to rerun.
-- ================================================================
insert into public.user_profile (id)
select id from auth.users
on conflict (id) do nothing;

-- end of migration
