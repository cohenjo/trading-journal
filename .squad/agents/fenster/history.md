# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Fenster (Frontend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary (Feb-Apr 2026)

**Initial Frontend Audit (Feb 23):**
- 53 component files, extensive hooks usage (183 occurrences)
- No test files existed
- ~20+ TypeScript `any` usages compromising type safety
- No Decimal/BigNumber types for financial calculations
- 39 console.log statements scattered
- Missing error boundaries, inconsistent loading states
- Chart integration solid but lacking performance optimization

**Approved Decisions:**
- Financial Precision & Type Safety consolidation (Feb 23)
- Security Hardening required (Feb 23)
- Testing & QA strategy (Feb 23)

**Q2 Frontend Features Completed:**
- After I Leave page (Feb-Mar): long-form family financial guide at `/after-i-leave`, PDF generation via html2pdf.js
- Pension category migration handling (Mar): category-agnostic type system; no code changes needed when backend reclassified pensions
- Company Analysis page shell (Jul): `/analyze` route with split-brain toggle (Long-Term/Short-Term views)
- Short-Term Income Mechanic view (Jul): 8 real components with hooks (Technicals, OptionChain, PriceHistory, Synthesis)
- Insurance Policies page (Jul): full CRUD form with Hebrew/English toggle, After I Leave integration
- After I Leave i18n (Jul): full Hebrew/English support with RTL layout, typed translations object

**Testing Sprint (Apr 10):**
- Completed vitest configuration with baseline coverage thresholds
- 36 tests for currency conversion and formatting

**Architecture Patterns Documented:**
- Category-agnostic account type system for backend reclassification resilience
- Page-local typed translations object for single-page bilingual content
- Chart pattern using useRef + useEffect with resize handler
- Service layer separation with custom hooks

---

## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Runbook authored (2026-05-01):** Created `docs/design-hosting/runbooks/vercel-02-deploys.md` (239 lines). Covers deploy triggers, preview URL patterns, OAuth redirect-URI gotcha (3 fix paths; path A / Supabase wildcards recommended), per-environment Supabase mapping, custom domain DNS cutover (TJ-026), rollback, log observability, common failures, and a verification checklist. ⚠️-flagged items: Supabase wildcard semantics, Vercel A-record IP, Hobby log retention, and rollback CLI syntax — all need live verification.
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
