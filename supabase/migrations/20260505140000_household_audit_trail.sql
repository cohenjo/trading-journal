-- Migration: 20260505140000_household_audit_trail
-- Author: Hockney (Backend Dev)
-- Purpose: Create household_audit_log — append-only audit trail for household
--          lifecycle events (invites, membership changes, renames, deletes, etc.)
-- Issues: #77 (TJ-024)
--
-- DESIGN NOTES:
--   - Table name `household_audit_log` matches issue #77 acceptance criteria.
--   - RLS: SELECT restricted to household **owners** only (AC: "readable by
--     household owners only"). INSERT is service-role only (bypasses RLS).
--     UPDATE and DELETE are blocked unconditionally — audit is append-only.
--   - `user_id` = actor (who triggered the event; NULL for system/trigger events).
--   - `actor_ip` / `actor_user_agent` stored for security forensics; never logged
--     raw for unauthenticated contexts. IP masking deferred to follow-up issue.
--   - `metadata` JSONB: callers MUST redact financial amounts, account numbers,
--     and raw invite tokens before inserting. The helper (audit.ts) enforces this.
--   - Foreign keys use ON DELETE SET NULL for actor/target (retain audit after
--     user deletion) and ON DELETE CASCADE for household_id (audit lives with
--     the household).
--   - `household_created` event is emitted by the household bootstrap trigger;
--     the helper must be called from application code for all other events.

-- ============================================================
-- Action enum
-- ============================================================
do $$ begin
  create type public.household_audit_action as enum (
    'household_created',
    'invite_created',
    'invite_accepted',
    'invite_revoked',
    'role_changed',
    'member_removed',
    'member_left',
    'household_renamed',
    'household_deleted',
    'household_restored'
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- household_audit_log
-- ============================================================
create table if not exists public.household_audit_log (
  id               uuid                             primary key default gen_random_uuid(),
  household_id     uuid                             not null references public.households(id) on delete cascade,
  user_id          uuid                             references auth.users(id) on delete set null,
  action           public.household_audit_action    not null,
  target_user_id   uuid                             references auth.users(id) on delete set null,
  target_invite_id uuid,                            -- no FK: invites are short-lived
  metadata         jsonb                            not null default '{}'::jsonb,
  actor_ip         inet,                            -- nullable; set when request context available
  actor_user_agent text,                            -- nullable; set when request context available
  created_at       timestamptz                      not null default now()
);

comment on table  public.household_audit_log is
  'Append-only audit trail for household lifecycle events. '
  'Financial data, account numbers, and raw invite tokens MUST be '
  'redacted from metadata before insertion.';

comment on column public.household_audit_log.user_id is
  'Actor who triggered the event. NULL for system/trigger-fired events.';
comment on column public.household_audit_log.target_user_id is
  'Affected user (e.g., the invited or removed member). NULL when not applicable.';
comment on column public.household_audit_log.target_invite_id is
  'Affected invite UUID (no FK — invite rows may be short-lived). NULL when not applicable.';
comment on column public.household_audit_log.metadata is
  'Contextual details (before/after diff, custom fields). '
  'Must NOT contain dollar amounts, account numbers, or raw tokens.';
comment on column public.household_audit_log.actor_ip is
  'IP address of the actor at event time, for security forensics. '
  'Full IP masking / anonymisation deferred to follow-up issue.';

-- ============================================================
-- Indexes
-- ============================================================
-- Primary query: "show me this household''s audit history"
create index if not exists household_audit_log_household_time_idx
  on public.household_audit_log (household_id, created_at desc);

-- Secondary: "what has this user done across households?"
create index if not exists household_audit_log_actor_time_idx
  on public.household_audit_log (user_id, created_at desc)
  where user_id is not null;

-- Filtering by action type (admin dashboards, compliance queries)
create index if not exists household_audit_log_action_time_idx
  on public.household_audit_log (action, created_at desc);

-- ============================================================
-- RLS
-- ============================================================
alter table public.household_audit_log enable row level security;

-- SELECT: household owners only (AC requirement: "readable by household owners only")
drop policy if exists household_audit_log_owner_read on public.household_audit_log;
create policy household_audit_log_owner_read
  on public.household_audit_log
  for select
  using (public.is_household_owner(household_id));

-- INSERT: blocked for all authenticated/anon roles.
--   Inserts are performed via the service-role client (audit.ts helper), which
--   bypasses RLS entirely. No INSERT policy needed — absence = deny.

-- UPDATE: forbidden — audit is append-only.
drop policy if exists household_audit_log_no_update on public.household_audit_log;
create policy household_audit_log_no_update
  on public.household_audit_log
  for update
  using (false);

-- DELETE: forbidden — audit is append-only.
drop policy if exists household_audit_log_no_delete on public.household_audit_log;
create policy household_audit_log_no_delete
  on public.household_audit_log
  for delete
  using (false);

-- ============================================================
-- Revoke / grant
-- ============================================================
-- Authenticated role may only SELECT (constrained further by the RLS policy above).
-- The service-role bypasses RLS and can INSERT.
revoke insert, update, delete on public.household_audit_log from authenticated, anon;
grant  select                  on public.household_audit_log to authenticated;

-- end of migration
