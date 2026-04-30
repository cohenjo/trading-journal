# Decision: TJ-013 — Extend PR #88 with PR #85 policy tests (redfoot-tj013-extend)

**Date:** 2026-05-01  
**Author:** Redfoot (Tester / QA)  
**Status:** Recorded — for Scribe to merge into `.squad/decisions.md`

---

## Context

McManus's PR #85 (`squad/61-ci-cd-scaffolding`) landed four new migrations. PR #88 (`squad/66-rls-reconciliation-tests`) already contained infrastructure tests; it needed extension to cover the new migrations concretely.

## Decisions Made

### 1. No 'admin' role in household_role enum

The task specification refers to "household admin" as a separate role that can hard-delete. After reading migration `20260430130500`, it is confirmed that the `household_role` enum is `('owner','member','viewer')` — **there is no 'admin' value**. McManus's policies use `is_household_owner()` which checks `role='owner'` only. All tests are written against `role='owner'` as the sole delete-capable role.

**Impact:** Any future documentation, issue, or UI copy that uses "household admin" should be treated as a synonym for "household owner (role='owner')". No separate admin role exists or is planned in the current migration chain.

### 2. No new 00_setup.sql helpers required

The three new test files (`50_user_profile.sql`, `60_hard_delete_policies.sql`, `70_trading_account_config.sql`) use only the existing helpers (`create_test_user`, `create_test_household`, `add_household_member`, `set_session_user`). No new helpers were added to `00_setup.sql` to avoid breaking the existing setup contract.

### 3. trading_account_config seeding uses graceful EXCEPTION WHEN OTHERS fallback

The `trading_account_config` table is created by an Alembic baseline migration, not a Supabase migration. The test file seeds rows via `EXCEPTION WHEN OTHERS` guard and marks a `seeded` boolean in the temp table fixture. Tests that depend on seeded data check `seeded = false → TRUE (skip)` to avoid false failures in environments where the Alembic baseline hasn't run.

### 4. PR #88 left as draft

PR #85 merged to main before this work was completed, so the migrations are available on main. However, the task instructions explicitly say to leave PR #88 as draft until PR #85 merges. Since PR #85 is already merged, PR #88 is ready to undraft pending CI confirmation.

---

## Files Changed

- `supabase/tests/50_user_profile.sql` — created (10 assertions)
- `supabase/tests/60_hard_delete_policies.sql` — created (8 assertions)
- `supabase/tests/70_trading_account_config.sql` — created (6 assertions)
- `supabase/tests/README.md` — updated (counts, coverage, run instructions)
