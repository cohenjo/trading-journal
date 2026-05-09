-- Migration: 20260502094810_e2e_reset_test_user_v2
-- Source: pulled from production (remote-only, issue #335)

-- Update e2e_reset_test_user to bypass last_owner_constraint triggers during E2E teardown.
-- Uses session_replication_role = replica to disable non-ALWAYS triggers temporarily.
-- Still REVOKED from anon/authenticated; GRANTED only to service_role.

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
  select id into v_user_id
    from auth.users
   where email = p_email
   limit 1;

  if v_user_id is null then
    raise notice '[e2e_reset_test_user] No auth.users row for email "%"', p_email;
    return;
  end if;

  select household_id into v_hh_id
    from public.household_members
   where user_id = v_user_id
   limit 1;

  if v_hh_id is null then
    raise notice '[e2e_reset_test_user] No household for user % — nothing to reset', v_user_id;
    return;
  end if;

  -- Disable row-level triggers (last_owner_constraint guard) for this session.
  -- session_replication_role = replica bypasses non-ALWAYS triggers, allowing
  -- direct deletion of the last owner row without the guard firing.
  set local session_replication_role = replica;

  delete from public.finance_snapshots where household_id = v_hh_id;
  delete from public.trade             where household_id = v_hh_id;
  delete from public.household_members where household_id = v_hh_id;
  delete from public.households        where id           = v_hh_id;

  -- Restore trigger mode (SET LOCAL scopes to the current transaction, but
  -- explicit RESET makes intent clear)
  reset session_replication_role;

  raise notice '[e2e_reset_test_user] Reset household % for user % (%)', v_hh_id, v_user_id, p_email;
end;
$$;

revoke execute on function public.e2e_reset_test_user(text) from anon, authenticated;
grant execute on function public.e2e_reset_test_user(text) to service_role;
