-- Migration: 20260430130500_relax_delete_policies
-- Created: 2026-04-30
-- Author: McManus (Data Architecture) — addresses Decision #1 (2026-04-30)
--
-- DECISION #1: Drop USING (false) on DELETE policies for household-scoped tables.
-- Hard-delete is permitted for the household owner (role='owner' in household_members).
-- Keep deleted_at / left_at audit columns for soft-delete UX where desired, but
-- do NOT enforce soft-delete as a hard database constraint.
--
-- TABLES MODIFIED (both had USING (false) DELETE policies in 20260430120200):
--   - public.households         (households_no_hard_delete → households_owner_delete)
--   - public.household_members  (household_members_no_hard_delete → household_members_owner_delete)
--
-- NOTE on 'admin' role: The user decision text references "household admin
-- (member with role='admin')". The household_role enum is ('owner','member','viewer')
-- — there is no 'admin' value. The 'owner' role is the administrative equivalent;
-- is_household_owner() (defined in 20260430120100) checks for role='owner'.
--
-- NOTE on other household-scoped tables: Tables added via 20260430130100/130200
-- (manualtrade, trade, execution, etc.) had NO DELETE policies defined in the
-- 12xxxx/13xxxx migration series — those RLS policies are Redfoot's domain (PR #88).
-- This migration only touches the two tables where USING (false) was explicit.
--
-- NOTE on trading_account_config: DELETE policy added in 20260430130300 already
-- follows Decision #1 (owner-only, no USING (false)). Not repeated here.

-- ================================================================
-- households: replace hard-delete block with owner-only hard-delete
-- ================================================================
drop policy if exists households_no_hard_delete on public.households;

-- Household owner (role='owner' in household_members) may hard-delete the household.
-- CASCADE on household_members, trading_account_config, etc. will fire automatically.
create policy households_owner_delete
  on public.households
  for delete
  using (public.is_household_owner(id));

-- ================================================================
-- household_members: replace hard-delete block with owner-only hard-delete
-- ================================================================
drop policy if exists household_members_no_hard_delete on public.household_members;

-- Household owner may hard-remove a member row (forced removal).
-- Members wishing to leave should use left_at (soft-remove); this policy is for
-- administrative removal by the owner.
create policy household_members_owner_delete
  on public.household_members
  for delete
  using (public.is_household_owner(household_id));

-- end of migration
