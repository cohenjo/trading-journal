-- Migration: 20260430120200_rls_policies_households
-- Created: 2026-04-30
-- Purpose: Enable RLS on households + household_members, create all policies, and add creator-as-owner trigger

-- ============================================================
-- Enable RLS
-- ============================================================
alter table public.households       enable row level security;
alter table public.household_members enable row level security;

-- ============================================================
-- households policies
-- ============================================================

-- Any active member can read the household row
create policy households_member_read
  on public.households
  for select
  using (public.is_household_member(id));

-- Any authenticated user may create a household
-- (trigger below auto-inserts the creator as owner)
create policy households_authed_insert
  on public.households
  for insert
  with check (auth.uid() is not null);

-- Only the owner may rename or soft-delete (set deleted_at)
create policy households_owner_update
  on public.households
  for update
  using (public.is_household_owner(id));

-- Hard deletes are blocked for all users; use deleted_at for soft-delete.
-- Deviation from task spec ("owner only") intentional: the runbook §5 explicitly
-- uses `using (false)` to enforce soft-delete discipline on this table.
create policy households_no_hard_delete
  on public.households
  for delete
  using (false);

-- ============================================================
-- Trigger: auto-add creator as owner on INSERT
-- ============================================================
create or replace function public.add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.household_members (household_id, user_id, role, invited_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end;
$$;

-- Drop and recreate to remain idempotent across repeated migrations
drop trigger if exists trg_households_add_creator on public.households;

create trigger trg_households_add_creator
  after insert on public.households
  for each row execute function public.add_creator_as_owner();

-- ============================================================
-- household_members policies
-- ============================================================

-- Members can see the full membership list of their own household
create policy household_members_read
  on public.household_members
  for select
  using (public.is_household_member(household_id));

-- Only owners may add new members
-- (invite acceptance runs under service-role after token verification)
create policy household_members_owner_insert
  on public.household_members
  for insert
  with check (public.is_household_owner(household_id));

-- Only owners may update roles or set left_at
create policy household_members_owner_update
  on public.household_members
  for update
  using (public.is_household_owner(household_id));

-- Hard deletes blocked; owners use left_at to remove members.
-- Same soft-delete discipline as the households table.
create policy household_members_no_hard_delete
  on public.household_members
  for delete
  using (false);

-- end of migration
