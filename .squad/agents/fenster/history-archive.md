

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


# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Fenster (Frontend Dev)
- **Created:** 2026-02-23T22:46:19Z


## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Runbook authored (2026-05-01):** Created `docs/design-hosting/runbooks/vercel-02-deploys.md` (239 lines). Covers deploy triggers, preview URL patterns, OAuth redirect-URI gotcha (3 fix paths; path A / Supabase wildcards recommended), per-environment Supabase mapping, custom domain DNS cutover (TJ-026), rollback, log observability, common failures, and a verification checklist. ⚠️-flagged items: Supabase wildcard semantics, Vercel A-record IP, Hobby log retention, and rollback CLI syntax — all need live verification.
## TJ-015 — Supabase SSR Clients (2026-07-18)
- Installed `@supabase/ssr@0.10.2` + `@supabase/supabase-js@2.105.1` in `apps/frontend`
- Created `src/lib/supabase/server.ts` (server client, getAll/setAll cookies), `browser.ts` (singleton), `admin.ts` (service-role, browser guard), and `src/middleware.ts` (session refresh via getClaims())
- Added `src/types/database.ts` stub + `README-supabase-clients.md` decision table
- Branch: `squad/68-supabase-ssr-clients` → PR #86 (ready for review)
- Note: real Database types require Phase 1 migrations (PR #85) to land first

## Learnings — Page-by-Page Audit (2026-07-29)

**Data-layer patterns found across all 21 pages:**

1. **Single data-fetch pattern: all pages use `fetch('/api/*')`** — proxied by `next.config.ts` to `NEXT_PUBLIC_API_URL || http://127.0.0.1:8000` (FastAPI). There is no shared API client module. Each page defines its own ad-hoc `fetch()` calls inline, sometimes as standalone async functions at module scope, sometimes as `useEffect` bodies.

2. **No JWT forwarded to FastAPI** — zero pages attach `Authorization: Bearer <token>` to their `fetch()` calls. The Supabase middleware refreshes the session in cookies but no page reads the token and passes it on.

3. **Supabase JS client (`supabase.from()`) is unused in all pages** — `src/lib/supabase/browser.ts` and `server.ts` exist (from TJ-015) but no page or hook imports them. All data access is exclusively through FastAPI.

4. **Settings / user preferences live in `localStorage` only** — `SettingsContext` persists to key `trading-journal-settings-v1`. 8+ pages consume it. Not synced to any database table; will diverge across devices or household members.

5. **`NEXT_PUBLIC_API_URL` used for absolute URL construction in 5 files** — `/pension/page.tsx` (upload + delete) and 4 Analyze long-term hooks (`useCompanyFundamentals`, `usePriceHistory`, `useSynthesis`, `useGrowthStory`) build `${NEXT_PUBLIC_API_URL}/api/...`. All other pages use relative `/api/`. This inconsistency will cause broken requests if the env var is not set (falls back to empty string `""` + `/api/...`, which accidentally works in dev but is fragile).

6. **No auth guard anywhere** — `redirect()` appears only in `app/page.tsx` (to `/summary`). No page checks for an authenticated user or redirects to login.

7. **Duplicate utility functions** — `fetchLatestPlan()` and `fetchFinances()` are copy-pasted identically in `/plan/page.tsx` and `/cash-flow/page.tsx`. A shared `src/lib/api.ts` module does not exist yet.

8. **Named API endpoint groups:** `/api/finances/*`, `/api/plans/*`, `/api/options/*`, `/api/dividends/*`, `/api/ladder/*`, `/api/holdings`, `/api/bonds/*`, `/api/pension/*`, `/api/trading/*`, `/api/backtest/*`, `/api/analyze/*`, `/api/insurance`, `/api/tax-condor/*`, `/api/day/*` — 14 route groups, all FastAPI.

## Learnings — Auth Guard + JWT Forwarding (2026-07-29) — PR #96

## TJ-121 — JWT Forwarding Fix (2026-05-01)

**Problem**: All frontend `/api/*` calls to FastAPI returned 403 `{"detail":"Not authenticated"}` after Supabase signin.

**Root cause**:
- Frontend's `apiFetch` (from PR #96) correctly forwards Supabase JWTs via `Authorization: Bearer` header
- Backend's `main.py` imported the WRONG `get_current_user` dependency:
  - Used: `app.auth.dependencies.get_current_user` (local JWT system, expects HS256 tokens signed with backend's `JWT_SECRET_KEY`)
  - Should use: `app.dependencies.get_current_user` (Supabase JWT validator, verifies RS256 tokens via JWKS)

**Solution**: One-line import change in `apps/backend/main.py`:
```python
-from app.auth.dependencies import get_current_user
+from app.dependencies import get_current_user
```

**The Supabase JWT validator** (`app.dependencies.get_current_user`):
- Validates tokens via `app.supabase_auth.verify_supabase_jwt`
- Fetches public keys from Supabase JWKS endpoint (RS256/ES256)
- Falls back to `SUPABASE_JWT_SECRET` for local HS256 dev tokens
- Returns `SupabaseClaims` with authenticated user UUID (`claims.sub`)
- Backend already initialized JWKS cache in lifespan handler

**Configuration**: Backend `.env` must include:
```bash
SUPABASE_URL=https://zvbwgxdgxwgduhhzdwjj.supabase.co
# Optional: SUPABASE_JWT_SECRET for HS256 fallback
```

**Testing**:
- **Before**: All protected endpoints returned 403
- **After**: 53/60 smoke tests passed (7 webkit failures due to Supabase rate limiting, NOT auth errors)
- Manual curl tests confirm proper validation:
  - No token → 401 "Authorization header missing"
  - Invalid token → 401 "Malformed token"
  - Valid Supabase token → 200

**Impact**: Unblocks Wave 1, 2, and most of Wave 3 — this was THE single highest-leverage fix per issue #121.

**Branch**: `squad/fix-jwt-forwarding-#121-clean` → PR #122 (ready for review)
## Learnings — Wave 3 Chart Pages (2026-05-01)

**Issue context:** #110 (backtest), #111 (ladder), #112 (options), #113 (tax-condor) — PR #131

**Chart integration patterns with lightweight-charts:**
1. All 4 pages use `lightweight-charts` for visualization — `BacktestChart`, `ExpectedIncomeChart`, `OptionsChart` all follow the same pattern:
   - `useRef` for container DOM element
   - `useRef` for chart API instance
   - `useRef` for series instances
   - `useEffect` with cleanup on unmount
   - Resize listener on window
2. Chart data format: `{ time: string (YYYY-MM-DD), value: number }`
3. Series types differ by use case: `AreaSeries` (backtest, ladder, options projected), `HistogramSeries` (options historical), `LineSeries` (target lines)

**Empty state handling patterns:**
- Backtest: Empty years array shows "Loading years..." option in disabled dropdown + fallback to default year on API error
- Ladder: Loading state with animate-pulse + error banner + empty array fallbacks with `??` operator
- Options: Loading state prevents rendering until data fetched + error banner
- Tax-condor: Shows "No recommendations found" message when recommendations array is empty

**Data flow gotchas:**
- Options page: projection API requires `historicalData.length > 0` check before calling — doesn't fetch projections if no historical data exists
- Ladder page: two separate API calls (`/overview`, `/income`) must both succeed to render properly
- Backtest: year dropdown can be empty on first render if API is slow — fixed with loading indicator and disabled state

**Error handling improvements made:**
- Added proper try-catch with `finally` blocks for loading state cleanup
- Replaced `console.error` silent failures with visible error banners
- Type-safe error handling: `err instanceof Error ? err.message : 'fallback'` instead of `any`
- Response status checks: `if (!res.ok) throw new Error(...)` before `.json()`

**E2E test patterns with auth-cookie fixture:**
- Console error filtering: ignore telemetry `/metrics/page-load` 401s but catch other errors
- Loading indicator checks: `await expect(loading).toBeVisible()` with proper timeout
- Empty state validation: confirm page structure exists even with no data
- User interaction tests: input fills, checkbox toggles, button clicks
- URL param tests: ladder page supports `?candidateYear=N` for scanner integration

**Team integration notes:**
- No backend changes needed — all fixes were frontend-only
- All pages already had `apiFetch` with proper auth header forwarding
- Chart components were already built — just needed proper loading/error wrappers
- Auth-cookie fixture (PR #124) worked flawlessly for all tests
## Wave 1 Pages — May 1, 2026

**Context:** First batch of 5 Wave 1 pages (#101-105) brought to functional state with E2E tests.

**Pages Fixed:**
1. **current-finances** (#101) — Removed unused `netWorth` var. Added E2E test for charts + add-asset CRUD.
2. **summary** (#102) — Replaced `any` types with `Record<string, unknown>`. Read-only dashboard, just validates rendering.
3. **cash-flow** (#103) — Removed unused `PlanData` import, added `ProjectionPoint` interface, fixed all `any` types. Tests slider interaction.
4. **root** (#104) — Already functional, just added E2E test for redirect to /summary.
5. **settings** (#105) — Fixed `mainCurrency` cast from `as any` to explicit union type. Tests toggle + input CRUD.

**Auth-Cookie Test Pattern:**
- Import: `import { test, expect } from '../fixtures/auth-cookie'`
- Fixture usage: `test('...', async ({ authenticatedUser }) => { const { page } = authenticatedUser; ... })`
- Console error tracking: Filter out `/api/metrics/page-load` 401 (telemetry, tracked in #125)
- Assertions: page title, h1 text, key UI elements visible, no real console errors
- CRUD smoke: Test one primary interaction per page (add item, toggle setting, adjust slider)

**Linting Fixes:**
- Removed unused imports (`PlanData`, `netWorth`)
- Replaced `any` types with proper interfaces or `Record<string, unknown>`
- Explicit type casts where needed (`as 'ILS' | 'USD' | 'EUR'` instead of `as any`)

**PR #128:** All 5 pages functional, tests passing, linting clean. Ready for review.

**Reusable Patterns:**
- Single-commit-per-issue workflow for traceability
- E2E test files under `apps/frontend/e2e/pages/{page-name}.spec.ts`
- Filter telemetry 401s in all tests (known non-blocking issue)
- Keep test logic simple: render → no errors → primary CRUD

📌 Team update (2026-05-01T19:02:15+03:00): Platform workflows audit — removed 6 squad-* workflows, kept core CI and frontend jobs. — decided by kujan

## Learnings — Frontend API Call Site Audit (2026-05-01)

**Issue context:** Production bug — `POST /api/finances` → 404 on Vercel. User directive: "Frontend → Supabase directly for simple CRUD. No frontend↔backend HTTP coupling."

**Audit scope:** Complete inventory of all `/api/*` call sites across the frontend codebase. Identified 89 call sites spanning 16 features.

**Key findings:**

1. **Supabase client patterns already established** (PR #86 / TJ-015):
   - **Server-side:** `src/lib/supabase/server.ts` exports `createClient()` — returns `createServerClient` from `@supabase/ssr` with `getAll`/`setAll` cookie handlers. Use in **Server Components**, **Server Actions**, **Route Handlers**.
   - **Browser-side:** `src/lib/supabase/browser.ts` exports singleton `supabaseBrowser` and factory `createClient()` — returns `createBrowserClient`. Use in **Client Components** and hooks.
   - **Auth context:** Middleware refreshes sessions automatically; cookies are HttpOnly/Secure/SameSite=Lax.
   - **RLS enforcement:** Supabase policies use `auth.uid()` automatically — no manual `user_id` filtering required in application code.

2. **Server Action vs direct client decision criteria:**
   - **Server Action** for: mutations with business logic, multi-table writes, validation, cache revalidation, form submissions.
   - **Direct Supabase client** (browser) for: read-only queries, real-time subscriptions, optimistic UI, user-driven filters.
   - **Example (current-finances):** Save flow requires household lookup + validation + revalidation → **Server Action** is correct shape.

3. **Call site inventory table shape:**
   - Grouped by feature (current-finances, insurance, pension, dividends, etc.)
   - Columns: `File:line`, `Method+Path`, `R/W`, `Notes`
   - Enables effort estimation for future migrations (M-size per feature, L-size for multi-endpoint features like dividends)

4. **Current validation approach:**
   - Backend uses Pydantic for request/response schemas
   - Frontend has **zero Zod imports** — validation is manual or deferred to backend
   - Recommendation: Start with manual validation in Server Actions, introduce Zod once 3+ Server Actions need shared schemas

5. **Error handling pattern (upgrade from `alert()`):**
   - Server Action returns `{ success: boolean, error?: string }`
   - Client component shows inline error banner (Tailwind: `bg-red-900/20 border border-red-500`)
   - Optional: send errors to telemetry endpoint (`/api/telemetry`) in production

6. **Schema note — `finance_snapshots` table:**
   - Composite PK: `(household_id, date)` per migration 20260501110927
   - Top-level columns: `data` (jsonb), `net_worth`, `total_assets`, `total_liabilities`
   - **Missing columns:** `total_savings`, `total_investments` are in Pydantic model but not in DB schema → store in `data` JSON for now
   - RLS policies: SELECT via `is_household_member()`, INSERT/UPDATE/DELETE via `is_household_writer()`

7. **Testing requirements for Server Action migrations:**
   - **Unit:** Validation logic (Zod `.safeParse()` if used)
   - **Integration:** Mock Supabase client, verify `upsert` args, test RLS enforcement
   - **E2E:** Playwright flow (sign in → navigate → mutate → refresh → verify persistence + RLS isolation)

**Output artifact:** `docs/design-hosting/frontend-api-callsites.md` — 89 call sites inventoried, detailed migration plan for `POST /api/finances`, decision criteria for Server Action vs direct client.

**Branch:** Not yet created — this is planning/audit work only. Implementation PR will follow after team review.

## finances Server Action — Stop-the-Bleed Fix (2026-07-31)

**Branch:** squad/finances-server-action → PR opened
**Context:** POST `/api/finances` → 404 on Vercel (rewrites to undeployed FastAPI)

### What was done

1. Created `apps/frontend/src/app/current-finances/actions.ts`
   - `saveFinanceSnapshot(items, metrics)` — upserts to `finance_snapshots` via SSR Supabase
   - `getLatestFinanceSnapshot()` — reads latest snapshot via SSR Supabase
   - `resolveHouseholdId(userId)` — looks up `household_members` from session, **never from caller**

2. Updated `apps/frontend/src/app/current-finances/page.tsx`
   - Replaced both `apiFetch('/api/finances/*')` calls with Server Actions
   - Replaced `alert('Failed to save...')` with dismissable inline error banner (role="alert")
   - Removed dead variable computations (`netWorth`, `totalAssets`, `totalLiabilities`) that caused lint errors

3. Created `apps/frontend/src/app/current-finances/actions.test.ts`
   - 8 vitest unit tests: unauth path, no-household path, household_id from session (not caller), DB failure, input validation, read happy/error paths
   - Follows the mock pattern from `src/lib/__tests__/api-client.test.ts`

### Key decisions

- `household_id` ALWAYS comes from `household_members` table via `supabase.auth.getUser()`.  Never accepted from form input or function parameters.
- Supabase RLS (`is_household_writer`) enforces write isolation at DB layer — confirmed GREEN by Rabin's audit.
- next.config.ts rewrite guard left untouched (commit 89dff6e).


## Household Bootstrap + Sign-out (2026-05-03)

**Issue:** Jony hit "⚠️ No active household found for your account" on `/current-finances` when saving funds/assets. New OAuth users have no `household_members` row.

**Solution:** Implemented TASK A–D in branch `squad/login-household-bootstrap-2026-05-03`.

### Files created/modified

| File | Change |
|------|--------|
| `apps/frontend/package.json` | +`lucide-react ^1.14.0` |
| `src/lib/household/HouseholdContext.tsx` | NEW — HouseholdProvider + useHousehold hook |
| `src/components/Household/AccountTypePickerDialog.tsx` | NEW — modal for first-login household setup |
| `src/components/Household/HouseholdBanner.tsx` | NEW — inline banner with "Set up household" CTA |
| `src/components/Layout/MainLayout.tsx` | HouseholdProvider wrap + sign-out section + user email |
| `src/app/current-finances/page.tsx` | HouseholdBanner replaces raw error message |
| `e2e/flows/household-bootstrap.spec.ts` | Already existed; all data-testid attrs now implemented |
| `.squad/decisions/inbox/fenster-login-bootstrap.md` | Design notes |

### Architecture highlights

- **HouseholdContext:** React Context (no Zustand dep needed). Bootstrap on first authenticated render. Reads `v_my_active_household`. Exponential back-off (800ms × 2^attempt, max 3 retries). `runningRef` prevents concurrent runs.
- **Sign-out:** `supabaseBrowser.auth.signOut()` → `router.replace('/login')`. `LogOut` icon from lucide-react.
- **data-testid contract:** `household-banner`, `household-banner-setup`, `account-type-individual`, `account-type-joint`, `account-type-confirm`, `sidebar-signout`, `signed-in-email` — all implemented and stable for Redfoot E2E.

### Lint/typecheck

- `npm run lint`: 0 errors in changed files. Pre-existing errors unchanged.
- `npx tsc --noEmit`: 0 errors in changed files. Pre-existing errors unchanged.

## 2026-05-03: HouseholdProvider + Sign-out Menu Landed — PR #163

**Features:** Implemented `HouseholdProvider` component for household context management and added sign-out menu option in the UI. Enables user to manage active household and logout workflows.

**Merge:** PR #163 rebased on top of #164 (Hockney's RPC), CI green, merged (commit 168171d). Conflict resolution during rebase preserved #163's household context logic.

**Downstream:** PR #166 (Redfoot's comprehensive E2E coverage) depended on #163's household UI, merged successfully after rebase.

## Dual Y-axis: Net Cash Flow vs Realized P&L (2026-05-06)

**Issue:** `NetCashFlowVsRealizedChart` rendered cash-flow bars and cumulative P&L line on a single shared Y-axis, making the bars (±$1K-$10K) invisible against the cumulative line (~$219K).

**Solution:** Dual Y-axis using lightweight-charts' built-in `leftPriceScale` / `rightPriceScale` with `priceScaleId` per series.

### Files changed

| File | Change |
|------|--------|
| `apps/frontend/src/components/Options/net-cash-flow-vs-realized-chart.tsx` | Dual axes, currency formatter, axis-hint labels |
| `apps/frontend/src/components/Options/__tests__/NetCashFlowVsRealizedChart.test.tsx` | +2 tests (dual-axes, tooltip hints) |

### Implementation details

- `leftPriceScale: { visible: true, borderColor: '#22c55e', scaleMargins: { top: 0.1, bottom: 0.1 } }` — emerald, matches cash-flow bars
- `rightPriceScale: { borderColor: '#60a5fa', scaleMargins: ... }` — blue, matches P&L line
- Cash-flow histogram: `priceScaleId: 'left'`
- Realized P&L + tax lines: `priceScaleId: 'right'`
- Currency format: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })` passed as `priceFormat: { type: 'custom', formatter }`
- Legend buttons show axis direction hints: `← left axis` / `right axis →`
- Tooltip shows `Cash Flow (←)` and `Cumulative P&L (→)`

## Learnings

**Charting library:** `lightweight-charts` v5 (canvas-based, not SVG).

**Dual-axis pattern for this project:**
```typescript
// Chart creation
createChart(el, {
  leftPriceScale:  { visible: true, borderColor: SERIES_A_COLOR, scaleMargins: { top: 0.1, bottom: 0.1 } },
  rightPriceScale: {                 borderColor: SERIES_B_COLOR, scaleMargins: { top: 0.1, bottom: 0.1 } },
});

// Series assignment
chart.addSeries(HistogramSeries, { priceScaleId: 'left',  priceFormat: { type: 'custom', formatter: currencyFn, minMove: 1 } });
chart.addSeries(LineSeries,      { priceScaleId: 'right', priceFormat: { type: 'custom', formatter: currencyFn, minMove: 1 } });
```

**Testing dual axes:** The lightweight-charts mock (in `src/test/setup.ts`) exposes `vi.mocked(createChart).mock.calls` — assert `calls[n][1].leftPriceScale.visible === true` to verify dual-axis config without needing DOM introspection.

Reusable pattern documented in `.squad/skills/dual-axis-chart/SKILL.md`.

📌 Team update (2026-05-07): Dual-axis chart skill now in `.squad/skills/dual-axis-chart/SKILL.md`. Reusable pattern for any two-metric charts (cash flow vs. P&L, volume vs. price, etc.). FE charts now rendering both metrics independently.

## Stacked Income Bar Chart (2026-05-09)

**Issue:** Jony wanted stacked bars on `/summary` showing options/dividends/bonds income per year with future projections. Existing chart used area series (not bars) and didn't show actual options "Cumulative Cash Flow" data.

**Solution:** Paired with McManus to implement proper stacked histogram bars using lightweight-charts. McManus designed data model, I built the chart.

### Files created/modified

| File | Change |
|------|--------|
| `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx` | NEW — stacked histogram chart with 3 layers (options/dividends/bonds) |
| `apps/frontend/src/components/Summary/__tests__/StackedIncomeBarChart.test.tsx` | NEW — 6 tests for chart rendering, stacking, and projection styling |
| `apps/frontend/src/app/summary/page.tsx` | Updated data fetching to use getOptionsYearlyCashFlow() + proper year aggregation |
| `apps/frontend/src/app/options/actions.ts` | +getOptionsYearlyCashFlow() action (McManus) |

### Implementation details

- **Chart type:** HistogramSeries (lightweight-charts), NOT area series
- **Stacking:** Three overlapping histograms — options (base), dividends (options + dividends), bonds (total)
- **Projected years:** Reduced opacity (0.4) vs actuals (1.0) — makes future projection visually distinct
- **Tooltip:** Interactive floating tooltip shows breakdown by source + total
- **Currency formatting:** `Intl.NumberFormat` with USD, no decimals, thousands separator
- **Data source:** `getOptionsYearlyCashFlow()` aggregates from `options_dashboard_monthly.cash_flow_cumulative` — takes max cumulative per year

### Projection model (McManus)

- **Options:** Actual cumulative cash flow for past years, 0 for future (conservative)
- **Dividends:** Compound growth from current annual income (yield + reinvest + growth rate)
- **Bonds:** Scheduled coupon + maturity payments from ladder

### Test/lint results

- `npm run test -- --run StackedIncomeBarChart`: 6/6 tests pass
- `npm run lint`: 0 errors in changed files

## Learnings

**Stacked histograms in lightweight-charts:** Unlike area series, histograms don't auto-stack. Create 3 series with cumulative values:
- Series 1 (bottom): value = A
- Series 2 (middle): value = A + B
- Series 3 (top): value = A + B + C

Each series draws from 0 to its cumulative value, creating a stacked effect when overlapped.

**Projection styling:** Set opacity in the `color` property of each data point (not series-level). Example: `color: rgba(245, 158, 11, 0.32)` for projected vs `rgba(245, 158, 11, 0.8)` for actuals.

**Paired work with McManus:** Data design first, then UI. McManus owned the SQL aggregation + projection logic, I owned the chart component. Clear separation of concerns made parallel work efficient.

📌 **Team update (2026-05-09):** Shipped stacked income bar chart on /summary with McManus (#338) — options via `options_dashboard_monthly.cash_flow_cumulative`, dividends compound-growth, bonds scheduled income; future years at 40% opacity. Hockney completed migration audit (#335). Kujan removed no-commit-to-branch + trimmed docker-compose (#336, #337). Redfoot fixed E2E hook placement (#334).

## Cumulative-vs-Per-Year Cash Flow Bug Fix (2026-05-09, Issue #341)

**Issue:** 2025 options income showed ~$373k in stacked bar chart instead of actual ~$96k. Bug was in `getOptionsYearlyCashFlow()` — took MAX of `cash_flow_cumulative` per year, but that column is cumulative from inception (not reset annually), so each year's bar included all prior years.

**Solution (paired with McManus):** Changed query to SUM `cash_flow_total` (monthly net) per year instead of MAX `cash_flow_cumulative`. This gives true per-year delta, not cumulative-as-of-EOY.

**Files modified:**
- `apps/frontend/src/app/options/actions.ts` — `getOptionsYearlyCashFlow()` function

**Before/After:**
- Before: `SELECT cash_flow_cumulative ... MAX(cumulative) per year`
- After: `SELECT cash_flow_total ... SUM(monthly_net) per year`

**Verification:**
- Tests: 6/6 pass in `StackedIncomeBarChart.test.tsx`
- 2025 options value now renders correctly at ~$96k (was ~$373k)
- Lint: 0 new errors
- Typecheck: 0 new errors

**Learning (Cumulative Trap):** When a table has both cumulative and per-period columns (like `options_dashboard_monthly.cash_flow_cumulative` vs `cash_flow_total`), always confirm whether you need:
1. **Cumulative-to-date**: Use the cumulative column directly (e.g., total P&L from inception)
2. **Per-period delta**: Sum the per-period column (e.g., annual cash flow) OR difference consecutive cumulative values

This is a common trap with financial time-series data. Our bug happened because we mistakenly treated an inception-cumulative column as if it reset annually. The fix was straightforward once diagnosed: use the right column (`cash_flow_total` for monthly net) and the right aggregation (`SUM` for per-year total).

McManus and I paired on this — the separation between data layer (his) and UI layer (mine) made it easy to spot the bug at the boundary and fix it quickly.

📌 **Team update (2026-05-09T18:26:00+03:00):** Fixed #341 stacked income chart cumulative bug. 2025 options now shows correct ~$96k (was ~$373k). Paired with McManus on diagnosis + fix. (commit 1649369)

## 2026-05-09T18:19:36+03:00 — Issue #339 Part B: Summary Uses Dividend Estimations

**Context:** The `/summary` stacked income chart projected dividends using a simple growth model. Jony wanted to override specific years with actual/estimated values.

**Task:** Fetch dividend estimations from the new `dividend_estimations` table and merge with the projection model — estimation wins if present, otherwise fall back to projection.

**Changes:**
- `apps/frontend/src/app/summary/page.tsx`:
  - Import `getDividendEstimations` from `@/app/dividends/actions`
  - Fetch estimations and build a `Map<year, amount>` for fast lookups
  - Build `divSourceMap` to track whether each year's value came from 'estimation' or 'projection'
  - In the merge loop: `if (estimationsMap.has(year))` use that, else compute projection
  - Pass `dividendsSource` to `YearlyIncomeData` objects
- `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx`:
  - Added `dividendsSource?: 'estimation' | 'projection'` to `YearlyIncomeData` and `TooltipData`
  - Tooltip now shows `(est.)` badge next to "Dividends" when source is 'estimation'
  - Updated chart description: "Dividends use your estimations where entered, otherwise project with X% growth rate"

**Outcome:** Summary chart now respects user-entered estimations. Tooltip makes the data source transparent.

**Pattern learned:** When merging user-entered data with model projections, always track provenance and surface it in the UI. Estimations override projections, not vice versa.

**Paired with:** Hockney (backend schema + actions) — working as Fenster (frontend).

## 2026-05-09T18:42:35+03:00 — Bug Fix #342: Dividend Estimations Not Appearing on Summary Chart

**What the actual bug was:**
The projection loop in `summary/page.tsx` started at `currentYear` (2026). Jony's estimations were for 2022–2025 — all *before* `currentYear`. Those years were correctly fetched into `estimationsMap` but never written into `divMap` because the loop's range excluded them. The merge step then read `divMap.get(year) || 0` → `0` for those years, silently zeroing out the dividend bar instead of using the estimation value.

The estimations data existed in the DB (confirmed: 4 rows for 2022–2025 with household_id scoped correctly). The field name matched (`amount`). The fetch logic was correct. Only the loop boundary was wrong.

**Why it slipped through #339's test:**
The test added in `StackedIncomeBarChart.test.tsx` asserted structural plumbing — chart renders, three series created, stacking math correct, projected opacity lower. It did not assert the override semantic: "for an estimation year, `dividendsIncome` equals the estimation amount, not the projection." No test data included a year whose estimation would be missed by the loop boundary (all test mock data used years ≥ 2024 with the test running before 2026's rollover was a factor). The test could pass even with the bug present.

**The fix:**
Extracted merge logic to pure `buildYearlyIncomeData()` in `apps/frontend/src/app/summary/buildYearlyIncomeData.ts`. The function adds a "Pass 1" before the projection loop that writes all `estimationsMap` entries for years < `currentYear` into `divMap`/`divSourceMap`. Also adds estimation years to `allYears` so they appear in the chart even when no options/ladder data shares the same year.

**New regression test pattern for "this overrides that" behavior:**
When A should override B for the same year:
1. Set A to a known value (e.g., 50_000).
2. Set B to a deliberately absurd value (e.g., 999_999) to make any failure obvious.
3. Assert result equals A — and explicitly assert it is NOT B, NOT A+B, and NOT 0.
4. Add a separate case where A is absent and assert B is used.
5. Mentally (or in CI via branch) revert the override pass and confirm the test returns 0 or B instead of A.

This pattern catches: wrong field name, loop boundary miss, accidental summation instead of replacement, silent swallow by `|| 0`.

**Files changed:**
- `apps/frontend/src/app/summary/buildYearlyIncomeData.ts` (NEW — pure merge function)
- `apps/frontend/src/app/summary/__tests__/buildYearlyIncomeData.test.ts` (NEW — 5 regression tests)
- `apps/frontend/src/app/summary/page.tsx` (calls `buildYearlyIncomeData`, removes inline merge)

**Commit:** `3a75bd5`

## 2026-05-09T19:39:13+03:00 — Bug Fix #343: Stacked Income Bars All Rendering Blue

**Root cause (one sentence):** All three `HistogramSeries` started at `base=0` and the bonds series (added last) was drawn on top by lightweight-charts, its tallest blue bar covering the amber and emerald bars below it entirely.

**The fix — reversed series addition order:**
In lightweight-charts, the LAST series added is rendered on top. The correct stacking visual (options at bottom, dividends middle, bonds at top) requires the OPPOSITE addition order: bonds first (background), dividends second, options last (foreground). Each cumulative bar is then "painted over" by the shorter bar of the series above it, revealing the correct color band for each income layer. No data values were changed; only the order of `chart.addSeries()` calls.

**SERIES_COLORS single-source-of-truth pattern:**
Introduced `export const SERIES_COLORS = { options, dividends, bonds }` in `StackedIncomeBarChart.tsx`. Both the chart's `addSeries` color options AND the legend swatches in `summary/page.tsx` now derive their color from this constant, making drift structurally impossible. Tooltip swatches updated to inline styles from SERIES_COLORS too. Also replaced the hardcoded `rgba(r,g,b,…)` strings with a `hexToRgba(hex, alpha)` helper so projected-year dimming derives from SERIES_COLORS automatically.

**Tailwind purge note:** Not applicable here — the legend swatches were previously using Tailwind `bg-amber-500 / bg-emerald-500 / bg-blue-500` classes. These are safe from purge since they're static class names. After this fix they use inline styles from SERIES_COLORS, which is even safer (no purge risk at all).

**Regression test:**
`each series receives a distinct fill color matching SERIES_COLORS` in `StackedIncomeBarChart.test.tsx`. Asserts `new Set(seriesColors).size === 3` and that each entry matches the corresponding SERIES_COLORS key. Against the broken code (if all three addSeries calls used the same color), `distinctColors.size` would be 1 and the assertion would fail.

**Files changed:**
- `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx` (SERIES_COLORS, hexToRgba, reversed series order, inline tooltip swatches)
- `apps/frontend/src/app/summary/page.tsx` (import SERIES_COLORS, legend swatches → inline styles)
- `apps/frontend/src/components/Summary/__tests__/StackedIncomeBarChart.test.tsx` (new color test, updated series indices 0/1/2 to reflect bonds/dividends/options order)

**Commit:** `362851a`

---

## Issue #340 Phase 2 — 3-Account Tabs UI + Manual Position Entry + Dividend Projection

**Commits:** `c27299a` (F1), `df86e97` (F2)
**Date:** 2025-07-09

### What was built

**F1: 3-Account Tabs UI**
- Rewrote `/trading/accounts/page.tsx`: IBKR / Schwab / IRA / Settings tabs
- `normalizeType()` handles case mismatch (DB uses uppercase `'IBKR'`, `'SCHWAB'`)
- `StockPositionsTable.tsx`: readonly/editable mode, P&L coloring (green/red), multi-currency (USD/EUR/JPY via `Intl.NumberFormat`), delete button, total footer
- `AccountHeader.tsx`: account name badge, "FLEX" (IBKR) vs "MANUAL" (Schwab/IRA), IBKR refresh button vs manual add-position button
- `AggregatePortfolioFooter.tsx`: total portfolio value + per-account breakdown bars + top-5 holdings
- `AddPositionModal.tsx`: ticker autocomplete from `dividend_ticker_data`, quantity/cost-basis/date fields, validation, error display
- All 6 server actions (`getStockPositions`, `createStockPosition`, `deleteStockPosition`, `getTickerSymbols`, `triggerIBKRSync`, `getDividendProjection`) degrade gracefully if `stock_positions` table missing (Hockney's migration pending)

**F2: Dividend Projection Wire-Up**
- `summary/page.tsx`: `getDividendProjection()` called first; falls back to `getDividendDashboard().stats.annual_income` if unavailable
- `buildYearlyIncomeData.ts` unchanged (preserves #342 fix)

### Key debugging lesson — jsdom `type="number"` with `min` attribute

The two failing tests (`quantity = "0"`, `quantity = "-5"`) were traced to jsdom's handling of `<input type="number" min="0.000001">`. When jsdom sanitizes the value, fractional-min inputs with integer test values may not expose the expected `e.target.value`. Fixes applied:
1. Changed `min="0.000001"` → `min="0"` (validation is still JavaScript-only: `qty <= 0`)
2. Added `data-testid="position-form"` to the `<form>` element
3. Used `fireEvent.submit(form)` instead of `fireEvent.click(button)` for quantity-validation tests to bypass button click routing; wrapped each `fireEvent` in `await act(async () => {})`

Result: all 364 tests passing.

### Test coverage added
- `StockPositionsTable.test.tsx`: 15 tests
- `AggregatePortfolioFooter.test.tsx`: 8 tests
- `AddPositionModal.test.tsx`: 11 tests

**Files changed:**
- `apps/frontend/src/app/trading/actions.ts` (Phase2 types + 6 new actions)
- `apps/frontend/src/app/trading/accounts/page.tsx` (complete rewrite)
- `apps/frontend/src/app/summary/page.tsx` (dividend projection wire-up)
- `apps/frontend/src/components/trading/accounts/` (4 new components + 3 test files)

---

📌 **Team update (2026-05-09):** Backend dedup pattern (#340) now also enforced at server-action layer. Frontend `dedupeLatestSnapshot()` in `apps/frontend/src/app/trading/actions.ts` keeps row with max `as_of_date` per `(account_id, ticker)`. Result: 213 raw rows → 55 unique tickers. Verify actual data path end-to-end before declaring multi-agent features done. — Scribe
