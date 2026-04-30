-- Migration: 20260430120000_households_and_members
-- Created: 2026-04-30
-- Purpose: Create households and household_members tables with role enum, indexes, and FK constraints

-- ============================================================
-- Role enum
-- Note: runbook uses 'household_role'; data-architecture doc uses
-- 'household_member_role'. We follow the runbook as canonical source.
-- ============================================================
do $$ begin
  create type public.household_role as enum ('owner', 'member', 'viewer');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- households
-- ============================================================
create table if not exists public.households (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  created_by  uuid        not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                -- soft-delete; enforce via application logic
);

-- ============================================================
-- household_members
-- ============================================================
create table if not exists public.household_members (
  household_id  uuid                    not null references public.households(id) on delete cascade,
  user_id       uuid                    not null references auth.users(id)         on delete cascade,
  role          public.household_role   not null default 'viewer',
  invited_by    uuid                             references auth.users(id),
  joined_at     timestamptz             not null default now(),
  left_at       timestamptz,                     -- soft-remove; kept for audit trail
  primary key (household_id, user_id)
);

-- ============================================================
-- Indexes
-- ============================================================

-- Fast "what households is this user currently in?" look-up (used by every RLS policy)
create index if not exists household_members_user_active_idx
  on public.household_members (user_id, household_id)
  where left_at is null;

-- end of migration
