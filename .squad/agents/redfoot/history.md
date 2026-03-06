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
