-- Migration: 20260430150000_sharing_rls_policies
-- TJ-022: Sharing-specific RLS policies and role enforcement
-- Author: Rabin (Security Engineer)
-- Closes: GH #75
--
-- This migration hardens household sharing access control by:
--   1. Refactoring helpers to include soft-delete boundary (deleted_at IS NULL)
--   2. Adding per-role write gating (is_household_writer, has_active_other_owner)
--   3. Replacing household_members RLS policies with role-aware versions
--   4. Adding last-owner protection via BEFORE trigger (raises exception)
--   5. Extending cooked-table policies to allow owner/member writes
--   6. Adding optimistic-concurrency columns (version, updated_at) + bump trigger
--
-- Idempotent: CREATE OR REPLACE for functions; DROP POLICY IF EXISTS + CREATE for
-- policies; ADD COLUMN IF NOT EXISTS for schema additions.
--
-- IMPORTANT for coordinator:
--   - households.deleted_at already exists (added in 20260430120000). Not re-added.
--   - raw.* and compute.* remain service-role-only; no RLS added there.
--   - hard-delete for households: blocked unless a second active owner exists.
--     In single-owner households, prefer soft-delete via deleted_at.
--   - cooked INSERT/UPDATE/DELETE: two policies coexist — service_role policy
--     (for compute worker) and authenticated writer policy (owner/member).
--     service_role bypasses RLS by default in Supabase unless FORCE ROW LEVEL
--     SECURITY is set; both policies are retained for defense-in-depth.
--
-- Search-path convention (Rabin): SET search_path = public, pg_temp on every
-- SECURITY DEFINER function. auth.uid() is always schema-qualified, so it works
-- correctly regardless of search_path.

-- ============================================================
-- SECTION 1: Schema additions
-- Add version (optimistic concurrency) and updated_at to
-- households and household_members.
-- ============================================================

ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS version    int         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.households.version IS
  'Optimistic-concurrency counter. Incremented on every UPDATE by tg_bump_version.
   Clients should include the version they read in UPDATE WHERE clauses and treat
   a 0-row result as a conflict requiring re-fetch.';

COMMENT ON COLUMN public.households.updated_at IS
  'Last-modified timestamp. Kept in sync with version by tg_bump_version trigger.';

ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS version    int         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.household_members.version IS
  'Optimistic-concurrency counter. Incremented on every UPDATE by tg_bump_version.';

COMMENT ON COLUMN public.household_members.updated_at IS
  'Last-modified timestamp. Kept in sync with version by tg_bump_version trigger.';

-- ============================================================
-- SECTION 2: Core role-lookup helper (canonical pattern from design.md §5)
--
-- household_role_for(p_household_id)
--   Returns the calling user's current role in p_household_id, or NULL if the
--   user is not an active member of that household, or if the household is
--   soft-deleted (deleted_at IS NOT NULL).
--
--   Used as the single source-of-truth for all downstream membership checks.
--   Replacing two independent EXISTS queries with one join guarantees that
--   every helper inherits the deleted_at guard automatically.
-- ============================================================

CREATE OR REPLACE FUNCTION public.household_role_for(p_household_id uuid)
RETURNS public.household_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT hm.role
  FROM   public.household_members hm
  JOIN   public.households        h  ON h.id = hm.household_id
  WHERE  hm.household_id = p_household_id
    AND  hm.user_id      = auth.uid()
    AND  hm.left_at      IS NULL
    AND  h.deleted_at    IS NULL
  LIMIT  1;
$$;

COMMENT ON FUNCTION public.household_role_for(uuid) IS
  'Returns the current session user''s role in the given household, or NULL if the
   user is not an active member (left_at IS NULL) of a non-deleted household.
   SECURITY DEFINER with pinned search_path prevents search-path injection.
   All other membership helpers delegate to this function; update this one to
   change the shared membership definition.';

-- ============================================================
-- SECTION 3: Membership helpers — CREATE OR REPLACE to update
--            the existing 20260430120100 helpers in-place.
--
-- All three now delegate to household_role_for, which enforces:
--   • left_at IS NULL (active membership)
--   • households.deleted_at IS NULL (soft-delete boundary)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.household_role_for(p_household_id) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.is_household_member(uuid) IS
  'Returns true iff the current session user is an active member (any role) of the
   given household and the household has not been soft-deleted.
   Used by SELECT policies on all household-scoped tables.';

CREATE OR REPLACE FUNCTION public.is_household_owner(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.household_role_for(p_household_id) = 'owner';
$$;

COMMENT ON FUNCTION public.is_household_owner(uuid) IS
  'Returns true iff the current session user holds the ''owner'' role in the given
   household and has not left it (left_at IS NULL) and the household is not
   soft-deleted. Used by administrative INSERT/UPDATE/DELETE policies.';

-- ============================================================
-- SECTION 4: New write-gate helper
--
-- is_household_writer(p_household_id)
--   Returns true for owner OR member role. Viewers are explicitly excluded.
--   Used by INSERT/UPDATE/DELETE policies on cooked and other household tables.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_household_writer(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.household_role_for(p_household_id) IN ('owner', 'member');
$$;

COMMENT ON FUNCTION public.is_household_writer(uuid) IS
  'Returns true iff the current session user has write access to the household:
   role = ''owner'' OR role = ''member'', left_at IS NULL, deleted_at IS NULL.
   Viewers are explicitly excluded. Use in INSERT/UPDATE/DELETE RLS policies on
   household-scoped tables that non-owner members are permitted to write.';

-- ============================================================
-- SECTION 5: Last-owner protection helper
--
-- has_active_other_owner(p_household_id, p_excluding_user)
--   Returns true iff at least ONE other active owner (not p_excluding_user, not
--   left the household) exists in the household.
--
--   Intentionally does NOT join households: this function is called from triggers
--   that may fire during household membership changes while the household row is
--   still valid. Not joining households avoids false negatives on soft-delete paths.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_active_other_owner(
  p_household_id   uuid,
  p_excluding_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.household_members
    WHERE  household_id = p_household_id
      AND  user_id      <> p_excluding_user
      AND  role         = 'owner'
      AND  left_at      IS NULL
  );
$$;

COMMENT ON FUNCTION public.has_active_other_owner(uuid, uuid) IS
  'Returns true iff at least one OTHER active owner (left_at IS NULL,
   user_id != p_excluding_user) exists in the household.
   Used by the last-owner protection trigger and by the household DELETE policy
   to prevent irrecoverable ownership loss. Does not check deleted_at because
   trigger execution may precede the soft-delete write.';

-- ============================================================
-- SECTION 6: Grant / revoke on helpers
-- Revoke PUBLIC execute; grant only to authenticated to prevent
-- anon-role direct invocation. service_role bypasses RLS, so no
-- explicit grant is needed for service_role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.household_role_for(uuid)            FROM public;
REVOKE EXECUTE ON FUNCTION public.is_household_member(uuid)            FROM public;
REVOKE EXECUTE ON FUNCTION public.is_household_owner(uuid)             FROM public;
REVOKE EXECUTE ON FUNCTION public.is_household_writer(uuid)            FROM public;
REVOKE EXECUTE ON FUNCTION public.has_active_other_owner(uuid, uuid)   FROM public;

GRANT EXECUTE ON FUNCTION public.household_role_for(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_owner(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_writer(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_other_owner(uuid, uuid)    TO authenticated;

-- ============================================================
-- SECTION 7: Last-owner protection trigger
--
-- tg_household_members_guard fires BEFORE UPDATE on household_members.
-- If an owner row is being demoted (role changed away from 'owner') or
-- soft-removed (left_at set to non-null), the trigger verifies that at
-- least one other active owner will remain. If not, it raises a
-- classified exception (SQLSTATE P0001) that surfaces cleanly to
-- application error handlers.
--
-- This is a HARD constraint, not a soft warning. The exception must be
-- caught and surfaced to the client as a conflict rather than silently
-- swallowed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_household_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only acts when an owner row is being changed
  IF OLD.role = 'owner' THEN
    IF (
      -- Role is being demoted away from owner
      NEW.role <> 'owner'
      OR
      -- Owner is being soft-removed (left_at set)
      (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
    ) THEN
      IF NOT public.has_active_other_owner(OLD.household_id, OLD.user_id) THEN
        RAISE EXCEPTION
          'last_owner_constraint: cannot demote or remove the last active owner of household %',
          OLD.household_id
          USING ERRCODE = 'P0001',
                HINT    = 'Assign another member as owner before demoting or removing the current owner.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_household_members_guard() IS
  'BEFORE UPDATE trigger for household_members. Enforces the invariant that every
   non-deleted household retains at least one active owner at all times.
   Raises SQLSTATE P0001 (last_owner_constraint) if demotion or soft-removal of
   the last active owner is attempted. This is a HARD constraint.';

DROP TRIGGER IF EXISTS trg_household_members_guard ON public.household_members;

CREATE TRIGGER trg_household_members_guard
  BEFORE UPDATE ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_household_members_guard();

COMMENT ON TRIGGER trg_household_members_guard ON public.household_members IS
  'Last-owner guard: blocks any UPDATE that would leave a household without an
   active owner. Fires before the write so the transaction is aborted cleanly.';

-- ============================================================
-- SECTION 8: Last-owner protection on hard DELETE
--
-- tg_household_members_delete_guard fires BEFORE DELETE on household_members.
-- Prevents hard-deleting the last active owner row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_household_members_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    IF NOT public.has_active_other_owner(OLD.household_id, OLD.user_id) THEN
      RAISE EXCEPTION
        'last_owner_constraint: cannot hard-delete the last active owner of household %',
        OLD.household_id
        USING ERRCODE = 'P0001',
              HINT    = 'Soft-remove with left_at or assign another owner first.';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.tg_household_members_delete_guard() IS
  'BEFORE DELETE trigger for household_members. Prevents the last active owner
   row from being hard-deleted. Raises SQLSTATE P0001 (last_owner_constraint).';

DROP TRIGGER IF EXISTS trg_household_members_delete_guard ON public.household_members;

CREATE TRIGGER trg_household_members_delete_guard
  BEFORE DELETE ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_household_members_delete_guard();

COMMENT ON TRIGGER trg_household_members_delete_guard ON public.household_members IS
  'Last-owner guard on hard-DELETE: blocks removal of the last active owner row.';

-- ============================================================
-- SECTION 9: Optimistic-concurrency bump trigger
--
-- tg_bump_version fires BEFORE UPDATE on households and household_members.
-- Increments version and updates updated_at so application code can detect
-- concurrent edits by comparing the version they read against the current row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.version    := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_bump_version() IS
  'BEFORE UPDATE trigger function: increments version and refreshes updated_at.
   Attach to any table that needs optimistic-concurrency support. Clients should
   include WHERE version = <read_version> in UPDATE statements; zero affected rows
   signals a concurrent write and should prompt a re-fetch + user conflict message.';

DROP TRIGGER IF EXISTS trg_households_bump_version ON public.households;

CREATE TRIGGER trg_households_bump_version
  BEFORE UPDATE ON public.households
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_bump_version();

COMMENT ON TRIGGER trg_households_bump_version ON public.households IS
  'Increments households.version and sets updated_at on every UPDATE.
   Used for optimistic-concurrency control on concurrent household edits
   (design.md §13 — "Concurrent household edits").';

DROP TRIGGER IF EXISTS trg_household_members_bump_version ON public.household_members;

CREATE TRIGGER trg_household_members_bump_version
  BEFORE UPDATE ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_bump_version();

COMMENT ON TRIGGER trg_household_members_bump_version ON public.household_members IS
  'Increments household_members.version and sets updated_at on every UPDATE.';

-- NOTE: trigger firing order on household_members UPDATE:
-- PostgreSQL fires BEFORE triggers in alphabetical order by trigger name.
-- Alphabetically: trg_household_members_bump_version (b) < trg_household_members_guard (g),
-- so bump_version fires first and modifies NEW in-memory. If guard then raises an
-- exception, the entire transaction aborts — the in-memory NEW changes are discarded
-- and nothing is committed. Correctness is preserved regardless of order.

-- ============================================================
-- SECTION 10: household_members policies — drop & recreate
--
-- Replaces the four policies set up in 20260430120200 (select, insert, update)
-- and 20260430130500 (delete).
-- ============================================================

-- Old policy names (from 20260430120200 + 20260430130500)
DROP POLICY IF EXISTS household_members_read          ON public.household_members;
DROP POLICY IF EXISTS household_members_owner_insert  ON public.household_members;
DROP POLICY IF EXISTS household_members_owner_update  ON public.household_members;
DROP POLICY IF EXISTS household_members_owner_delete  ON public.household_members;
-- New policy names (idempotency: drop before recreate if migration is re-run)
DROP POLICY IF EXISTS household_members_select        ON public.household_members;
DROP POLICY IF EXISTS household_members_insert        ON public.household_members;
DROP POLICY IF EXISTS household_members_update        ON public.household_members;
DROP POLICY IF EXISTS household_members_delete        ON public.household_members;

-- SELECT: any active member of the household (owner, member, viewer) can
-- see the full membership list, enabling UI to show who has access.
CREATE POLICY household_members_select
  ON public.household_members
  FOR SELECT
  USING (public.is_household_member(household_id));

COMMENT ON POLICY household_members_select ON public.household_members IS
  'Any active member (any role) of the household may read the full member list.
   Inactive members (left_at IS NOT NULL) and non-members see no rows.
   Delegates to is_household_member which also enforces households.deleted_at IS NULL.';

-- INSERT (invite): only household owners may add new members.
-- Invite acceptance (token verification) runs under service-role after token
-- validation, so service-role is not constrained by this policy.
CREATE POLICY household_members_insert
  ON public.household_members
  FOR INSERT
  WITH CHECK (public.is_household_owner(household_id));

COMMENT ON POLICY household_members_insert ON public.household_members IS
  'Only the household owner may insert new member rows (i.e. invite someone).
   Invite acceptance (token-verified) runs under service-role which bypasses RLS.
   Role must be specified at insert time; the trigger prevents owner-role inserts
   that would violate the last-owner invariant (does not apply to INSERTs).';

-- UPDATE: dual-path policy —
--   a) Owners may update any member row (role changes, forced left_at).
--   b) Members/viewers may update ONLY their own row (self-leave: set left_at).
--
-- Last-owner protection is enforced by trg_household_members_guard (RAISE EXCEPTION
-- if the acting user is the last owner and tries to demote or set left_at).
-- The RLS policy intentionally does not duplicate that check here to avoid
-- logic duplication; the trigger is the authoritative constraint.
CREATE POLICY household_members_update
  ON public.household_members
  FOR UPDATE
  USING (
    public.is_household_owner(household_id)
    OR (
      user_id = auth.uid()
      AND public.is_household_member(household_id)
    )
  )
  WITH CHECK (
    public.is_household_owner(household_id)
    OR (
      user_id = auth.uid()
      AND public.is_household_member(household_id)
    )
  );

COMMENT ON POLICY household_members_update ON public.household_members IS
  'Two UPDATE paths:
   (a) Owner: may update any member row, including role changes and forced removal
       (left_at). Last-owner protection enforced by trg_household_members_guard.
   (b) Active member (any role): may update ONLY their own row. Intended use is
       self-leave (setting own left_at = now()). The trigger blocks self-leave if
       the member is the last active owner (P0001 exception).
   Acting user identity comes from auth.uid() — never trusted from client input.';

-- DELETE (hard remove): owner only, AND last-owner protection enforced by
-- trg_household_members_delete_guard (RAISE EXCEPTION if last owner).
CREATE POLICY household_members_delete
  ON public.household_members
  FOR DELETE
  USING (public.is_household_owner(household_id));

COMMENT ON POLICY household_members_delete ON public.household_members IS
  'Only the household owner may hard-delete a member row.
   trg_household_members_delete_guard prevents deletion of the last active owner.
   For normal member departures, prefer soft-removal (left_at) to retain audit trail.';

-- ============================================================
-- SECTION 11: households policies — drop & recreate
--
-- Refinements:
--   • households_member_read → households_select (name change, same logic —
--     is_household_member now implicitly enforces deleted_at IS NULL)
--   • households_authed_insert — unchanged (drop + recreate for idempotency)
--   • households_owner_update  — unchanged but drop + recreate to stay idempotent
--   • households_owner_delete  → households_delete (adds has_active_other_owner
--     guard; see note below)
-- ============================================================

DROP POLICY IF EXISTS households_member_read    ON public.households;
DROP POLICY IF EXISTS households_authed_insert  ON public.households;
DROP POLICY IF EXISTS households_owner_update   ON public.households;
DROP POLICY IF EXISTS households_owner_delete   ON public.households;
-- Also drop new name if re-running
DROP POLICY IF EXISTS households_select         ON public.households;
DROP POLICY IF EXISTS households_delete         ON public.households;

-- SELECT: active members only (viewer included).
-- is_household_member now enforces deleted_at IS NULL via household_role_for,
-- so soft-deleted households are invisible to all roles automatically.
CREATE POLICY households_select
  ON public.households
  FOR SELECT
  USING (public.is_household_member(id));

COMMENT ON POLICY households_select ON public.households IS
  'Any active member (owner, member, or viewer) may read the household row.
   Soft-deleted households (deleted_at IS NOT NULL) are invisible because
   is_household_member delegates to household_role_for which filters on deleted_at.';

-- INSERT: any authenticated user may create a household.
-- The add_creator_as_owner trigger (20260430120200) auto-adds them as owner.
CREATE POLICY households_authed_insert
  ON public.households
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON POLICY households_authed_insert ON public.households IS
  'Any authenticated user may create a household. The trg_households_add_creator
   trigger immediately inserts the creator as the household owner.';

-- UPDATE: owner only (rename/soft-delete via deleted_at).
-- is_household_owner now enforces deleted_at IS NULL, so owners of soft-deleted
-- households cannot further modify them via authenticated RLS.
-- (Restore operations run under service-role and bypass this policy.)
CREATE POLICY households_owner_update
  ON public.households
  FOR UPDATE
  USING (public.is_household_owner(id));

COMMENT ON POLICY households_owner_update ON public.households IS
  'Only the household owner may update the household row (e.g., rename or
   soft-delete by setting deleted_at). Restoration of soft-deleted households
   requires service-role (bypasses RLS) to avoid the deleted_at guard.';

-- DELETE: owner only AND at least one OTHER active owner must exist.
-- In practice, single-owner households cannot be hard-deleted via authenticated
-- RLS — soft-delete (deleted_at) is the intended path for those households.
-- Multi-owner households can be hard-deleted only if the acting owner is not
-- the sole remaining active owner. CASCADE will remove all member rows.
--
-- Coordinator note: if the UX requires single-owner hard-delete, this policy
-- should be replaced with is_household_owner(id) alone and last-owner protection
-- is only needed at the household_members level. Documenting here for review.
CREATE POLICY households_delete
  ON public.households
  FOR DELETE
  USING (
    public.is_household_owner(id)
    AND public.has_active_other_owner(id, auth.uid())
  );

COMMENT ON POLICY households_delete ON public.households IS
  'Hard-delete requires owner role AND at least one other active owner. In
   single-owner households, hard-delete is blocked — use deleted_at for soft-delete
   instead. CASCADE on household_members, cooked.*, etc. fires automatically.
   Coordinator: see migration header note if single-owner hard-delete is needed.';

-- ============================================================
-- SECTION 12: cooked table policies — add authenticated writer access
--
-- The existing cooked-table policies (20260430140300) gate SELECT on
-- is_household_member and INSERT/UPDATE on service_role. service_role
-- bypasses RLS by default in Supabase (FORCE ROW LEVEL SECURITY is not set),
-- so the service_role policies are there for defense-in-depth.
--
-- This migration drops the existing INSERT/UPDATE policies and recreates them
-- to also allow authenticated owner/member writes (e.g., manual corrections).
-- service_role retain access via bypass (and explicit policy for FORCE-RLS safety).
--
-- NOTE: raw.* and compute.* remain service-role-only (no RLS added).
--
-- Tables: cooked.dashboard_summary, cooked.position_history, cooked.daily_performance
-- ============================================================

-- ── cooked.dashboard_summary ────────────────────────────────
DROP POLICY IF EXISTS dashboard_summary_select ON cooked.dashboard_summary;
DROP POLICY IF EXISTS dashboard_summary_insert ON cooked.dashboard_summary;
DROP POLICY IF EXISTS dashboard_summary_update ON cooked.dashboard_summary;
DROP POLICY IF EXISTS dashboard_summary_delete ON cooked.dashboard_summary;

CREATE POLICY dashboard_summary_select
  ON cooked.dashboard_summary
  FOR SELECT TO authenticated
  USING (public.is_household_member(household_id));

COMMENT ON POLICY dashboard_summary_select ON cooked.dashboard_summary IS
  'Any active household member (owner, member, viewer) may read dashboard summaries.
   Viewers are included because dashboard data is read-only for them by design.';

CREATE POLICY dashboard_summary_insert
  ON cooked.dashboard_summary
  FOR INSERT TO authenticated
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY dashboard_summary_insert ON cooked.dashboard_summary IS
  'Only owners and members may insert dashboard summary rows (viewer role blocked).
   Compute-worker inserts run under service_role which bypasses this policy.';

CREATE POLICY dashboard_summary_update
  ON cooked.dashboard_summary
  FOR UPDATE TO authenticated
  USING    (public.is_household_writer(household_id))
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY dashboard_summary_update ON cooked.dashboard_summary IS
  'Only owners and members may update dashboard summary rows (viewer role blocked).';

CREATE POLICY dashboard_summary_delete
  ON cooked.dashboard_summary
  FOR DELETE TO authenticated
  USING (public.is_household_writer(household_id));

COMMENT ON POLICY dashboard_summary_delete ON cooked.dashboard_summary IS
  'Only owners and members may delete dashboard summary rows (viewer role blocked).';

-- service_role write policies for defense-in-depth (FORCE RLS safety)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'cooked' AND tablename = 'dashboard_summary'
      AND policyname = 'dashboard_summary_service_write'
  ) THEN
    CREATE POLICY dashboard_summary_service_write
      ON cooked.dashboard_summary
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON POLICY dashboard_summary_service_write ON cooked.dashboard_summary IS
  'service_role full-access policy. service_role bypasses RLS by default in Supabase
   but this policy ensures access is maintained if FORCE ROW LEVEL SECURITY is set.';

-- ── cooked.position_history ─────────────────────────────────
DROP POLICY IF EXISTS position_history_select ON cooked.position_history;
DROP POLICY IF EXISTS position_history_insert ON cooked.position_history;
DROP POLICY IF EXISTS position_history_update ON cooked.position_history;
DROP POLICY IF EXISTS position_history_delete ON cooked.position_history;

CREATE POLICY position_history_select
  ON cooked.position_history
  FOR SELECT TO authenticated
  USING (public.is_household_member(household_id));

COMMENT ON POLICY position_history_select ON cooked.position_history IS
  'Any active household member (owner, member, viewer) may read position history.';

CREATE POLICY position_history_insert
  ON cooked.position_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY position_history_insert ON cooked.position_history IS
  'Only owners and members may insert position history rows.';

CREATE POLICY position_history_update
  ON cooked.position_history
  FOR UPDATE TO authenticated
  USING    (public.is_household_writer(household_id))
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY position_history_update ON cooked.position_history IS
  'Only owners and members may update position history rows.';

CREATE POLICY position_history_delete
  ON cooked.position_history
  FOR DELETE TO authenticated
  USING (public.is_household_writer(household_id));

COMMENT ON POLICY position_history_delete ON cooked.position_history IS
  'Only owners and members may delete position history rows.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'cooked' AND tablename = 'position_history'
      AND policyname = 'position_history_service_write'
  ) THEN
    CREATE POLICY position_history_service_write
      ON cooked.position_history
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON POLICY position_history_service_write ON cooked.position_history IS
  'service_role full-access policy for FORCE ROW LEVEL SECURITY safety.';

-- ── cooked.daily_performance ────────────────────────────────
DROP POLICY IF EXISTS daily_performance_select ON cooked.daily_performance;
DROP POLICY IF EXISTS daily_performance_insert ON cooked.daily_performance;
DROP POLICY IF EXISTS daily_performance_update ON cooked.daily_performance;
DROP POLICY IF EXISTS daily_performance_delete ON cooked.daily_performance;

CREATE POLICY daily_performance_select
  ON cooked.daily_performance
  FOR SELECT TO authenticated
  USING (public.is_household_member(household_id));

COMMENT ON POLICY daily_performance_select ON cooked.daily_performance IS
  'Any active household member (owner, member, viewer) may read daily performance.';

CREATE POLICY daily_performance_insert
  ON cooked.daily_performance
  FOR INSERT TO authenticated
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY daily_performance_insert ON cooked.daily_performance IS
  'Only owners and members may insert daily performance rows.';

CREATE POLICY daily_performance_update
  ON cooked.daily_performance
  FOR UPDATE TO authenticated
  USING    (public.is_household_writer(household_id))
  WITH CHECK (public.is_household_writer(household_id));

COMMENT ON POLICY daily_performance_update ON cooked.daily_performance IS
  'Only owners and members may update daily performance rows.';

CREATE POLICY daily_performance_delete
  ON cooked.daily_performance
  FOR DELETE TO authenticated
  USING (public.is_household_writer(household_id));

COMMENT ON POLICY daily_performance_delete ON cooked.daily_performance IS
  'Only owners and members may delete daily performance rows.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'cooked' AND tablename = 'daily_performance'
      AND policyname = 'daily_performance_service_write'
  ) THEN
    CREATE POLICY daily_performance_service_write
      ON cooked.daily_performance
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON POLICY daily_performance_service_write ON cooked.daily_performance IS
  'service_role full-access policy for FORCE ROW LEVEL SECURITY safety.';

-- ============================================================
-- End of migration 20260430150000_sharing_rls_policies
-- Coordinator: sequence after McManus baseline (20260430140300) lands.
-- Do NOT apply to live until RLS integration tests pass in local Docker.
-- ============================================================
