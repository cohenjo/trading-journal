-- Revoke EXECUTE on handle_new_user_household() from API roles.
-- This is a trigger function (SECURITY DEFINER) and must never be callable
-- directly via PostgREST /rpc/. Addresses Supabase advisor warning
-- `anon_security_definer_function_executable`.

revoke execute on function public.handle_new_user_household() from anon, authenticated;

-- end of migration
