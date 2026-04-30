# E2E Test Suite — Trading Journal Frontend

## Quick Start

```bash
# Local dev server (must be running separately)
cd apps/frontend && npm run test:e2e

# Against a deployed Vercel preview / dev URL
BASE_URL=https://trading-journal-git-main-cohenjos-projects.vercel.app npm run test:e2e:dev

# Headed browser (debug / watch mode)
npm run test:e2e -- --headed

# Single spec
npm run test:e2e -- e2e/smoke/home.spec.ts

# Clean up stale e2e test users from dev Supabase (older than 1h)
npm run test:e2e:cleanup
```

---

## Directory Structure

```
e2e/
├── README.md               ← you are here
├── smoke/                  ← P0: page renders, no auth required
│   ├── home.spec.ts
│   ├── settings.spec.ts
│   ├── holdings.spec.ts
│   └── healthcheck.spec.ts
├── auth/                   ← P1: login + logout flow against dev Supabase
│   └── (next round — after Kujan confirms env boots)
├── flows/                  ← P1: critical user flows
│   └── (next round — after Fenster's page audit lands in docs/design-hosting/page-audit.md)
├── rls/                    ← P2: data isolation tests
│   └── (next round — maps to pgTAP tests in supabase/tests/)
├── fixtures/
│   ├── admin.ts            ← Supabase service-role admin client (server-only)
│   └── auth.ts             ← authenticatedUser + householdOwner Playwright fixtures
└── scripts/
    └── cleanup-stale-users.ts  ← delete e2e_* users older than 1h
```

---

## Tier Definitions

### `smoke/` — P0
**Goal:** every named page returns a visible DOM with no JS console errors and no 5xx responses.
No authentication. No data seeding. Just proves the app can boot and render.

Run in CI on every PR.

### `auth/` — P1
**Goal:** login and logout flows work against a real dev Supabase project.
Uses the `authenticatedUser` fixture (email+password, throwaway user).
Verifies session cookies are set, protected routes resolve, and logout clears state.

_Pending implementation — round 2._

### `flows/` — P1
**Goal:** critical user journeys end-to-end.
Examples (provisional — confirmed after Fenster's audit):
- Create a trading account
- Upload holdings CSV
- View portfolio summary
- Add a pension
- Run backtest scenario

_Pending Fenster's `docs/design-hosting/page-audit.md` output._

### `rls/` — P2
**Goal:** data-isolation guarantees. User A cannot read User B's rows.
Household sharing roles are enforced at the DB layer (verified via RLS pgTAP tests in `supabase/tests/`).
These E2E tests verify the same invariants through the browser + API surface.

_Pending round 2 — cross-references pgTAP suites written in PR #88._

---

## Targeting: BASE_URL

The `playwright.config.ts` reads `process.env.BASE_URL` (or fallback `PLAYWRIGHT_BASE_URL`):

| Target            | Command                                                                     |
|-------------------|-----------------------------------------------------------------------------|
| Local dev server  | `npm run test:e2e` (defaults to `http://localhost:3000`)                    |
| Dev/Preview URL   | `BASE_URL=https://<url> npm run test:e2e:dev`                               |
| CI / GitHub Actions | Set `BASE_URL` secret; use `npm run test:e2e`                             |

The `DEV_BASE_URL` env var can be set in `.env.local` so `npm run test:e2e:dev`
picks it up automatically without passing it on the command line.

---

## Fixtures

### `fixtures/admin.ts` — service-role admin client

Wraps `@supabase/supabase-js` with the `service_role` key.
**Only used in test fixtures, never in app code.**
Guards against accidental prod use: throws if `NEXT_PUBLIC_SUPABASE_URL`
looks like a production Supabase project (no `local`, `dev`, or `staging` in the ref slug).

Reads from env:
- `NEXT_PUBLIC_SUPABASE_URL` — shared with the app
- `SUPABASE_SERVICE_ROLE_KEY` — test-only; **never prefix with NEXT_PUBLIC_**

### `fixtures/auth.ts` — Playwright fixtures

Exports two custom fixtures:

**`authenticatedUser`** — creates a throwaway Supabase user, signs in via the
browser login flow, and returns `{ page, user }`. Tears down (deletes user)
after the test.

**`householdOwner`** — builds on `authenticatedUser`; additionally creates a
household and membership row via the admin API, then returns `{ page, user, householdId }`.

---

## Test Data Hygiene

All e2e users follow the pattern:
```
e2e_<unix-ms>_<4-char-rand>@example.com
```

Example: `e2e_1735000000000_a3f7@example.com`

- Unique per test run → parallel runs never collide
- Prefixed `e2e_*` so the cleanup script can find them
- Deleted in `afterAll` by the fixture's teardown
- Backup: `npm run test:e2e:cleanup` deletes any `e2e_*` user older than 1 hour
  (catches orphans from crashed test runs)

---

## CI Shape (future)

Planned: `.github/workflows/playwright-e2e.yml`

Triggers:
- `pull_request` — smoke + auth tiers only
- `workflow_dispatch` — full suite including flows + rls

Requirements:
- `BASE_URL` secret → deployed Vercel preview URL (or `VERCEL_PREVIEW_URL` computed by the workflow)
- `NEXT_PUBLIC_SUPABASE_URL` secret → dev Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` secret
- `SUPABASE_SERVICE_ROLE_KEY` secret → service-role key for fixture setup/teardown

Steps:
1. Install deps (`npm ci`)
2. Install Playwright browsers (`npx playwright install --with-deps chromium`)
3. Run `npm run test:e2e` with appropriate `BASE_URL`
4. Upload `playwright-report/` and `test-results/` as artifacts on failure

---

## Environment Setup for Local Dev

Copy `.env.local.example` → `.env.local` and fill in:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<dev-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Test-only — never expose to browser
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Set this to run test:e2e:dev without specifying BASE_URL each time
DEV_BASE_URL=https://trading-journal-git-main-cohenjos-projects.vercel.app
```
