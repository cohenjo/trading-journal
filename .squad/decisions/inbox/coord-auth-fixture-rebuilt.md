# Auth fixture rebuilt — three "all green" walkthroughs were false

**When:** This session
**Who:** Squad (Coordinator) + manual debug
**PR:** #124 — squad/auth-cookie-fixture
**Issues filed:** #125 (metrics 401), #126 (DATABASE_URL default), #127 (deprecate old auth.ts)

## What we found

`apps/frontend/e2e/fixtures/auth.ts` (added in PR #95) has never authenticated. It uses `@supabase/supabase-js` from esm.sh CDN inside `page.evaluate()`, which uses default `localStorage` storage. The app uses `@supabase/ssr` which uses cookies. Sign-in succeeded in the wrong storage; middleware redirected every protected route to `/login`; tests asserted HTTP 200 on the redirect → false-pass.

**Every "all green" walkthrough since PR #95 was a false positive.** This includes the smoke runs in PR #118 and the post-#122 sweep.

## What we did

1. Built `apps/frontend/e2e/fixtures/auth-cookie.ts` — bridges Supabase token to `@supabase/ssr` cookie format (`sb-{ref}-auth-token = "base64-" + base64url(JSON.stringify(session))`).
2. Built `apps/frontend/e2e/walkthrough/all-pages.spec.ts` — full-coverage harness using the new fixture. Records status, final URL, every API response, console errors → `/tmp/walkthrough-results.jsonl`.
3. Discovered backend `DATABASE_URL=localhost/...` default doesn't match Supabase setup; corrected via Management API to pooler URL `aws-1-eu-central-1.pooler.supabase.com:6543` (note: `aws-1`, not `aws-0`).
4. Refreshed stale `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/frontend/.env.local` via Management API.
5. Ran first-ever real authenticated walkthrough: 0 green / 15 yellow / 6 red, ZERO 5xx, single systemic issue is `/api/metrics/page-load` 401 on every page (telemetry instrumentation).

## Convention to capture

When writing E2E auth fixtures for Next.js apps using `@supabase/ssr`:

- Do NOT use `@supabase/supabase-js` from a CDN inside `page.evaluate()` — wrong storage adapter.
- Either:
  - Mint the session server-side (admin client) and inject the cookie via `page.context().addCookies()`, OR
  - Use `@supabase/ssr` directly in the test process, which respects cookie storage.
- The cookie format `@supabase/ssr` v0.10.x writes is: `sb-{ref}-auth-token = "base64-" + base64url(JSON.stringify(session))`. Source of truth: `node_modules/@supabase/ssr/dist/main/cookies.js`.

## Implication for backlog

- All Wave 1/3/4 page issues that "passed" smoke can be re-validated with the new fixture and may surface real bugs that were previously hidden.
- The old `auth.ts` fixture should NOT be used for new tests — issue #127 tracks migration + deletion.
