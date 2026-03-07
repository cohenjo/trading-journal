# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Redfoot (Tester)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

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
