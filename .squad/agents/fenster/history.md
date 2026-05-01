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
- Upsert uses `onConflict: 'date'` (PK). RLS blocks cross-household updates at DB level.

### Pattern established

This is the **template for all 32 MOVE endpoints**. See decision note at:
`.squad/decisions/inbox/fenster-finances-server-action.md`

### Build/test results

- `npm run test`: 8/8 new tests pass. 3 pre-existing Pension test failures (unrelated).
- `npm run lint`: 0 errors in changed files. All other lint errors are pre-existing.
- `npm run build`: ✅ succeeds with env vars set.
