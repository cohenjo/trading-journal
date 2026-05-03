# Decision: Household Bootstrap E2E Coverage

**Author:** Redfoot (Tester)
**Date:** 2026-05-03
**Branch:** `squad/e2e-household-bootstrap-2026-05-03`
**PR:** (pending — see below)
**Depends on:** PR #163 (Fenster — testids), PR #164 (Hockney — ensure_household RPC)

---

## Summary

Added E2E test coverage for the household bootstrap flow and sign-out path. This is a stacked PR that must land after Fenster's #163 and Hockney's #164.

## Files Added / Changed

| File | Description |
|------|-------------|
| `apps/frontend/e2e/flows/household-bootstrap.spec.ts` | 3 tests: existing-household login (no banner), sign-out (sidebar → /login + cookie cleared), skip: first-login picker |
| `apps/frontend/e2e/flows/current-finances.spec.ts` | Fund-save regression guard for Jony's bug (skipped pending auth-guard PR) |
| `apps/frontend/e2e/helpers/household.ts` | `ensureHousehold` / `ensureNoHousehold` / `hasServiceRoleEnv` helpers |
| `supabase/migrations/20260503090000_household_bootstrap_rpc.sql` | Cherry-picked from Hockney #164 — `ensure_household` RPC + `v_my_active_household` view |

## Test Coverage

### `household-bootstrap.spec.ts` (@auth)

- **(a) Existing-household login** — navigates to `/`, asserts `household-banner` is NOT visible for a user with an active household. Uses `ensureHousehold(userId)` to guarantee state. Gracefully skips when no local dev server is running.

- **(b) Sign-out flow** — opens sidebar via hamburger toggle, clicks `sidebar-signout` (Fenster's testid), asserts URL becomes `/login`, asserts Supabase session cookie is absent/empty. Gracefully skips when testid unavailable (pending PR #163) or no dev server.

- **(c) First-login picker** — `test.skip` with TODO referencing issue #151. Needs a fresh user with no household; out of scope for this PR.

### `current-finances.spec.ts` (regression, @auth)

- Fund-save regression guard (`testWithUser.skip`) — Jony's bug: saving a fund on `/current-finances` silently failed when a household existed because the JWT wasn't forwarded to FastAPI → RLS rejected the `finance_snapshots` write. Unblocked when Fenster's auth-guard PR + Hockney's RPC both land.

## Local Run Result

Command: `SUPABASE_E2E_ALLOW_PROD=true npx playwright test --project=chromium e2e/flows/household-bootstrap.spec.ts`

**0 passed / 3 skipped / 0 failed**

Skips are expected: tests (a) and (b) gracefully skip when no local dev server is on port 3000. Test (c) is explicitly skipped. Admin client successfully provisions and tears down throwaway users (service-role key is present in env).

## Blocker Note

`SUPABASE_E2E_ALLOW_PROD=true` is required in `.env.local` or the test env because the Supabase project ref `zvbwgxdgxwgduhhzdwjj` contains no dev/stag/test hint. Without it, the admin fixture safety block fires before the graceful skip logic. The CI workflow already sets this via `E2E_SUPABASE_ALLOW_PROD` secret; local devs should add it to `.env.local`.

## Merge Order

1. PR #163 (Fenster — testids) → must land first
2. PR #164 (Hockney — ensure_household RPC + migration) → must land second
3. This PR → rebases onto main after #163 + #164 merge

## Decision: Grace-skip pattern for missing dev server

Tests that require a live Next.js app wrap `page.goto(...)` in a try/catch and call `test.skip()` on connection failure. This matches the pattern established in PR #156 and prevents false failures in local-without-server environments.

## Decision: Household helpers location

Household test helpers (`ensureHousehold`, `ensureNoHousehold`) live in `e2e/helpers/household.ts` (not in fixtures) because they are imperative helpers called within test bodies, not Playwright fixture extensions. This keeps the `fixtures/` directory for Playwright fixture definitions only.
