-- Disposable local stack only. The legacy fixture reset needs its intended
-- privileged owner; never grant replication privileges to application roles.
begin;

alter function public.e2e_reset_test_user(text) owner to supabase_admin;
alter function public.e2e_reset_test_user(text) set search_path = '';
revoke all on function public.e2e_reset_test_user(text)
  from public, anon, authenticated;
grant execute on function public.e2e_reset_test_user(text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.e2e_reset_test_user(text)'::regprocedure
      and p.prosecdef and r.rolsuper
  ) then
    raise exception 'E2E reset requires a privileged definer, not privileged callers';
  end if;
  if has_function_privilege('anon', 'public.e2e_reset_test_user(text)', 'execute')
    or has_function_privilege(
      'authenticated', 'public.e2e_reset_test_user(text)', 'execute'
    )
    or not has_function_privilege(
      'service_role', 'public.e2e_reset_test_user(text)', 'execute'
    ) then
    raise exception 'E2E cleanup must be service-role only';
  end if;
end;
$$;

commit;
