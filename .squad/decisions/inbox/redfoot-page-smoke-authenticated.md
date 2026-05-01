# Decision: Page Smoke Test Blocked on Auth Cookie Format

**Date**: 2026-04-30  
**Decider**: Redfoot  
**Status**: Blocker  
**Report**: `.squad/log/2026-05-01T01-42-41-page-smoke-authenticated.md`

## Context

Attempted to run 21-page smoke test against local dev server (http://localhost:3000) with proper Supabase dev auth. Goal was to capture per-page health (HTTP status, console errors, network failures, API endpoints called).

## Outcome: 🔴 BLOCKED

**19/21 pages timed out** after 10 seconds. Only `/insurance` partially loaded (but with backend API errors), and `/trading` returned 404 (route doesn't exist).

## Root Cause

**Auth cookie format mismatch** between test injection and `@supabase/ssr` middleware:

```
TypeError: Cannot create property 'user' on string 'eyJhY2Nlc3NfdG9r...'
  at SupabaseAuthClient._recoverAndRefresh
```

The test (`apps/frontend/e2e/smoke/all-pages.spec.ts`) injects:
```typescript
const base64Session = Buffer.from(JSON.stringify(sessionData)).toString('base64');
await context.addCookies([{
  name: 'sb-zvbwgxdgxwgduhhzdwjj-auth-token',
  value: base64Session,  // ❌ This format is wrong
  ...
}]);
```

But `@supabase/ssr` expects a **different format** (unknown which). This causes middleware to hang in an infinite loop trying to parse the cookie, resulting in all pages hitting 10s timeout.

## Secondary Issues

1. **Backend API not running**: Frontend proxies `/api/*` to `127.0.0.1:8000` → ECONNREFUSED
   - Affects: `/api/insurance`, `/api/metrics/page-load`
   - Question: Is backend expected to run during frontend dev smoke tests?

2. **Missing /trading route**: Returns 404 (should be removed from smoke test or implemented)

## Required Actions

| Who | Action | Priority |
|-----|--------|----------|
| **Hockney** | Fix auth cookie format in smoke test. Inspect actual cookie written by `@supabase/ssr` in browser DevTools, update test to match. Alternative: use Playwright to go through `/login` form flow. | 🔴 P0 |
| **Fenster** | Document backend startup requirements for smoke tests. Is `apps/backend` expected? If yes, add to runbook. If no, configure frontend to skip proxy in test mode. | 🟡 P1 |
| **Redfoot** | Remove `/trading` from smoke test page list (doesn't exist) | 🟢 P2 |

## Impact

- **Cannot validate 22-page health** until auth works
- **Cannot capture API endpoint list** for Hockney/Fenster to fix
- **Blocks release readiness check** (smoke test is a prereq)

## Next Steps

1. Hockney fixes auth cookie format in test → re-run smoke test
2. Once pages load: capture API endpoints, console errors, render health
3. Share results with Fenster/Hockney to prioritize API/frontend fixes

---

**Decision**: Stop smoke test work until auth format is resolved. Flagging as blocker for Hockney.
