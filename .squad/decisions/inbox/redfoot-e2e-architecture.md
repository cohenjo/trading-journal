# Decision: E2E Test Architecture — Tiered Structure, Throwaway Users, BASE_URL Targeting

**Author:** Redfoot (Tester)  
**Date:** 2025-07-25  
**Status:** Accepted — implemented in apps/frontend/e2e/  
**Related:** PR for Playwright smoke scaffolding (this round)

---

## Context

We are standing up a Playwright E2E suite against the dev Supabase environment. The app stack is Next.js 15 (App Router) + Supabase Auth (`@supabase/ssr`). The frontend has an existing `tests/` Playwright suite for integration tests against localhost; we needed a new `e2e/` tier structure without breaking the existing suite.

---

## Decision 1: Tiered Directory Structure

```
e2e/smoke/    — P0: unauthenticated page render checks. No seeding needed.
e2e/auth/     — P1: login/logout flows. Requires real dev Supabase.
e2e/flows/    — P1: critical user journeys. Filled per Fenster's page audit.
e2e/rls/      — P2: data isolation. Cross-references pgTAP RLS tests (PR #88).
```

**Why:** Separating by auth requirement and risk tier enables CI to run only smoke+auth on every PR (cheap, fast, no seeding) while flows+rls run on schedule or on-demand. The rls/ tier is the browser-surface counterpart to the pgTAP DB-layer tests I wrote in PR #88 — they test the same invariants through different surfaces.

---

## Decision 2: `testMatch` Over `testDir` Migration

`playwright.config.ts` uses `testMatch: ['tests/**/*.spec.ts', 'e2e/**/*.spec.ts']` instead of changing `testDir`.

**Why:** Migrating the existing `tests/` specs into `e2e/` would require a coordinated PR with all team members. Expanding `testMatch` is backwards-compatible and non-breaking. Migration can happen in a dedicated cleanup PR.

---

## Decision 3: `BASE_URL` as Canonical Targeting Mechanism

```
BASE_URL=http://localhost:3000          (default — local)
BASE_URL=https://<vercel-preview>.app   (CI / dev deployment)
```

Legacy `PLAYWRIGHT_BASE_URL` preserved for backwards compat (existing CI configs may use it).  
`DEV_BASE_URL` can be set in `.env.local` so `npm run test:e2e:dev` works without typing the URL each time.

**Why:** Consistent with how the team targets environments (Kujan's runbook uses `BASE_URL`). The `PLAYWRIGHT_BASE_URL` variable was already in the config but had no legacy users — safe to keep as alias.

---

## Decision 4: Throwaway User Pattern

All e2e users follow: `e2e_<unix-ms>_<4char-rand>@example.com`

- Created via `auth.admin.createUser` with `email_confirm: true` (skips email OTP)
- Deleted in `afterAll` by the fixture
- Cleanup script `e2e/scripts/cleanup-stale-users.ts` deletes any `e2e_*` user older than 1h (orphan guard)
- Password is a strong constant: `E2eTestPass123!` — secure enough for throwaway test accounts

**Why:** Magic-link auth requires receiving an email, which is impractical in headless CI. Creating confirmed users with passwords allows deterministic sign-in. The prefix `e2e_` makes cleanup queryable without touching real users.

---

## Decision 5: Service-Role Client Location

`e2e/fixtures/admin.ts` is the **only** place the service-role key is used.  
It exports helper functions; it is never imported by app source code.

**Prod guard:** The client constructor checks the Supabase URL's ref slug for dev/staging hints (`dev`, `stag`, `test`, `local`, `preview`, `sandbox`). If none match, it throws unless `SUPABASE_E2E_ALLOW_PROD=true` is explicitly set.

**Why:** Service-role bypasses RLS. Containing it in a single well-guarded file reduces the blast radius if a developer accidentally imports it in app code (TypeScript path isolation + the explicit guard message make the mistake visible immediately).

---

## Decision 6: Auth Fixture Sign-In Mechanism

`auth.ts` uses `page.evaluate()` to import and call supabase-js inside the Playwright browser context (via `esm.sh` CDN). This sets cookies in the browser jar that the `@supabase/ssr` middleware reads.

**Alternative considered:** Using Playwright's `storageState` / cookie injection directly. Rejected because: Supabase's SSR cookies involve a multi-cookie structure (`sb-<ref>-auth-token`, `sb-<ref>-auth-token.0`, etc.) that is version-dependent. Letting supabase-js set them via normal sign-in is more stable.

**Note:** `esm.sh` CDN access requires the test environment to have internet access. For fully offline CI, this can be replaced with a bundled import from `node_modules` — tracked as a future improvement.

---

## Impact on Other Team Members

- **Kujan (Infra):** Needs to confirm `DEV_BASE_URL` and add `SUPABASE_SERVICE_ROLE_KEY` to the dev secrets store. The `e2e/README.md` env setup section lists what's needed.
- **Fenster (Designer):** `e2e/flows/` directory is placeholder; will be populated from `docs/design-hosting/page-audit.md` output.
- **Hockney (Backend):** `healthcheck.spec.ts` gracefully skips if `/health/auth` returns 404, but will fully test it once PR #89 is deployed.
