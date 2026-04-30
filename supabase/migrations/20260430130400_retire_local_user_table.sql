-- ⚠️ DESTRUCTIVE. RUN ONLY AFTER all FK references are migrated to auth.users.
--
-- Migration: 20260430130400_retire_local_user_table
-- Created: 2026-04-30
-- Author: Hockney (Backend Dev) for TJ-005 / GH #58
--
-- BACKGROUND
-- ----------
-- The local public.user table (defined in user_models.py: User / SQLModel)
-- stores username + hashed_password for the pre-Supabase auth layer.
-- In the Supabase target architecture, identity is managed by auth.users.
-- This migration:
--   1. Snapshots public.user into public.user_legacy for safety
--   2. Drops public.user (no other SQLAlchemy model holds an FK to it — verified)
--
-- FK CHECK RESULTS (cross-verified 2026-04-30):
--   No SQLAlchemy model in apps/backend/app/schema/ declares a foreign_key
--   pointing to "user.id". The table is a leaf node — safe to drop once
--   auth has been migrated to Supabase.
--
-- PREREQUISITES before running:
--   □ All application code that reads/writes public.user has been updated
--     to use Supabase auth (auth.users + public.users mirror).
--   □ Existing user accounts have been migrated to auth.users via Supabase
--     admin API (supabase auth invite or import).
--   □ Alembic migration history has been updated to remove User model
--     from migration chain (to avoid auto-create on alembic upgrade).
--   □ Team sign-off from Keaton (architecture) and Jony.

-- ============================================================
-- Step 1: Snapshot public.user into public.user_legacy
-- Preserves existing data in case rollback is needed.
-- ============================================================
create table if not exists public.user_legacy as
  select * from public."user";

-- Add a note column for audit trail
alter table public.user_legacy
  add column if not exists retired_at timestamptz default now(),
  add column if not exists retirement_note text default 'Retired by migration 20260430130400. Auth migrated to auth.users.';

-- ============================================================
-- Step 2: Drop public.user
-- Guarded: this will fail if any un-caught FK still references it,
-- giving a safe error rather than silent data loss.
-- ============================================================
drop table if exists public."user";

-- If the DROP fails due to a FK constraint the engine will report:
--   ERROR:  cannot drop table user because other objects depend on it
--   DETAIL: constraint <name> on table <other_table> depends on table user
-- In that case: comment out the DROP above, document the FK chain below,
-- and coordinate with the relevant model owner to migrate the FK to auth.users first.
--
-- Known FK chain to break (if any are found):
--   (none detected in apps/backend/app/schema/ as of 2026-04-30)

-- end of migration
