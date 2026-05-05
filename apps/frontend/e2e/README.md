# E2E Test Suite — Trading Journal Frontend

## Quick Start

```bash
# Local dev server (must be running separately)
cd apps/frontend && npm run test:e2e

# Run only smoke tests (no auth required — fast)
npm run test:e2e:smoke

# Run only flow tests (requires Supabase env)
npm run test:e2e:flows

# Run only auth tests (requires Supabase env)
npm run test:e2e:auth

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
│   ├── root.spec.ts
│   ├── current-finances.spec.ts
│   ├── plan.spec.ts
│   └── summary.spec.ts
├── rls/                    ← P2: data isolation tests
│   └── (next round — maps to pgTAP tests in supabase/tests/)
├── fixtures/
│   ├── admin.ts            ← Supabase service-role admin client (server-only)
│   ├── auth-cookie.ts      ← cookie-injection auth fixture (preferred)
│   ├── test-user.ts        ← unified fixture: user + household provisioning (issue #144)
│   └── seed-data.ts        ← per-test data seeding helpers (issue #144)
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

### `fixtures/auth-cookie.ts` — preferred auth fixture (cookie injection)

Directly calls the Supabase REST password-grant endpoint, builds the
`@supabase/ssr` cookie format, and injects it into the browser context.
This is more reliable than the CDN-based `auth.ts` fixture because it
sets cookies correctly for the Next.js SSR middleware.

### `fixtures/test-user.ts` — unified user + household fixture (issue #144)

The canonical fixture for tests that need a fully provisioned user.

**What it does:**
1. Creates a throwaway Supabase user via admin API.
2. Injects auth cookie using the `auth-cookie.ts` pattern.
3. Polls `household_members` until the auto-provision trigger fires (≤5s timeout).
4. Returns `{ page, userId, email, householdId }`.
5. Tears down (deletes user → cascades household data) in afterAll.

**Usage:**
```typescript
import { test } from '../fixtures/test-user';

test('my auth flow @auth', async ({ testUser: { page, householdId } }) => {
  await page.goto('/current-finances');
  // householdId available for seeding via seed-data.ts helpers
});
```

### `fixtures/seed-data.ts` — per-test data seeding (issue #144)

Data seeding helpers scoped to a household. All helpers use the admin client (bypass RLS).

| Helper | Table | Description |
|--------|-------|-------------|
| `seedFund(householdId, data)` | `finance_snapshots` | Inserts an Investments-category FinanceItem |
| `seedAsset(householdId, data)` | `finance_snapshots` | Inserts an Assets-category FinanceItem |
| `seedTrade(householdId, data)` | `public.trade` | Inserts an IB Flex-format trade row |
| `cleanupHouseholdData(householdId)` | multiple | Deletes all seeded rows for the household |

**Usage:**
```typescript
import { test } from '../fixtures/test-user';
import { seedFund, seedTrade, cleanupHouseholdData } from '../fixtures/seed-data';

test.describe('holdings flow', () => {
  let householdId: string;

  test.beforeEach(async ({ testUser }) => {
    householdId = testUser.householdId;
    await seedFund(householdId, { name: 'S&P 500 ETF', value: 50_000 });
    await seedTrade(householdId, { symbol: 'SPY', side: 'BUY', quantity: 10, price: 500 });
  });

  test.afterEach(async () => {
    await cleanupHouseholdData(householdId);
  });

  test('holdings page shows seeded fund @flow', async ({ testUser: { page } }) => {
    await page.goto('/holdings');
    await expect(page.locator('text=S&P 500 ETF')).toBeVisible();
  });
});
```

### `fixtures/auth.ts` — Playwright fixtures (legacy)

Exports two custom fixtures:

**`authenticatedUser`** — creates a throwaway Supabase user, signs in via the
browser login flow, and returns `{ page, user }`. Tears down (deletes user)
after the test. ⚠️ Uses CDN-loaded supabase-js — prefer `auth-cookie.ts` or
`test-user.ts` for new tests.

**`householdOwner`** — builds on `authenticatedUser`; additionally creates a
household and membership row via the admin API, then returns `{ page, user, householdId }`.

---

## Test Tagging Conventions

Tests use inline tags in the test name to enable `--grep` filtering:

| Tag | Tier | Meaning |
|-----|------|---------|
| `@smoke` | P0 | No auth, no seed data — just proves page renders |
| `@auth` | P1 | Requires Supabase auth (uses `testUser` fixture) |
| `@flow` | P1 | End-to-end user flow (requires auth + optional seed data) |
| `@rls` | P2 | Data-isolation / Row Level Security verification |

**Example:**
```typescript
test('user sees only their own trades @rls', async ({ testUser: { page } }) => { ... });
```

**Running tagged subsets:**
```bash
npm run test:e2e:smoke    # --grep @smoke
npm run test:e2e:flows    # --grep @flow
npm run test:e2e:auth     # --grep @auth
```

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

## CI — GitHub Actions

Workflow: `.github/workflows/playwright-e2e.yml`

### Triggers

| Event | Job | Suite |
|-------|-----|-------|
| `pull_request` → `main` | `e2e-smoke` | `@smoke` + `@auth` — **merge-blocking** |
| `schedule` (03:00 UTC nightly) | `e2e-full` | `@smoke` + `@auth` + `@flow` |
| `workflow_dispatch` | `e2e-dispatch` | Configurable (smoke / auth / flows / all) + custom URL input |

Nightly failures automatically open a GitHub issue tagged `e2e-testing`.

### Required GitHub Secrets

Go to **repo → Settings → Secrets and variables → Actions → New repository secret** and add each of the following:

| Secret name | Maps to env var | Description |
|-------------|-----------------|-------------|
| `E2E_BASE_URL` | `BASE_URL` | Target app URL — Vercel dev deployment or preview URL |
| `E2E_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase project URL (e.g. `https://<ref>.supabase.co`) |
| `E2E_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev Supabase anon/publishable key |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | Dev Supabase service-role key — **never expose to browser** |
| `E2E_TEST_USER_EMAIL` | `E2E_TEST_USER_EMAIL` | Pre-seeded test user email (for deterministic auth flows) |
| `E2E_TEST_USER_PASSWORD` | `E2E_TEST_USER_PASSWORD` | Pre-seeded test user password |

> ⚠️ All secrets must use the **dev** Supabase project — never production.
> `E2E_SUPABASE_SERVICE_ROLE_KEY` bypasses RLS; treat it as you would a root DB password.

### Artifact retention

| Artifact | Trigger | Retention |
|----------|---------|-----------|
| `playwright-report-*` | On failure only | 14 days |
| `test-results-*` (traces + screenshots) | Always | 7 days |

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
