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
