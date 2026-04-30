# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Redfoot (Tester)
- **Created:** 2026-02-23T22:46:19Z

## Learnings
## Core Context

*Summary: 4 previous entries consolidated below (created 4 distinct decisions/learnings)*

- ### 2026-04-30: RLS Reconciliation Tests — TJ-013 / GH #66 (PR #86)
- ### 2026-03-06: Playwright E2E Tests for /analyze Page (11 Tests, All Passing)
- ### 2026-07-23: Pension upload propagation & zero-value regression tests (8 tests)
- ### Deterministic table extraction tests (5 tests, all passing)

---

### 2026-03-08: Pension category changed from Investments to Savings (5 new tests)

**Backend change:** Hockney reclassified pensions from `category: "Investments"` to `category: "Savings"`. This is a semantic correction — pensions are savings vehicles, not liquid investments. Dashboard/matching still works because all pension filtering uses `type == "Pension"`, not category.

**Key changes in `apps/backend/app/api/pension.py`:**
- `extract_pension_payload()`: category now "Savings", added `draw_income: True` to details, added `max_withdrawal_rate: 0`
- `upsert_plan_pension()`: new plan items get `draw_income: True` in account_settings
- `_recalculate_snapshot()`: pensions now contribute to `total_savings` (line 286), not `total_investments` (line 291)

**Test updates:**
- No existing test assertions needed fixing (all filtering was already using `type == "Pension"`)
- Added 5 new tests in `apps/backend/tests/test_pension_api.py`:
  1. `test_pension_defaults_draw_income_true`: verifies draw_income flag is set in payload details
  2. `test_pension_max_withdrawal_rate_zero`: enforces pensions can't be withdrawn from
  3. `test_pension_counted_in_savings_total`: confirms pensions contribute to total_savings, not total_investments
  4. `test_plan_pension_defaults_draw_income`: verifies plan items get draw_income in account_settings
  5. `test_pension_category_is_savings`: simple category assertion

**All 26 tests passing** (21 original + 5 new). No regressions. The category change is non-breaking because all domain logic uses `type`, not `category`.

📌 Team update (2026-03-07T21:49:50Z): Pension category reclassification testing completed. 26 tests passing (21 updated + 5 new). All three team layers verified through orchestration. Decisions merged and documented. — Scribe (Team Orchestration)

📌 Team update (2026-04-10T08:19:59Z): Testing Sprint Phase 1-3 Complete — Full testing coverage audit completed (D+ grade, 850 lines). Phase 2 feedback from all specialists incorporated. Phase 3 implementation: 110 new tests (57 backend, 53 frontend) delivered across 3 branches. Financial core testing, infrastructure P0, PostgreSQL integration, and database models now prioritized. Orchestration logs created for all 8 agent spawns. Decisions merged: keaton-testing-plan-approved.md, redfoot-testing-audit.md, fenster-i18n.md. Session log and cross-agent updates completed. Ready for PR merge. — Scribe (Team Orchestration)

### 2026-05-01: Unified hosting design test/risk review

Reviewed `docs/design-hosting/design.md` plus six section docs as Redfoot. Wrote `docs/design-hosting/reviews/redfoot-review.md` with **CHANGES REQUESTED** focused on executable phase gates, RLS/auth edge cases, preview/prod isolation, worker retry/idempotency, rollback rehearsals, observability, and migration-complete acceptance criteria.

### 2026-05-01: Hosting design re-review

- Re-reviewed `docs/design-hosting/design.md` v2 against prior Redfoot findings.
- Verdict: **APPROVED WITH CONDITIONS**. Blocking findings landed; only remaining ask is a concrete local/dev bug-reproduction runbook before Phase 1 execution.
- Output saved to `docs/design-hosting/reviews/redfoot-rereview.md`.

📌 Team update (2026-04-30T15:00:37Z): Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

### 2025-07-25: Playwright E2E Framework — Smoke tier scaffolded

**What was done:**
- Designed tiered E2E architecture: `e2e/smoke/` (P0), `e2e/auth/` (P1), `e2e/flows/` (P1), `e2e/rls/` (P2).
- Updated `apps/frontend/playwright.config.ts`: switched from `testDir: './tests'` to `testMatch` covering both `tests/**` (existing integration tests) and `e2e/**` (new tiered suite). `baseURL` now reads `BASE_URL || PLAYWRIGHT_BASE_URL || 'http://localhost:3000'`.
- Wrote 4 smoke specs (9 tests across home/settings/holdings/healthcheck) — all enumerate cleanly with `--list` (no TS errors).
- Created `e2e/fixtures/admin.ts`: service-role admin client with prod-guard (throws if Supabase URL ref looks like production). Exports `createE2eUser`, `deleteE2eUser`, `makeE2eEmail`.
- Created `e2e/fixtures/auth.ts`: `authenticatedUser` and `householdOwner` Playwright fixtures. Sign-in uses `page.evaluate` to call supabase-js inside the browser context so SSR cookies are set correctly.
- Created `e2e/scripts/cleanup-stale-users.ts`: lists all `e2e_*` Supabase users, deletes any older than 1 hour.
- Added `tsx` to devDependencies and `test:e2e`, `test:e2e:dev`, `test:e2e:cleanup` scripts to package.json.
- Wrote `e2e/README.md` with full cheat sheet, tier definitions, fixture docs, CI shape spec, and env setup guide.

**Key patterns:**
- Throwaway users: `e2e_<unix-ms>_<4char-rand>@example.com` — unique per run, prefix-searchable for cleanup.
- Service-role client is singleton, lives only in `e2e/fixtures/admin.ts` — never imported by app code.
- Prod guard: checks Supabase URL ref slug for `dev/stag/test/local/preview/sandbox` hints; bypass with `SUPABASE_E2E_ALLOW_PROD=true`.
- Auth fixture uses `page.evaluate` + esm.sh CDN import of supabase-js to sign in inside the browser context (sets the `@supabase/ssr` cookies the middleware expects).
- `playwright.config.ts` uses `testMatch` (not `testDir`) to cover both old `tests/` and new `e2e/` without migration.
- `BASE_URL` env var is the canonical targeting mechanism; `PLAYWRIGHT_BASE_URL` preserved for backwards compat.

**`--list` result:** 9 new smoke tests enumerated across chromium/firefox/webkit with no TypeScript errors. Existing `tests/` specs still enumerate correctly.

**PR:** (pending — this round is scaffold only; running tests against dev Supabase is next round after Kujan confirms env)

### 2026-07-25: Smoke baseline established + P0 flow scaffold (PR #95)

**Branch:** `squad/p0-test-scaffold` (from main @ 870d3d1)

**Smoke baseline result: 7/10 PASS** (3 expected failures)

| Spec | Result |
|------|--------|
| `e2e/smoke/healthcheck.spec.ts` (3 tests) | ✅ 3/3 PASS |
| `e2e/smoke/home.spec.ts` (3 tests) | ✅ 3/3 PASS |
| `e2e/smoke/settings.spec.ts` (2 tests) | ⚠️ 1/2 — "redirects away from /settings" FAIL (no auth guard on main) |
| `e2e/smoke/holdings.spec.ts` (2 tests) | ❌ 0/2 — both FAIL (no auth guard; table IS rendered without auth) |

**Baseline log:** `apps/frontend/e2e/BASELINE.md`

**P0 routes covered (from Fenster's page-audit.md):**
- `/` → `/summary` — `e2e/flows/root.spec.ts`
- `/current-finances` — `e2e/flows/current-finances.spec.ts`
- `/plan` — `e2e/flows/plan.spec.ts`
- `/summary` — `e2e/flows/summary.spec.ts`

**Infrastructure added:**
- `e2e/fixtures/admin.ts` — service-role client with prod-guard (checks Supabase URL slug)
- `e2e/fixtures/auth.ts` — `authenticatedUser` + `householdOwner` Playwright fixtures
- `e2e/scripts/cleanup-stale-users.ts` — purge `e2e_*` Supabase users >1h old
- `playwright.config.ts` — `testMatch` covers `tests/**` + `e2e/**`; `BASE_URL` env var added

**Selector fragility noticed:**
1. `settings.spec.ts` test "does not render planning mode toggle" uses `[data-testid="planning-mode-toggle"]` — this attribute doesn't exist on the component yet, so the test passes for the wrong reason. Must add the `data-testid` when the auth guard ships.
2. `/summary` chart assertion uses broad `canvas, [class*="chart"]` selector — works today but will need tightening once the exact chart DOM structure is confirmed in production.
3. Flow tests use `canvas` + heading selectors with regex — these will be fragile if the page headings change. Consider adding `data-testid` attributes to key chart containers as a follow-up.

**Depends on:** Fenster's `squad/auth-guard-jwt-forwarding` PR. Once that lands, 3 smoke FAILs → PASS with no test changes.


📌 **Team update (2026-04-30T22-16-38Z):** RLS-21 dev+prod merge complete — PR #98 (21 public tables + drop secrets) merged to main (9ec4d2b), 18 migrations applied to prod (jaesiklybkbmzpgipvea), 0 rls_disabled_in_public advisor errors verified. Issue #97 closed. Cross-agent RLS coverage now extends to all 21 public tables. — Rabin (author), Keaton (reviewer), Hockney (prod apply), Redfoot (E2E coverage opportunity)
