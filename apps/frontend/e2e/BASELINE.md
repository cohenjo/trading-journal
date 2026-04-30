# E2E Smoke Baseline — 2026-07-25

**Branch:** main (commit 870d3d1)  
**Runner:** Chromium (local dev server http://localhost:3000)  
**Supabase target:** dev project (ref: zvbwgxdgxwgduhhzdwjj)  
**Auth guard status:** NOT YET SHIPPED (Fenster's `squad/auth-guard-jwt-forwarding` PR pending)  

---

## Summary

| Status | Count |
|--------|-------|
| ✅ PASS | 7 |
| ❌ FAIL | 3 |
| **Total** | **10** |

> 7/10 passing is the expected baseline for `main` **without** Fenster's auth-guard PR.
> Once that PR lands, all 10 tests should pass without any changes to the test files.

---

## Test Results

### `e2e/smoke/healthcheck.spec.ts` (3/3 PASS)

| # | Test | Result | Note |
|---|------|--------|------|
| 1 | Next.js app serves HTML on `/` | ✅ PASS | — |
| 2 | no critical JS errors on initial page load | ✅ PASS | — |
| 3 | static assets load without 4xx errors | ✅ PASS | — |

### `e2e/smoke/home.spec.ts` (3/3 PASS)

| # | Test | Result | Note |
|---|------|--------|------|
| 4 | GET `/` redirects to `/summary` | ✅ PASS | Static redirect working correctly |
| 5 | GET `/` does not return 5xx | ✅ PASS | — |
| 6 | `/summary` page contains stacked income chart heading | ✅ PASS | — |

### `e2e/smoke/settings.spec.ts` (1/2 PASS)

| # | Test | Result | Note |
|---|------|--------|------|
| 7 | unauthenticated GET `/settings` redirects away from `/settings` | ❌ FAIL | No auth guard on main — page renders at `/settings` instead of redirecting. Will PASS once Fenster's auth-guard PR lands. |
| 8 | unauthenticated GET `/settings` does not render the planning mode toggle | ✅ PASS | Passes accidentally — `[data-testid="planning-mode-toggle"]` selector returns 0 matches because the attribute is not yet on the component. ⚠️ Selector fragility: once the toggle gets a `data-testid`, this test will need the auth guard to be meaningful. |

### `e2e/smoke/holdings.spec.ts` (0/2 PASS)

| # | Test | Result | Note |
|---|------|--------|------|
| 9 | unauthenticated GET `/holdings` redirects away from `/holdings` | ❌ FAIL | No auth guard on main — page renders at `/holdings`. Error: `expect(page).not.toHaveURL(/\/holdings/)` — URL is `http://localhost:3000/holdings`. Will PASS once Fenster's auth-guard PR lands. |
| 10 | unauthenticated GET `/holdings` does not render holdings table | ❌ FAIL | Holdings table IS rendered without auth check. Error: `expect(locator('table')).toHaveCount(0)` — received 1. Will PASS once auth guard redirects unauthenticated users. |

---

## Known Issues / Selector Fragility

1. **`settings.spec.ts` test #8** — "planning mode toggle" check uses `[data-testid="planning-mode-toggle"]`. This selector does not yet exist in the component. The test passes for the wrong reason. Once the component gains the `data-testid`, the test will start failing unless the auth guard is in place. **Action:** add `data-testid="planning-mode-toggle"` to the Settings component simultaneously with the auth guard.

2. **`home.spec.ts` test #6** — `/summary` chart heading check uses `body` non-empty assertion (intentionally broad). The chart renders an empty state when no seed data exists. Tighten selector to a specific heading text once the exact heading copy is confirmed in production.

3. **Flow tests** (`e2e/flows/`) — not run in this baseline. All flow tests use the `authenticatedUser` fixture which requires:
   - `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
   - Fenster's auth-guard PR to be landed (so sign-in redirects correctly gate the pages)
   - Backend FastAPI running to serve data

---

## What to Expect After Fenster's PR

Once `squad/auth-guard-jwt-forwarding` merges to main:

| Test | Before (this baseline) | After |
|------|------------------------|-------|
| `/settings` redirect | ❌ FAIL | ✅ PASS |
| `/holdings` redirect | ❌ FAIL | ✅ PASS |
| `/holdings` no table | ❌ FAIL | ✅ PASS |
| All others | ✅ PASS | ✅ PASS |

**No test code changes needed** — the tests are written to assert the post-auth-guard behavior.

---

## Flow Test Scaffold Status

| Spec | Route | Compile | Ready to Run |
|------|-------|---------|--------------|
| `e2e/flows/root.spec.ts` | `/` → `/summary` | ✅ | ⚠️ Needs Fenster PR + seed data |
| `e2e/flows/current-finances.spec.ts` | `/current-finances` | ✅ | ⚠️ Needs Fenster PR + seed data |
| `e2e/flows/plan.spec.ts` | `/plan` | ✅ | ⚠️ Needs Fenster PR + seed data |
| `e2e/flows/summary.spec.ts` | `/summary` | ✅ | ⚠️ Needs Fenster PR + seed data |
