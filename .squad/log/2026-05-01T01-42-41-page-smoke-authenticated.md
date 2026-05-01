# Page Smoke Test — Authenticated (Local Dev)
**Date**: 2026-04-30 23:48 UTC  
**Executor**: Redfoot  
**Target**: http://localhost:3000 (dev server with Supabase dev project)  
**Auth**: Email/password

## Status: 🔴 BLOCKED

### Critical Blockers

1. **Auth Cookie Format Mismatch**
   - Test injects: `base64(JSON.stringify(sessionData))` as cookie value
   - Middleware expects: Different format (unclear which — likely raw JSON or different structure)
   - Error: `TypeError: Cannot create property 'user' on string 'eyJhY2Nlc3NfdG9r...'`
   - Location: `SupabaseAuthClient._recoverAndRefresh` in `@supabase/ssr`
   - Impact: **All pages timeout** because middleware hangs trying to parse invalid cookie

2. **Backend API Not Running**
   - Frontend configured to proxy `/api/*` to `http://127.0.0.1:8000`
   - Error: `ECONNREFUSED 127.0.0.1:8000`
   - Affected endpoints:
     - `/api/insurance`
     - `/api/metrics/page-load`
   - Impact: Any page making API calls will fail or hang

3. **Missing Routes**
   - `/trading` → 404

### What Actually Happened

| Step | Result |
|------|--------|
| Started dev server | ✅ Next.js 15.3.4 running on :3000 |
| Loaded env vars | ✅ NEXT_PUBLIC_SUPABASE_URL points to dev project |
| Ran smoke tests | ❌ 19/21 pages timed out after 10s |
| Auth injection | ❌ Cookie format rejected by @supabase/ssr |
| Backend health | ❌ Port 8000 not listening |

### Test Results (21 pages)

| Page | Status | Load Time | Error |
|------|--------|-----------|-------|
| / | ❌ timeout | 10004ms | Auth cookie parse error |
| /after-i-leave | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /analyze | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /auth | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /backtest | ❌ timeout | 10004ms | Auth cookie parse error |
| /cash-flow | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /current-finances | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /day | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /dividends | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /holdings | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /insurance | ⚠️ partial | ~1400ms | Rendered but API call failed (backend down) |
| /ladder | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /login | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /options | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /pension | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /plan | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /progress | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /settings | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /summary | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /tax-condor | ❌ timeout | 10000ms+ | Auth cookie parse error |
| /trading | 🚫 404 | ~1400ms | Route does not exist |

### API Endpoints Called

**None captured** — pages hung in middleware auth parsing before rendering.

### Next Steps (For Hockney/Fenster)

1. **Fix auth cookie format in test** (`apps/frontend/e2e/smoke/all-pages.spec.ts:179`)
   - Inspect actual cookie format written by `@supabase/ssr` (Chrome DevTools → Application → Cookies)
   - Update test to match that exact format
   - Alternative: Use Playwright to go through `/login` form flow instead of injecting cookies

2. **Document backend startup** (for smoke test runbook)
   - Is `apps/backend` expected to run during frontend dev?
   - If yes: add startup command to smoke test script
   - If no: configure frontend to skip API proxying in test mode

3. **Remove /trading route** from smoke test or add the route

### Evidence

- Dev server logs show repeated: `TypeError: Cannot create property 'user' on string`
- Pages stuck at `GET / 307` redirect (middleware redirect loop)
- `/insurance` loaded when accessed directly → proves frontend code works when auth succeeds
- No network captures available (pages never got past middleware)

---

**Recommended assignee**: Hockney (owns auth middleware) + Fenster (owns backend integration)
