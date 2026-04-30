-- Migration: 20260430120100_rls_helpers
-- Created: 2026-04-30
-- Purpose: Create security-definer helper functions used by all household RLS policies

-- ============================================================
-- is_household_member(p_household_id uuid) → boolean
--
-- Returns true when the current session user is an active
-- (left_at IS NULL) member of the given household.
--
-- security definer: executes as the function owner (postgres/service),
-- not as the calling user, preventing privilege escalation while still
-- allowing auth.uid() to reflect the actual session identity.
-- SET search_path prevents search-path injection attacks.
-- ============================================================
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from   public.household_members
    where  household_id = p_household_id
      and  user_id      = auth.uid()
      and  left_at      is null
  );
$$;

-- ============================================================
-- is_household_owner(p_household_id uuid) → boolean
--
-- Returns true when the current session user holds the 'owner'
-- role in the given household and has not left it.
-- ============================================================
create or replace function public.is_household_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from   public.household_members
    where  household_id = p_household_id
      and  user_id      = auth.uid()
      and  role         = 'owner'
      and  left_at      is null
  );
$$;

-- ============================================================
-- Grant control
-- Revoke broad PUBLIC execute; grant only to the authenticated role
-- so anon requests cannot invoke these helpers directly.
-- ============================================================
revoke execute on function public.is_household_member(uuid) from public;
revoke execute on function public.is_household_owner(uuid)  from public;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid)  to authenticated;

-- end of migration
