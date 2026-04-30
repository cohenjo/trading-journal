# Decision: First Household Migration Schema Choices

**Author:** Rabin (Security Engineer)  
**Date:** 2026-04-30  
**Scope:** `supabase/migrations/` — TJ-005 batch  
**Status:** Proposed — pending `supabase db reset` validation

---

## Context

Turning runbook §4–§5 SQL into three discrete migration files required resolving several design questions not explicitly settled in either the runbook or the data-architecture doc.

---

## Decisions

### 1. ON DELETE CASCADE on both FK refs

`household_members.household_id → households(id) ON DELETE CASCADE` and `household_members.user_id → auth.users(id) ON DELETE CASCADE` ensure orphan rows are automatically cleaned when a household or Supabase auth user is hard-deleted. The alternative (RESTRICT) would require application-layer cleanup before deletion, which is error-prone in an invite/membership flow.

`households.created_by → auth.users(id) ON DELETE RESTRICT` — the owning household row should survive until explicitly soft-deleted; blocking hard user deletion prevents accidental household orphaning.

### 2. Role enum values: `('owner', 'member', 'viewer')`

Matches the runbook verbatim. `owner` can invite/kick; `member` can write; `viewer` is read-only. The enum is named `public.household_role` (runbook) rather than `public.household_member_role` (data-architecture §06) — the runbook is the canonical SQL source for this migration batch. A future migration can rename if the team standardises on the longer form.

### 3. security definer rationale for helper functions

`is_household_member` and `is_household_owner` are marked `SECURITY DEFINER` so they execute under the function owner's privileges (postgres/service role), not the calling user's. This is required because RLS policies on `household_members` would otherwise create a circular dependency: evaluating the policy requires querying the table, which is itself protected by RLS. `SET search_path = public, auth` is set explicitly on both functions to prevent search-path injection — a standard Postgres hardening practice for security-definer functions.

### 4. Hard-delete policies use `using (false)` not owner-only

The task spec said "DELETE policy (owner only)" for households and household_members. The runbook §5 explicitly chose `using (false)` to enforce soft-delete discipline (`deleted_at` / `left_at` columns). This is the stronger security posture — it prevents data loss from accidental hard-deletes through the client key entirely. Deviation is documented in `supabase/migrations/README.md`.

### 5. `invited_by` and `left_at` columns on `household_members`

Added from the runbook. `left_at` enables audit trails without losing membership history. `invited_by` supports future invite-flow attribution. Both are nullable — existing rows (creator auto-inserted by trigger) set `invited_by = created_by`.

---

## Impact

- McManus (Data/Finance): trade tables in TJ-006 should FK to `public.households(id)` using the same `ON DELETE CASCADE` / `ON DELETE RESTRICT` pattern.  
- Keaton (Infra): `supabase db reset` must succeed locally before the branch is merged; add to CI checklist.  
- All: `SUPABASE_SERVICE_ROLE_KEY` must never appear in `NEXT_PUBLIC_*` env vars — the trigger and helper functions are the only server-side bypass of RLS.
