# Decision: sharing RLS policy tradeoffs (TJ-022)
**Author:** Rabin  
**Date:** 2026-04-30  
**PR:** #92  

## search_path convention
All SECURITY DEFINER functions in this migration use `SET search_path = public, pg_temp`. Design.md §5 shows `SET search_path = public` (without pg_temp). This migration uses the stricter variant to prevent temp-table injection; coordinator should confirm alignment with canonical helper pattern.

## Household hard-delete policy
`households_delete` requires `has_active_other_owner` — single-owner households cannot be hard-deleted via authenticated RLS. Owners should use soft-delete (`deleted_at`) instead. If single-owner hard-delete is required, replace policy with `is_household_owner(id)` only.

## cooked table write access
Existing design specified service_role-only writes on cooked tables (compute worker). TJ-022 spec adds `is_household_writer` authenticated policies. Both now coexist: service_role bypasses RLS by default; explicit service_role policies retained for FORCE-RLS safety. If cooked tables should remain worker-only, remove the authenticated writer policies.

## Trigger firing order
`trg_household_members_bump_version` fires before `trg_household_members_guard` (alphabetical order). This is safe: if the guard raises P0001, the transaction aborts and the version bump is discarded. No correctness impact.
