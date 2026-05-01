

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

### apiFetch pattern
- Created `src/lib/api-client.ts` as the canonical FastAPI client. Exports `apiFetch(input, init)` and `ApiAuthError`.
- Key design: uses `await import('@/lib/supabase/browser')` (dynamic import) inside `buildAuthHeaders()`, NOT a static import. Static import of `browser.ts` triggers the module-level `supabaseBrowser = createBrowserClient(...)` singleton at bundle evaluation time, which throws during Next.js static generation because `NEXT_PUBLIC_SUPABASE_URL` is absent. Dynamic import defers evaluation to actual function call time (browser-only, at runtime).
- Same pattern required in `login/page.tsx` — all Supabase calls inside event handlers/effects use `await import(...)` rather than a top-level static import.
- `export const dynamic = 'force-dynamic'` does NOT help for 'use client' components — it only works in server components. The dynamic import approach is the correct solution.

### Middleware allowlist pattern
- Public routes stored as two `readonly string[]` consts at the top of `middleware.ts`: `PUBLIC_ROUTES` (exact matches) and `PUBLIC_PREFIXES` (startsWith). This makes it easy to extend without touching auth logic.
- Auth guard reads `getClaims()` result — `data?.claims` is truthy when a valid session exists. DO NOT use `getUser()` for this (it makes an extra network round-trip to Supabase). `getClaims()` reads from cookies set by the middleware itself, so it's local.
- IMPORTANT: after building the redirect response, copy cookies from `supabaseResponse` onto the redirect, otherwise the session refresh from `getClaims()` is lost and the user loops on the redirect.

### Auth callback route
- `/auth/callback/route.ts` handles both Google OAuth (PKCE) and magic-link confirmation.
- Always validate `next` query param: must start with `/`, must not contain `//` or `:` (blocks protocol-relative and absolute URL redirects).
- Supabase sets the `code` param for PKCE; the route calls `supabase.auth.exchangeCodeForSession(code)` using the SERVER client (from `@/lib/supabase/server.ts`), not the browser client.

### Login page notes
- `useSearchParams()` in Next.js 15 requires a `Suspense` boundary. Pattern: inner `LoginForm` component uses the hook; outer `LoginPage` export wraps it in `<Suspense>`.
- Magic-link works with zero Supabase Studio config (email provider enabled by default).
- Google OAuth requires Supabase Studio → Authentication → Providers → Google (Client ID + Secret). ⚠️ Still pending keyboard task for Jony.

### Migration: 36 fetch sites → apiFetch
- Used Python regex `re.sub(r'(?<!api)fetch\(', 'apiFetch(', content)` for safe replacement (avoids double-replacing `apiFetch(`).
- macOS BSD `sed` does not support `\b` word boundaries — always use Python for cross-platform regex replacements.

## Wave 1 Pages — Auth Blocker (2026-04-30)

**Task**: Test and fix 5 Wave 1 frontend pages (#101-#105: current-finances, summary, cash-flow, root, settings)

**Status**: **BLOCKED** by Supabase authentication issues

**What I did**:
1. Created working branch `squad/wave1-all-pages` from latest main
2. Enhanced login page with password auth (previously only OAuth + magic link)
3. Verified `apiFetch` exists on main (PR #96 merged — JWT forwarding pattern)
4. Started both servers (frontend :3000, backend :8000)
5. Attempted login with test user `redfoot-test@example.com`

**Blocker**: Supabase dev project `zvbwgxdgxwgduhhzdwjj` returns `Invalid API key` for anon key. Cannot authenticate test user. All page API calls return 403 Forbidden. Cannot proceed with page testing without working auth.

**Handoff**: Coordinator/Jony needs to:
- Verify Supabase dev project health + anon key validity
- Confirm test user exists (USER_ID `093d1078-7826-4b8f-b825-2ebb80bbf889`)
- OR provide auth bypass for Wave 1 testing

**Technical notes**:
- Login page changes ready on branch (password field + toggle)
- All 5 target pages identified and structurally sound
- Backend RLS correctly blocking unauth requests (as designed)

See: `.squad/log/2026-04-30T*-fenster-wave1-blocked.md`

## Wave 4 Pages — Planning & Projection (2026-05-01)

### Summary
Completed E2E test coverage for four planning/projection pages (#114-#117) that were already functionally complete. All pages handle empty states gracefully and have working CRUD flows.

**PR:** #130 — `feat(frontend): wave 4 — after-i-leave, analyze, plan, progress pages functional`

### Findings by Page

**After I Leave (#114)** — Family financial guide with i18n
- PDF generation via html2pdf.js with light-mode CSS overrides
- Hebrew/English toggle with proper RTL layout switching
- Fetches from `/api/insurance` and `/api/finances/latest`
- Empty state: returns `[]` from fetch helpers, no errors

**Analyze (#115)** — Company analysis with split-brain view
- Split-brain toggle between Long-Term (fundamentals) and Short-Term (technicals)
- Ticker search drives both views
- Empty state: shows placeholder prompt when no ticker selected
- Already has 11 E2E tests in `e2e/flows/analyze/`

**Financial Plan (#116)** — Retirement projection with CRUD
- Full CRUD on `/api/plans/` (create/update)
- Server-side simulation via `/api/plans/simulate` (POST with plan + finances + settings)
- Empty plan: defaults to `{ name: 'My Plan', data: { items: [], milestones: [], settings: {} } }`
- 404 on `/api/plans/latest` is EXPECTED for fresh users (not a bug)
- Projection chart uses `PlanChart` component with markers for milestones/pensions
- Plan editor (`PlanEditor`) provides input UI for income/expenses/milestones

**Progress (#117)** — Net worth history tracking
- CRUD on `/api/finances/` for historic snapshots
- Chart displays net worth over time (empty state: "No data to display")
- Modal for adding/editing historic records
- Empty state: shows 0 values, empty chart, empty table

### Key Patterns

1. **Empty State Handling:** All pages use try/catch in fetch helpers, returning `[]` or default objects on failure. No crashes on 404 or 500.

2. **Auth-Cookie Fixture:** All tests use `auth-cookie.ts` (PR #124) for authenticated sessions. NO console errors related to auth.

3. **Test Structure:**
   - Page load check (main heading)
   - Key element presence (buttons, inputs, charts)
   - Empty state validation
   - Console error monitoring (filter out resource load failures)

4. **Plan Simulation Flow:**
   - Frontend debounces 500ms after plan changes
   - POSTs to `/api/plans/simulate` with `{ plan, finances, settings }`
   - Backend returns projection array: `[{ year, net_worth, liquid_net_worth, milestones_hit, ... }]`
   - Frontend maps to chart data format: `{ time: '2024-01-01', value: net_worth }`

5. **404 on /api/plans/latest is EXPECTED:** Fresh users have no plan yet. Frontend handles this by initializing a default empty plan.

### Reusable Patterns

- **E2E Test Location:** `apps/frontend/e2e/pages/{page}.spec.ts` (NEW directory created)
- **Test Fixture:** `import { test, expect } from '../fixtures/auth-cookie'`
- **Console Error Filter:** Ignore `'Failed to load resource'` (common for missing static assets)
- **Empty State Assertions:** Check for fallback text like "No data to display" or default values like `$0`

### No Code Changes Required
All four pages were already functional. Only tests were added. Pages already:
- Handle empty states gracefully
- Display loading states during fetch
- Show error messages on API failures
- Have proper TypeScript typing
- Follow existing component patterns


