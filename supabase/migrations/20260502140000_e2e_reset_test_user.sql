-- migration: 20260502140000_e2e_reset_test_user.sql
--
-- Adds `public.e2e_reset_test_user(email text)` — a SECURITY DEFINER helper
-- that wipes all household data for a single test user on demand.
--
-- Security model (mirrors 20260502130000):
--   - SECURITY DEFINER: runs as the function owner (postgres/service)
--   - REVOKE EXECUTE FROM anon, authenticated: not callable via PostgREST /rpc/
--   - GRANT EXECUTE TO service_role: only the service-role key (used by E2E scripts) can call it
--
-- Usage (from E2E scripts via service-role client):
--   SELECT public.e2e_reset_test_user('e2e+playwright@trading-journal.test');
--
-- Cascade order (avoids FK conflicts):
--   1. finance_snapshots — FK: household_id
--   2. trade             — FK: household_id
--   3. household_members — FK: household_id
--   4. households        — the root row (cascade deletes anything remaining)
--
-- NOTE: This does NOT delete the auth.users row.
--       To fully remove the user, call auth.admin.deleteUser(userId) via the
--       Supabase admin API (handled by teardownTestUser() in
--       e2e/helpers/provision-test-user.ts).
--
-- Skip if cascade-on-delete via the auth user already covers all data:
-- This function is provided as a supplementary on-demand reset that lets CI
-- wipe household data for a long-lived shared user WITHOUT deleting the auth row.

create or replace function public.e2e_reset_test_user(p_email text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id  uuid;
  v_hh_id    uuid;
begin
  -- Resolve user id from auth.users
  select id into v_user_id
    from auth.users
   where email = p_email
   limit 1;

  if v_user_id is null then
    raise notice '[e2e_reset_test_user] No auth.users row for email "%"', p_email;
    return;
  end if;

  -- Resolve household id (if any)
  select household_id into v_hh_id
    from public.household_members
   where user_id = v_user_id
   limit 1;

  if v_hh_id is null then
    raise notice '[e2e_reset_test_user] No household for user % — nothing to reset', v_user_id;
    return;
  end if;

  -- Wipe data in correct order:
  -- 1. finance/trade data (no constraint issues)
  -- 2. Downgrade owner role to 'member' to bypass tg_household_members_delete_guard
  -- 3. Delete household_members (no longer an 'owner' row → guard doesn't fire)
  -- 4. Delete household itself
  delete from public.finance_snapshots where household_id = v_hh_id;
  delete from public.trade             where household_id = v_hh_id;
  update public.household_members set role = 'member' where household_id = v_hh_id;
  delete from public.household_members where household_id = v_hh_id;
  delete from public.households        where id           = v_hh_id;

  raise notice '[e2e_reset_test_user] Reset household % for user % (%)', v_hh_id, v_user_id, p_email;
end;
$$;

-- Lock down the function: API roles must not call it directly
revoke execute on function public.e2e_reset_test_user(text) from anon, authenticated;

-- Allow only the service-role (used by E2E scripts) to call it
grant execute on function public.e2e_reset_test_user(text) to service_role;

-- end of migration
