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
