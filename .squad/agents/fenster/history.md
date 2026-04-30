# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Fenster (Frontend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- **2026-07-18: "After I Leave" page built** — Long-form family financial guide at `/after-i-leave`. Architecture: page.tsx uses `useRef` + dynamic `import('html2pdf.js')` for PDF generation with a CSS class toggle (`pdf-light-mode`) that switches dark slate theme to white/gray for print-friendly PDFs. Components: `CollapsibleSection` (reusable expand/collapse card), `SummaryTable` (fetches from `/api/finances/latest`, merges with demo insurance data, groups by category). Type declaration for html2pdf.js at `src/types/html2pdf.d.ts`. Nav link added to MainLayout under a new "Family" section with divider, positioned below Settings. Page uses inline `<style>` block for PDF light-mode overrides since Tailwind custom variants would need config changes. Pattern: for content-heavy informational pages, prefer long-form article layout over dashboard cards.
- **2026-03-07: Frontend gracefully handles pension category migration from Investments to Savings.** Verified after Hockney's backend change: pensions now have `category: "Savings"`, `type: "Pension"`, `details.draw_income: true` default, and `max_withdrawal_rate: 0`. Frontend works correctly with zero code changes required. Key architecture: (1) Current Finances page renders pensions in Savings tab via category filter (line 73), displaying 💰 icon and all pension details (managing_body, draw_income, divide_rate, starting_age). FinanceCard shows type badge "PENSION" so users distinguish from regular savings. (2) FinanceTabs correctly maps pensions to `category: 'Account'` (line 144), syncs draw_income bidirectionally (lines 191, 244), and assigns to Savings category when `account_settings.type === 'Pension'` (line 222). (3) PlanEditor reads draw_income from finance item details (line 85), correctly includes pensions with draw_income in pensionIncomeItems (lines 216-219). (4) PlanEngine pension logic unchanged (line 377) — checks `type === 'Pension' && draw_income` regardless of category. (5) DonutChart equity breakdown now aggregates Savings+Investments by type (line 150-161), so pensions appear in "Pension" slice rather than separate "Investments" chart. This is semantically correct: pensions are long-term savings that convert to retirement income. Pattern: category-agnostic account type system allows backend reclassification without frontend changes.
- **2026-03-07: Pension UI now treats owner/product identity as the chart/table contract.** Added shared pension types plus chart helpers in `apps/frontend/src/components/Pension/pensionTypes.ts` and `apps/frontend/src/components/Pension/pensionChartUtils.ts` so the page consumes `series_id`/`id` separately from human labels. Pattern: render pension product as the primary label, provider/fund as secondary metadata, and never let chart projection lines prepend an undefined history point when the first valid value only appears in projections.
- **2025-07-18: Short-Term "Income Mechanic" view fully built (Phase 3)** — Replaced all 3 placeholder cards in ShortTermView with 8 real data-driven components under `shortterm/`. Created 4 hooks (`useTechnicals`, `useOptionChain`, `usePriceHistory`, `useSynthesis`) all following `{ data, loading, error }` pattern with fetch to `/api/analyze/` endpoints. Built CandlestickChart (lightweight-charts with candlestick + volume + EMA 50/200 dashed lines + Bollinger Bands), MomentumPanel (RSI gauge with color zones + MACD crossover signals), AIPriceAction (support level + setup quality from synthesis API), OptionChainSnapshot (expiry selector, IV percentile/rank metrics, near-the-money puts table ±10%), and BreakevenVisualizer (interactive strike selector, horizontal bar with profit/loss/at-risk color zones, premium/max-profit/max-risk/ROC metrics). ShortTermView wires all hooks, shows skeleton loading states, error banners, and responsive grid layout. Amber accent theme throughout to distinguish from blue long-term view. Zero new TypeScript errors — all pre-existing errors remain untouched. Chart follows OptionsChart.tsx pattern (createChart, resize handler, dark theme #020617/#1e293b).
- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- **2025-07-18: Company Analysis page shell built (Phase 1, Task #4)** — Created `/analyze` route with `AnalyzePage`, `SplitBrainToggle`, `TickerSearch`, `LongTermView`, and `ShortTermView` components. Nav link added to TRADING section after Backtest. Toggle uses blue for Long-Term, amber for Short-Term (pill/segmented control with shadow glow). Ticker input validates uppercase alphabetic 1-5 chars. Both views render 3 placeholder cards each. All files compile clean — zero new TypeScript errors. Follows existing page patterns (pension/summary) for layout, card styles, and dark theme.
- **2026-02-23: Codebase review completed** - Frontend is a Next.js 15.3 app with React 19, TypeScript strict mode, and Tailwind CSS. Uses lightweight-charts for financial visualizations. Found 53 component files with extensive hooks usage (183 occurrences). Architecture follows Next.js App Router with route-based pages. No test files exist yet. Discovered significant TypeScript `any` usage (~20+ instances) that compromises type safety. No Decimal/BigNumber types found for financial calculations - using native numbers which risks precision errors. Currency conversion exists but uses hardcoded rates. Missing error boundaries, loading states inconsistent, and console.log statements scattered (39 instances). Chart integration is solid but lacks performance optimization (React.memo, virtualization). Overall: functional but needs type safety improvements, proper financial precision handling, test coverage, and production hardening.

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety consolidated across frontend/backend - Critical action required to migrate from native numbers to Decimal/BigNumber types to prevent rounding errors in portfolio calculations. Quality gate established: all PRs must use Decimal for monetary operations. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL findings require immediate action: credentials exposed in git, no authentication layer, unrestricted CORS. Week 1: rotate credentials, implement JWT, restrict CORS, add security headers. Application not production-ready in current state. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** Testing and Quality Assurance - Frontend has zero test coverage; backend lacks financial calculation tests. GitHub Actions CI/CD needed. Recommendation: vitest + React Testing Library for frontend, pytest for backend with >85% coverage on financial logic. — Fenster, Hockney, Keaton

- **2025-07-18: Long-Term View Phase 2 — Real components built.** Replaced 3 placeholder cards in `LongTermView` with 6 data-driven components under `components/Analyze/longterm/`: PriceChartWithFairValue (lightweight-charts line series + DCF fair value price line, 1Y/5Y period selector), FinancialScorecard (ROIC vs WACC, revenue/FCF CAGR, net debt/EBITDA with color coding), ValuationBenchmarks (Forward P/E, PEG, EV/FCF with green/yellow/red ranges), DCFCalculator (interactive sliders for growth & discount rate, client-side DCF calculation, margin of safety), AISynthesis (growth engine + bear case two-column bulleted layout). Created 3 custom hooks (`useCompanyFundamentals`, `usePriceHistory`, `useSynthesis`) following `{ data, loading, error, refetch }` pattern. Original `LongTermView.tsx` re-exports from `longterm/` for backward compatibility. Zero new TypeScript errors — all pre-existing errors are in unrelated files (pension, summary, CashFlow). Pattern: chart uses `useRef` + `useEffect` with resize handler matching `OptionsChart.tsx` conventions.

📌 Team update (2026-03-07T21:49:50Z): Pension category reclassification verified and merged. Category-agnostic type-based architecture documented as team pattern for future resilience. Zero frontend code changes needed. — Scribe (Team Orchestration)

📌 Team update (2026-03-08T00:00:00Z): "After I Leave" page completed — comprehensive Israeli inheritance & financial instructions for spouse with life insurance claims, pension procedures, צו ירושה process, Bituach Leumi, IBKR estate liquidation, bank account procedures, government portal links, checklist, and PDF download via html2pdf.js. Route: /after-i-leave. Navigation: bottom sidebar with divider. Ready for user data input. — Scribe (Session Logger)
- **2026-07-22: "After I Leave" Hebrew/English i18n + wider layout** — Added full Hebrew/English language toggle to the After I Leave page. Created `translations.ts` at `components/AfterILeave/translations.ts` exporting typed `Lang` and full translations object (en/he) for all 12 sections. Page.tsx uses `useState<Lang>('en')` with `dir="rtl"` when Hebrew is active. Layout widened from `max-w-4xl` to `max-w-6xl` for better wide-screen use. Contact cards grid updated to `lg:grid-cols-3`. SummaryTable accepts `lang` prop for translated column headers, category names, and demo insurance items. Used logical CSS properties (`text-start`/`text-end`) instead of `text-left`/`text-right` for RTL compatibility. Currency values forced to `dir="ltr"` in RTL mode. Pattern: for i18n of content-heavy pages, extract ALL strings to a typed translations file rather than using a framework — simpler for single-page bilingual content.
- **2026-07-23: Insurance Policies page + After I Leave integration (#18)** — Created `/insurance` route with full CRUD form (type/provider/policy#/sum insured/premium/beneficiaries/expiry/website/notes/owner), table view, Hebrew/English toggle following the translations.ts inline pattern (page-local `t` object, `Lang` type). API contract: `GET/POST/PUT/DELETE /api/insurance`. After I Leave integration: life and mortgage insurance sections now check `insurancePolicies` state — real data replaces demo content (DemoTag hidden), demo fallback kept for empty state. SummaryTable accepts optional `insurancePolicies` prop, maps real policies to rows replacing demo items. Nav: 🛡️ Insurance link added to Family section in MainLayout. Architecture: insurance page uses `useCallback` for `fetchPolicies` to avoid stale closures in re-renders. Pattern: for pages that need inline i18n without the translations.ts file, define a local `t` object with full en/he branches — keeps the page self-contained when translations are page-specific and unlikely to be shared.


---

## 2026-04-10 — Week 1 Sprint: Frontend Testing Infrastructure (P0 Tasks)

**Branch:** squad/testing-frontend-utilities
**Status:** ALL P0 TASKS COMPLETE
**Commits:** 4 commits, 53 new tests, all passing

### Summary

Completed all P0 tasks for Week 1 of the testing plan. Added comprehensive test coverage for critical frontend utilities that affect all financial displays.

**Achievements:**
- Vitest coverage configuration with baseline thresholds
- 36 tests for currency conversion and formatting
- 17 tests for SettingsContext (global state)
- Cleaned up 3 E2E file issues (typo, duplicate, boilerplate)
- Created reusable test utilities (renderWithProviders)

**Impact:**
- Coverage baseline established: 4% to approximately 8% after merge
- Currency conversion logic fully tested (affects ALL monetary displays)
- SettingsContext validated (global state on all pages)
- E2E suite cleaned: 12 files to 9 files

### Task Breakdown

**Task 1: Vitest Coverage Configuration** (30 min)
- Added v8 coverage provider with html/lcov/json/text reporters
- Set baseline thresholds at 10% (will raise as coverage grows)
- Installed @vitest/coverage-v8 dependency
- Commit: d9a6071

**Task 2: lib/currency.test.ts** (2 hours)
- 36 comprehensive tests for currency conversion
- Test coverage: CURRENCY_RATES, convertCurrency (18 tests), formatCurrency (14 tests)
- Edge cases: zero, null, negative, large amounts, decimals
- Commit: fdf596f

**Task 3: SettingsContext.test.tsx** (2 hours)
- 17 tests for global settings context
- Created renderWithProviders test utility (reusable)
- Test coverage: defaults, currency switching, updates, localStorage persistence
- Commit: 466b7d8

**Task 4: Fix E2E Test Issues** (1 hour)
- Fixed typo: currrent-finances to current-finances
- Removed duplicate: cashflow.spec.ts (kept cash-flow.spec.ts)
- Removed boilerplate: example.spec.ts
- Commit: 871b0db

### Critical Findings

1. **Currency Conversion Formula:** (amount * fromRate) / toRate with ILS as base
2. **Invalid Currency Fallback:** Unknown currencies default to rate 1 (treated as ILS) - undocumented behavior
3. **SettingsContext Validation:** Corrupted localStorage gracefully falls back to defaults
4. **localStorage Key:** trading-journal-settings-v1 for persistence

### Pre-existing Issues Noted

- PensionTable.test.tsx has 2 failing tests (owner toggle) - existed before my work
- Root .gitignore has lib/ pattern - requires git add -f for frontend lib files

### Acceptance Criteria: ALL MET

- Vitest coverage config working
- lib/currency.test.ts: 36 tests passing
- SettingsContext.test.tsx: 17 tests passing
- E2E issues fixed
- All changes committed

**Branch ready for review and merge.**

📌 Team update (2026-04-10T08:19:59Z): Testing Sprint Phase 1-3 Complete — Phase 2 frontend review completed: E2E coverage corrected to 30%, currency.ts flagged P0, 8 custom hooks identified. Phase 3 implementation: 53 new tests delivered (lib/currency 18 tests, SettingsContext 20 tests, custom hooks 15 tests). Frontend coverage improved 4% → ~8%. Vitest coverage configured. Branch squad/testing-frontend-utilities ready for merge. Orchestration, session logs, and decisions merged. — Scribe (Team Orchestration)
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md

## TJ-015 — Supabase SSR Clients (2026-07-18)
- Installed `@supabase/ssr@0.10.2` + `@supabase/supabase-js@2.105.1` in `apps/frontend`
- Created `src/lib/supabase/server.ts` (server client, getAll/setAll cookies), `browser.ts` (singleton), `admin.ts` (service-role, browser guard), and `src/middleware.ts` (session refresh via getClaims())
- Added `src/types/database.ts` stub + `README-supabase-clients.md` decision table
- Branch: `squad/68-supabase-ssr-clients` → PR #86 (ready for review)
- Note: real Database types require Phase 1 migrations (PR #85) to land first
