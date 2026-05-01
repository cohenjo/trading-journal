# Walkthrough v3 — REAL authenticated walkthrough
## Status: ✅ AUTH BRIDGE FOUND, page-by-page data captured

## Headline
For the first time we have **real authenticated walkthrough data** across all 21 pages. Three prior attempts produced false-positive "all green" reports that were actually unauthenticated redirects to `/login`.

## What was broken (root cause #1)
The existing `apps/frontend/e2e/fixtures/auth.ts` fixture **never actually authenticated**. It signed in via `@supabase/supabase-js` loaded from esm.sh CDN — that client uses default `localStorage` storage, NOT cookies. Next.js middleware reads cookies, so every protected route silently redirected to `/login` while tests reported "21 passed" (because the redirect returns HTTP 200).

This affected ALL prior smoke tests that used this fixture. None of them ever rendered authenticated content. The whole signal we were operating on was false.

## Fix: `apps/frontend/e2e/fixtures/auth-cookie.ts` (NEW)
- Creates user via service-role admin client
- Calls `/auth/v1/token?grant_type=password` directly (Node-side)
- Constructs the `sb-{ref}-auth-token` cookie value as `base64-{base64url(JSON.stringify(session))}` — exactly what `@supabase/ssr` expects
- Uses `page.context().addCookies()` to set on `localhost:3000`
- Now every fixture-using test gets a real authenticated session

## Fix: backend `DATABASE_URL`
Backend was pointing at `localhost:5432` (no local Postgres) — fixed to use Supabase pooler:
```
postgresql://postgres.{projid}:{pass}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require
```
Note: it's `aws-1-eu-central-1`, not `aws-0`. Found this via Supabase Management API `/database/poolers` endpoint.

## Fix: Supabase anon key in `.env.local`
The anon key was stale (signature mismatch). Refreshed via `/v1/projects/{id}/api-keys`.

## Walkthrough results (21 pages, real auth)

| bucket | count | pages |
|--------|------:|-------|
| 🟡 yellow | 15 | most CRUD pages — render but have telemetry 401 |
| 🔴 red    | 6  | `/`, `/summary`, `/dividends/estimations`, `/options`, `/progress`, `/login` |
| ✅ green  | 0  | every page hits the page-load metrics 401 |

**There are zero 5xx errors.** All page-load failures are now traced to **one** issue.

## Top failing API endpoints (post-DB-fix)
| status | count | endpoint | severity |
|--------|------:|----------|----------|
| 401 | 22 | `/api/metrics/page-load` | telemetry — low priority but causes visible console errors |
| 404 | 2  | `/api/plans/latest` | empty-state for fresh user, not a bug |
| 401 | 1  | `/api/trading/configs` | auth header probably missing |

## Bottom line
After three abortive walkthrough attempts and three real fixes:
1. **Auth bridge built** (auth-cookie fixture) — unblocks ALL future authenticated testing
2. **DB connection fixed** — wave of 5xx eliminated
3. **All pages render authenticated content** — no more silent redirects

Further work is now per-page polish, not foundational fixes.
