-- Migration: 20260503090000_household_bootstrap_rpc
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-03
-- Purpose: Idempotent ensure_household RPC + active-household view + account_type + backfill
--
-- CONTEXT:
--   Despite migration 20260502120000 (trigger + backfill) being applied and 0 users
--   missing a household, Jony still sees "⚠️ No active household found for your account".
--   Diagnostic confirmed:
--     • All users have active household_members rows (left_at IS NULL)
--     • Trigger trg_auth_users_create_household is correct + SECURITY DEFINER
--     • RLS helpers owned by postgres (rolbypassrls=true) — no self-join deadlock
--     • Likely operational cause: stale Vercel anon key after service-role rotation
--       makes PostgREST JWT validation fail → auth.uid() NULL → household_members
--       SELECT returns 0 rows despite data existing.
--
-- THIS MIGRATION ADDS:
--   a) account_type column on households (missing; required by ensure_household)
--   b) ensure_household(p_account_type) RPC — SECURITY DEFINER, idempotent.
--      Frontend calls this once on load; it creates household if missing, returns
--      existing household_id otherwise. Bypasses the RLS chicken-and-egg problem.
--   c) v_my_active_household view — filters by auth.uid(), SECURITY INVOKER,
--      security_barrier=true. Clean read-path for the UI.
--   d) Backfill — re-runs household creation for any auth.users still missing one.
--      Idempotent (NOT EXISTS). Currently 0 rows affected; safe to re-run forever.
--   e) Trigger trg_auth_users_create_household retained as-is (belt-and-braces).
--
-- SECURITY NOTES:
--   • ensure_household is SECURITY DEFINER / owned by postgres (BYPASSRLS).
--     This is intentional: the RLS INSERT policy on household_members requires the
--     caller to already be an owner — impossible for a brand-new member. The function
--     itself gates access via auth.uid() IS NOT NULL check.
--   • GRANT EXECUTE only to authenticated; REVOKE from public and anon.
--   • search_path = public, pg_temp (no auth — uses full auth.uid() qualifier).
--   • View uses security_barrier=true to prevent RLS bypass via malicious functions.

-- ================================================================
-- a) Add account_type to households (idempotent, no data loss)
-- ================================================================
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'individual'
    CONSTRAINT households_account_type_check
      CHECK (account_type IN ('individual', 'joint'));

-- ================================================================
-- b) ensure_household(p_account_type text) → uuid
--
--    Returns the caller's active household_id. Creates one atomically
--    if none exists. Idempotent — safe to call on every page load.
--
--    Guarantee: once this function returns, the caller has an active
--    row in both households and household_members.
-- ================================================================
CREATE OR REPLACE FUNCTION public.ensure_household(
  p_account_type text DEFAULT 'individual'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id      uuid;
  v_household_id uuid;
  v_email        text;
BEGIN
  -- Gate: must be an authenticated session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ensure_household: caller is not authenticated (auth.uid() is null)';
  END IF;

  -- Validate p_account_type early to give a useful error
  IF p_account_type NOT IN ('individual', 'joint') THEN
    RAISE EXCEPTION 'ensure_household: invalid account_type ''%'' — must be individual or joint',
      p_account_type;
  END IF;

  -- Idempotency: return existing active household (most common path)
  SELECT m.household_id
  INTO   v_household_id
  FROM   public.household_members m
  WHERE  m.user_id  = v_user_id
    AND  m.left_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    RETURN v_household_id;
  END IF;

  -- New household path — resolve a friendly name from auth.users (best-effort)
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_user_id;

  -- INSERT into households. trg_households_add_creator (SECURITY DEFINER) fires
  -- automatically and inserts the owner row in household_members.
  INSERT INTO public.households (name, created_by, account_type)
  VALUES (
    COALESCE(NULLIF(TRIM(v_email), ''), 'My Household'),
    v_user_id,
    p_account_type
  )
  RETURNING id INTO v_household_id;

  RETURN v_household_id;
END;
$$;

-- Grant: authenticated only. Anon callers must never reach this RPC.
REVOKE EXECUTE ON FUNCTION public.ensure_household(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_household(text) TO   authenticated;

-- ================================================================
-- c) v_my_active_household — SECURITY INVOKER view with barrier
--
--    Exposes id, name, account_type, created_at for the current user's
--    active (non-deleted) household. The SECURITY INVOKER default means
--    the underlying RLS policies apply. security_barrier=true prevents
--    privilege escalation via WHERE clause injection.
--
--    Frontend / resolveHouseholdId alternative:
--      SELECT id FROM v_my_active_household LIMIT 1
-- ================================================================
DROP VIEW IF EXISTS public.v_my_active_household;

CREATE VIEW public.v_my_active_household
  WITH (security_invoker = on, security_barrier = true)
AS
SELECT
  h.id,
  h.name,
  h.account_type,
  h.created_at
FROM  public.households       h
JOIN  public.household_members m ON m.household_id = h.id
WHERE m.user_id    = auth.uid()
  AND m.left_at   IS NULL
  AND h.deleted_at IS NULL;

-- Grant SELECT to authenticated users only
REVOKE ALL ON public.v_my_active_household FROM public, anon;
GRANT  SELECT ON public.v_my_active_household TO authenticated;

-- ================================================================
-- d) Backfill — idempotent, currently affects 0 rows (confirmed by
--    diagnostic: all users already have active household_members rows).
--    Retained so this migration is safely re-runnable after future
--    batch imports or manual auth.users inserts that bypass the trigger.
-- ================================================================
INSERT INTO public.households (name, created_by, account_type)
SELECT
  COALESCE(NULLIF(TRIM(u.email), ''), 'My Household'),
  u.id,
  'individual'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM   public.household_members m
  WHERE  m.user_id  = u.id
    AND  m.left_at IS NULL
);

-- ================================================================
-- e) Belt-and-braces: trigger trg_auth_users_create_household is
--    RETAINED as-is. New sign-ups will always get a household via the
--    trigger. ensure_household() is the self-healing path for edge cases.
-- ================================================================
-- (no DDL needed — trigger already exists and is verified correct)

-- end of migration
