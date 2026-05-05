# Redfoot R7 — Issue #127: auth.ts → auth-cookie.ts Migration

**Date:** 2026-05-05
**Author:** Redfoot (Tester)
**Issue:** #127
**PR:** #292

## Decision

Delete `apps/frontend/e2e/fixtures/auth.ts` and migrate all importers to
`apps/frontend/e2e/fixtures/auth-cookie.ts`.

## Rationale

`auth.ts` put the Supabase session into `localStorage` via a CDN-loaded client
inside `page.evaluate()`. The Next.js middleware reads from **cookies**
(`@supabase/ssr` format), not localStorage. Result: every test using `auth.ts`
silently redirected to `/login` and reported "pass" on the HTTP 200 response —
never actually exercising the authenticated flow it claimed to test.

`auth-cookie.ts` (added in PR #124 by Fenster) solves this by calling the
Supabase REST password-grant endpoint directly, building the
`sb-{ref}-auth-token` cookie in the exact `@supabase/ssr` format, and
injecting it via `page.context().addCookies()`.

## What Was Done

- Migrated 4 specs in `e2e/flows/`: `root`, `current-finances`, `plan`, `summary`
- Import change: `from '../../e2e/fixtures/auth'` → `from '../fixtures/auth-cookie'`
  (also aligned path to match convention used by `e2e/pages/` specs)
- Deleted `e2e/fixtures/auth.ts` (150 LOC)
- Updated `e2e/README.md`: removed legacy auth.ts tree entry + description

## API Delta

- `auth.ts` `authenticatedUser` returned: `{ page, userId, email, password }`
- `auth-cookie.ts` `authenticatedUser` returns: `{ page, email, userId, accessToken }`
- All 4 migrated specs only destructure `{ page }` — zero additional call-site changes.

## Follow-ups

None filed — no new genuine failures were introduced by the import migration itself.
The `test.fixme` guards already in the spec files cover known infrastructure
blockers (backend not running, seed data not available).

## Notes for Future Agents

- `auth-cookie.ts` uses a hardcoded internal password (`E2eTestPass!1`) — not exposed in fixture shape.
- `auth-cookie.ts` does not have a `householdOwner` fixture. Use `test-user.ts` for tests that need a household.
- Teardown: `auth-cookie.ts` calls `deleteE2eUser()` (best-effort); `test-user.ts` calls `teardownTestUser()` which handles FK cascade. Use `test-user.ts` for tests involving household data.
