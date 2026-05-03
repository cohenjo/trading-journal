# End-to-End Testing Strategy — Trading Journal

**Status:** Approved  
**Author:** Keaton (Lead)  
**Date:** 2026-05-02  
**Requested by:** Jony Vesterman Cohen  
**Architecture ref:** `docs/design-hosting/phase-3-execution-plan.md`

---

## 1. Problem Statement

The app has suffered repeated regressions on save flows — 404 on `/api/finances`, then "No active household found" — caught only by manual testing. We need automated browser-driven tests that exercise real Supabase round-trips so future regressions fail CI, not the user.

## 2. Existing Infrastructure

The project already has a solid E2E scaffold at `apps/frontend/e2e/`:

| Asset | Status | Location |
|-------|--------|----------|
| Playwright config | ✅ Exists | `apps/frontend/playwright.config.ts` |
| Auth fixtures (cookie-based) | ✅ Exists | `e2e/fixtures/auth-cookie.ts` |
| Admin client (service-role) | ✅ Exists | `e2e/fixtures/admin.ts` |
| Cleanup script | ✅ Exists | `e2e/scripts/cleanup-stale-users.ts` |
| Smoke tests (P0) | ✅ 7/10 passing | `e2e/smoke/` |
| Flow tests (P1) | ⚠️ Page-load only | `e2e/flows/` — no CRUD mutation tests |
| Auth tests (P1) | ❌ Stub | `e2e/auth/` — empty |
| RLS tests (P2) | ❌ Stub | `e2e/rls/` — placeholder |
| CI workflow | ❌ Missing | No `.github/workflows/playwright-e2e.yml` |
| Post-deploy hook | ❌ Missing | No Vercel deploy → smoke trigger |

**Strategy:** Extend the existing scaffold — don't rebuild. The test directory stays at `apps/frontend/e2e/` since Playwright config, fixtures, and npm scripts are already wired there.

## 3. Test Environment Strategy

### Recommendation: Hybrid (b) + (c) — Dev Supabase project + Local Supabase

| Environment | Purpose | When |
|---|---|---|
| **Dev Supabase** (`zvbwgxdgxwgduhhzdwjj`) | CI runs, PR smoke, post-deploy verification | PR CI, nightly, post-deploy |
| **Local Supabase** (`supabase start`) | Developer iteration, full suite, offline work | Local dev, pre-push |
| **Production** | Post-deploy smoke only (read-only, dedicated test user) | Post-Vercel-deploy hook |

### Why NOT option (a) — test user in prod?

- **Risk:** Test data in production database; accidental pollution of Jony's household.
- **RLS complexity:** Even with a separate household, RLS policies don't guarantee zero cross-contamination in aggregate queries.
- **Verdict:** Use dev project for all mutation tests. Production only gets a read-only smoke (page loads, no writes).

### Why NOT option (c) alone — local only?

- **Miss:** Doesn't catch prod-only issues like the migration that just shipped (household trigger, RLS policies applied to hosted Supabase but not replicated locally if seeds diverge).
- **Verdict:** Local is fast for dev iteration but CI must hit the real hosted dev Supabase.

### Production smoke (limited scope)

For post-deploy verification, we use `SUPABASE_E2E_ALLOW_PROD=true` with a dedicated test user that:
- Has its own household (isolated)
- Only runs page-load and read assertions (no mutations)
- Is pre-provisioned, not created/deleted per run

## 4. Test-User Lifecycle

### Dev / CI environment

```
┌─ beforeAll ────────────────────────────────────────────────┐
│  1. admin.auth.admin.createUser({ email: e2e_<ts>_<rand>@example.com })  │
│  2. Wait for household provisioning trigger (poll households table)       │
│  3. Sign in via /auth/v1/token → get access+refresh tokens               │
│  4. Inject sb-<ref>-auth-token cookie into Playwright context             │
└────────────────────────────────────────────────────────────┘

┌─ test body ──────────┐
│  Browser interactions │
│  Supabase round-trips │
└──────────────────────┘

┌─ afterAll ─────────────────────────────────────────────────┐
│  1. admin.auth.admin.deleteUser(userId)                                   │
│  2. Cascade deletes household + membership (FK cascade)                   │
│  3. Backup: cleanup script deletes e2e_* users > 1hr old                  │
└────────────────────────────────────────────────────────────┘
```

### Naming convention

```
e2e_<unix-ms>_<4-char-rand>@example.com
```

Parallel-safe, grep-able, auto-cleaned.

### Production smoke user

Pre-provisioned: `e2e-smoke@trading-journal.test` — permanent, never deleted. Its household contains read-only seed data. Credentials stored in GitHub Actions secrets.

## 5. Test Directory Structure

```
apps/frontend/
├── playwright.config.ts          ← already exists
├── e2e/
│   ├── README.md                 ← already exists
│   ├── fixtures/
│   │   ├── admin.ts              ← service-role client (exists)
│   │   ├── auth.ts               ← base auth fixture (exists)
│   │   ├── auth-cookie.ts        ← cookie injection (exists)
│   │   ├── test-user.ts          ← NEW: unified fixture with household wait
│   │   └── seed-data.ts          ← NEW: per-test data seeding helpers
│   ├── smoke/                    ← P0 — page loads, no auth (exists)
│   ├── auth/                     ← P1 — signup, login, household trigger
│   │   └── signup-household.spec.ts  ← NEW
│   ├── flows/                    ← P1 — critical CRUD journeys
│   │   ├── current-finances.spec.ts  ← EXISTS (page-load only → extend)
│   │   ├── trades.spec.ts            ← NEW
│   │   └── plans.spec.ts             ← NEW (if simulation is cheap)
│   ├── rls/                      ← P2 — cross-household isolation
│   ├── pages/                    ← page-level render tests (exists)
│   └── scripts/
│       ├── cleanup-stale-users.ts    ← exists
│       └── seed-test-household.ts    ← NEW: idempotent seed for prod smoke user
```

## 6. Critical User Journeys — Acceptance Criteria

### Journey 1: Auth + Household Provisioning (P0)

**File:** `e2e/auth/signup-household.spec.ts`

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Create user via admin API | User exists in `auth.users` |
| 2 | Wait ≤5s | `households` table has a row where owner = new user |
| 3 | `household_members` has a row linking user → household | Membership role = 'owner' |
| 4 | Sign in via cookie injection | Protected page (`/current-finances`) loads without redirect to `/login` |
| 5 | Refresh page | Session persists (no re-auth required) |

### Journey 2: Current Finances CRUD (P0 — regression target)

**File:** `e2e/flows/current-finances.spec.ts` (extend existing)

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Navigate to `/current-finances` | Page loads, heading visible |
| 2 | Add a Fund snapshot (fill form, submit) | New row appears in the finance list |
| 3 | Add an Asset (fill form, submit) | Asset row appears |
| 4 | Edit the Asset (change value, save) | Updated value visible |
| 5 | Soft-delete the Asset | Row disappears from UI |
| 6 | Refresh page | Fund still visible; deleted Asset gone |
| 7 | Verify via admin client | DB row for deleted asset has `deleted_at IS NOT NULL` |

### Journey 3: Trades Create + List (P1)

**File:** `e2e/flows/trades.spec.ts`

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Navigate to `/trades` | Trades list page loads |
| 2 | Click "Add Trade" / equivalent CTA | Trade creation form appears |
| 3 | Fill trade details (ticker, qty, price, date) | Form accepts input |
| 4 | Submit | New trade appears in list |
| 5 | Navigate to `/summary` dashboard | Trade reflected in summary data |

### Journey 4: Plans Create + Simulate (P2)

**File:** `e2e/flows/plans.spec.ts`

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Navigate to `/plans` | Plans page loads |
| 2 | Create a new plan (fill basic params) | Plan saved, appears in list |
| 3 | Run simulation (if backend available) | Simulation results render |

> Simulation requires the FastAPI backend. If unavailable in CI, skip with `test.skip()` and note in test.

## 7. CI Integration

### GitHub Actions Workflow: `.github/workflows/playwright-e2e.yml`

#### Triggers

| Trigger | Suite | Target |
|---------|-------|--------|
| `pull_request` | Smoke (P0) + Auth (P1) | Dev Supabase + Vercel preview URL |
| `schedule` (nightly, 03:00 UTC) | Full suite (smoke + auth + flows + rls) | Dev Supabase + dev Vercel URL |
| `workflow_dispatch` | Configurable (default: full) | Configurable target URL |
| `deployment_status` (success) | Prod smoke (read-only) | Production Vercel URL |

#### Job Structure

```yaml
jobs:
  e2e-smoke:
    # Always runs — PR gating
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd apps/frontend && npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e -- --grep @smoke
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report-smoke
          path: apps/frontend/playwright-report/

  e2e-flows:
    # Runs on nightly + manual dispatch
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - # Same setup as above
      - run: npm run test:e2e -- --grep @flow
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-traces
          path: apps/frontend/test-results/
          retention-days: 7
```

#### Gating Strategy

- **PR merge blocker:** Smoke suite must pass. Flow suite is informational on PRs (runs nightly).
- **Nightly:** Full suite. Failures create a GitHub issue automatically via `actions/github-script`.
- **Post-deploy:** Prod smoke failures alert via GitHub Actions notification.

### Failure Artifacts

| Artifact | Retention | When |
|----------|-----------|------|
| `playwright-report/` (HTML) | 14 days | Always on failure |
| `test-results/` (traces, screenshots, videos) | 7 days | Always |
| Console logs | In workflow output | Always |

## 8. Secrets & Configuration

### GitHub Actions Secrets (required)

| Secret | Purpose | Scope |
|--------|---------|-------|
| `E2E_SUPABASE_URL` | Dev Supabase project URL | Dev env |
| `E2E_SUPABASE_ANON_KEY` | Dev anon key | Dev env |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | Service-role key for test user CRUD | Dev env |
| `E2E_BASE_URL` | Default Vercel preview URL for CI | Dev env |
| `PROD_SMOKE_EMAIL` | Pre-provisioned prod smoke user email | Prod smoke |
| `PROD_SMOKE_PASSWORD` | Prod smoke user password | Prod smoke |
| `PROD_BASE_URL` | `https://trading-journal-cohenjos-projects.vercel.app` | Prod smoke |

### Local Development

Developers use `apps/frontend/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://zvbwgxdgxwgduhhzdwjj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DEV_BASE_URL=https://trading-journal-git-main-cohenjos-projects.vercel.app
```

## 9. PR vs Nightly Split

| Suite | PR | Nightly | Post-Deploy |
|-------|-----|---------|-------------|
| Smoke (page loads, no auth) | ✅ Blocking | ✅ | ✅ (prod) |
| Auth (signup → household) | ✅ Blocking | ✅ | ❌ |
| Flows (CRUD journeys) | ❌ (too slow) | ✅ Blocking | ❌ |
| RLS (cross-household) | ❌ | ✅ | ❌ |
| Prod smoke (read-only) | ❌ | ❌ | ✅ |

## 10. Tagging Convention

Tests use Playwright's `@tag` annotation for suite selection:

```typescript
test('@smoke @p0 homepage loads', async ({ page }) => { ... });
test('@flow @p0 current-finances add fund', async ({ authenticatedUser }) => { ... });
test('@auth @p1 signup creates household', async ({ page }) => { ... });
test('@rls @p2 cross-household isolation', async ({ authenticatedUser }) => { ... });
```

CI selects suites via `--grep @smoke`, `--grep "@flow|@auth"`, etc.

## 11. Dependency Graph

```
#144 Playwright harness scaffold (squad:redfoot)
 ├── #146 Auth + household smoke test  (depends on #144, #145)
 ├── #147 Current-finances save flow   (depends on #144, #145)
 ├── #148 Trades create + list         (depends on #144, #145)
 └── #149 GitHub Actions workflow      (depends on #144)
      └── #150 Production smoke        (depends on #144, #149)

#145 Test-user provisioning helper (squad:hockney)
 ├── #146 Auth + household smoke test  (depends on #144, #145)
 ├── #147 Current-finances save flow   (depends on #144, #145)
 └── #148 Trades create + list         (depends on #144, #145)

#151 Seed/cleanup data utilities (squad:hockney — independent, enhances #145)
```

## 12. Open Questions

1. **Vercel preview URL in CI:** How does the PR workflow discover the preview URL? Options: Vercel GitHub integration provides it via `deployment_status` event, or we hardcode the dev URL for PR runs.
2. **Simulation backend in CI:** Plans simulation requires FastAPI. For nightly, do we spin up a Docker container, or skip simulation tests? Recommendation: skip for v1, add later.
3. **Supabase local in CI:** `supabase start` in GitHub Actions requires Docker. Adds ~2min to CI. Worth it for RLS tests in v2.

---

*This document is the canonical reference for E2E testing decisions. All implementation issues reference it.*
