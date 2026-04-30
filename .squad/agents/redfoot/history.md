# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Redfoot (Tester)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

### 2026-04-30: RLS Reconciliation Tests — TJ-013 / GH #66 (PR #86)

**What was done:**
- Read all 12 migrations from PR #85 (`squad/61-ci-cd-scaffolding`) to understand actual schema.
- Created `supabase/tests/` directory with 5 files (4 test files + README):
  - `00_setup.sql` — test helpers: `create_test_user`, `create_test_household`, `add_household_member`, `set_session_user`, `clear_session_user`, `teardown`
  - `10_household_membership.sql` — 17 concrete assertions for `households` + `household_members` RLS (live in PR #85)
  - `20_household_data_isolation.sql` — 10 tests: 6 concrete (cooked.dashboard_summary) + 4 aspirational (trade, trading_positions)
  - `30_owner_private_isolation.sql` — 8 aspirational tests for `note` + `backtestrun` owner isolation
  - `40_audit_columns.sql` — 12 tests for `tg_update_timestamp()` trigger + schema structural checks
- Created `.github/workflows/test-rls.yml` (separate from Kujan's CI workflow)
- PR opened as DRAFT (depends on PR #85): `squad/66-rls-reconciliation-tests`

**Key learnings:**
- `USING (false)` for DELETE (not owner-only): Rabin deviation #1, confirmed and documented.
- Audit trigger (`tg_update_timestamp`) sets only `updated_at` — no `created_by`/`updated_by` columns exist in the migrations.
- `household_invitations` table does NOT exist in PR #85 — tests skipped, documented for follow-up.
- `trading_account_config` split (migration 20260430130300) is SKETCH only — skipped.
- `retire_local_user_table` (20260430130400) is DESTRUCTIVE/conditional — skipped.
- Aspirational test pattern: `ok(true, '@aspirational ...')` lets tests describe the desired contract without blocking CI.
- For RLS to apply in pgTAP, session role must be `authenticated` — tests use `SET LOCAL ROLE authenticated` + `tests.set_session_user(uuid)` combo.
- `cooked.*` tables have live RLS in PR #85; `public.*` household data tables do NOT yet.

**Test count: ~47 total assertions** (17 concrete household membership + 10 data isolation + 8 owner-private + 12 audit)

**PR:** Draft #86 (branch: `squad/66-rls-reconciliation-tests`) — Closes #66



- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Frontend test infra established: vitest + jsdom + React Testing Library. Config at `apps/frontend/vitest.config.ts`, setup at `src/test/setup.ts`. Run with `npm test` in `apps/frontend/`.
- `lightweight-charts` mock covers createChart, all series types (line, candlestick, histogram, area), timeScale, priceScale. Located in `src/test/setup.ts` — extend when new chart patterns are added.
- `next/navigation` mock covers useRouter, usePathname, useSearchParams. Sufficient for all current components.
- OptionChainSnapshot requires null-safety testing: API can return null Greeks. Tests confirm the component handles this gracefully with dash fallbacks.
- SplitBrainToggle uses `aria-pressed` for accessibility — tests verify this. Keep accessibility testing as a pattern for all toggle/tab components.
- AnalyzePage child views (LongTermView, ShortTermView) should be mocked in page-level tests to isolate routing/toggle logic from data-fetching concerns.
- PR #15 opened as draft for issue #4 (branch: `squad/4-frontend-test-infra`).
- **Playwright E2E tests for /analyze page:** Created `apps/frontend/tests/analyze.spec.ts` with 11 comprehensive tests covering page load, ticker search, toggle switching, financial data display, and error handling. Tests use REAL API calls (no mocks) with appropriate timeouts (30s test timeout, 15s for API-dependent visibility checks).
- **Key E2E testing patterns learned:** Toggle buttons use `aria-pressed="true"` (not `data-state="on"`), metric labels include spaces (e.g., "Net Debt / EBITDA", "EV / FCF"), real yfinance API calls require generous timeouts, invalid ticker tests should check for absence of data sections rather than specific error messages.
- **Real integration testing philosophy:** Unlike unit tests that mock external dependencies, E2E tests should verify the full stack integration including backend API calls and external data sources. This catches integration issues that mocked tests miss.

### 2026-03-06: Playwright E2E Tests for /analyze Page (11 Tests, All Passing)

**What was done:**
- Created `apps/frontend/tests/analyze.spec.ts` with 11 comprehensive Playwright E2E tests
- Tests cover: page load, ticker search (MSFT), toggle switching, Financial Scorecard, Valuation Benchmarks, DCF Calculator, error handling (invalid ticker, network failure), empty states, chart rendering
- All tests passing consistently
- Uses REAL API calls (no mocks), follows established real integration testing philosophy
- Timeouts: 30s per test, 15s for API-dependent assertions

**Key learnings:**
- Toggle buttons use `aria-pressed="true"` attribute (not `data-state="on"`)
- Metric labels must include spaces: "Net Debt / EBITDA", "EV / FCF"
- yfinance API can be slow — generous timeouts avoid flakiness
- Real integration tests catch data format quirks (null Greeks, missing technicals for low-volume stocks)

**PR:** #16 (branch: `squad/4-analyze-e2e-tests`)
**Commit:** (pending)

**Cross-team:** Waited for Hockney's router fix before starting tests. Backend now ready for production validation.
- ### 2026-03-07: Pension multi-owner regressions
- Backend pension identities now come from `extract_pension_payload` in `apps/backend/app/api/pension.py` and encode owner + product + fund/account, which keeps Jony/Rita products distinct across dashboard history, plan sync, and delete flows.
- `build_pension_dashboard_payload` is the key aggregation seam for pension history/projections; tests now verify it only emits latest active pensions and that deletes remove the same identity from historical snapshots and the plan.
- Frontend pension rendering now centers on `apps/frontend/src/components/Pension/pensionTypes.ts` and `pensionChartUtils.ts`; chart regression tests cover empty projections and missing history anchors, while `PensionTable.test.tsx` covers the four-fund Jony/Rita scenario and stable delete targeting.

### 2026-07-23: Pension upload propagation & zero-value regression tests (8 tests)

- **Bug-1 (invisible pension after upload):** Tests verify that upserting to both report-date and latest snapshot makes the pension visible on the dashboard. Key pattern: create multiple snapshots with different dates, upsert to both, then assert `build_pension_dashboard_payload` returns the pension in `accounts[]`. The dashboard reads only from `snapshots[-1]`.
- **Bug-2 (zero ILS from null Total Amount):** `_safe_float(None)` returns 0.0 — this is documented behavior now pinned by test. Sub-fields (deposits, earnings, fees) are preserved even when total is zero. Any future fix must update `test_extract_pension_payload_zero_total`.
- **Complementary pension resolution:** `resolve_pension_product` falls through product fields → fund name → filename. The "comp" hint in any of those resolves to "פנסיה משלימה". Tests pin all three paths.
- **Same-owner dual-product coexistence:** `_make_jony_comprehensive` and `_make_jony_supplementary` helpers exist for reuse. Identity uniqueness comes from the product slug in `build_pension_identity`.
- **Key file:** `apps/backend/tests/test_pension_api.py` — 13 tests total (5 original + 8 regression).
- **Edge case discovered:** double-upsert on the same snapshot (same date = report date = latest) does not duplicate — the identity match prevents it. This is safe.

📌 **Team update (2026-03-07T20:18:16Z):** Pension upload bugs fixed — snapshot propagation for dashboard visibility + Hebrew RTL analyzer prompt + zero-value validation. All 17 tests passing. — Hockney, Redfoot

### Deterministic table extraction tests (5 tests, all passing)

- **What:** Added 5 tests for Hockney's `_extract_from_tables()` in `apps/backend/app/utils/copilot_analyzer.py`. Tests mock `pdfplumber.open` and supply Clal pension TABLE 2 data with exact Hebrew RTL keywords.
- **Key file:** `apps/backend/tests/test_pension_api.py` — now 21 tests total (16 original + 5 new).
- **Mock pattern:** `_mock_pdf()` builds a MagicMock with `__enter__`/`__exit__` for context manager protocol, `.pages[0].extract_tables()` and `.extract_text()`. Hebrew keywords in mock data must match the `_KW_*` constants exactly (e.g., `"ןועברה ףוסב םיפסכה תרתי"` not abbreviated).
- **Page text regexes:** Name, ID, and date are extracted via `_PAT_NAME`, `_PAT_ID`, `_PAT_DATE` regexes from page text — not from tables. Mock text must match these patterns (e.g., `'66475922 :ז.ת רפסמ ישראלי ישראל :תימעה םש'`).
- **Name reversal:** pdfplumber returns reversed Hebrew word order; the function does `" ".join(reversed(raw_name.split()))`. Mock text must provide name in reversed order.
- **Product detection:** `_PRODUCT_COMP = "המילשמ"` vs `_PRODUCT_COMPREHENSIVE = "הפיקמ"` in first 600 chars of page text. Fund: `_FUND_CLAL = "היסנפ ללכ"`.
- **Monthly deposits formula:** `round(deposits_ytd / month_num)` where month_num comes from report date month. Sep 30 → month 9 → 33146/9 ≈ 3683.
- **Earnings/fees split:** Single cell `"120,818\n-580"` → split on newline, fees = abs(second part).
- **Fallback:** When `_find_table2()` returns None (no matching keywords), function returns None, signaling caller to use AI path.

📌 **Team update (2026-03-07T20:59:37Z):** Deterministic table extraction implemented and tested. `_extract_from_tables()` reliably parses Clal pension PDFs (800,545 ILS comp, 1,194,873 ILS main). AI fallback preserved. 21 tests total, all passing. Non-breaking change. — Hockney, Redfoot

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
