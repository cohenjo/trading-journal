# Walkthrough v3 Blocked — Missing SUPABASE_SERVICE_ROLE_KEY

## Status
🔴 **BLOCKED** — Walkthrough test suite cannot proceed. All 21 tests failed due to missing environment variable.

## Root Cause
`SUPABASE_SERVICE_ROLE_KEY` is not present in `/Users/jocohe/projects/trading-journal/.env`

The Playwright E2E fixtures require this key to create test users via Supabase admin API. Without it, the `authenticatedUser` fixture cannot bootstrap test sessions.

---

## Step 2 Verification (Anon Key Check)
✅ **PASS** — Anonymous key is working correctly:

```
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"

HTTP 200 ✓
Response: {"external":{...settings...},"disable_signup":false,...}
```

The issue is **NOT** with the anonymous key (which was just refreshed).

---

## Error Output (first 50 lines of /tmp/walkthrough.log)

```
Running 21 tests using 1 worker

  ✘   1 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › / authenticated render (198ms)
  ✘   2 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /current-finances authenticated render (149ms)
  ✘   3 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /summary authenticated render (157ms)
  ✘   4 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /cash-flow authenticated render (295ms)
  ✘   5 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /settings authenticated render (147ms)
  ✘   6 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /holdings authenticated render (117ms)
  ✘   7 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /insurance authenticated render (108ms)
  ✘   8 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /pension authenticated render (94ms)
  ✘   9 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /dividends authenticated render (294ms)
  ✘  10 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /dividends/estimations authenticated render (102ms)
  ✘  11 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /backtest authenticated render (95ms)
  ✘  12 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /ladder authenticated render (96ms)
  ✘  13 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /ladder/scanner authenticated render (97ms)
  ✘  14 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /options authenticated render (99ms)
  ✘  15 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /tax-condor authenticated render (96ms)
  ✘  16 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /after-i-leave authenticated render (112ms)
  ✘  17 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /analyze authenticated render (110ms)
  ✘  18 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /plan authenticated render (97ms)
  ✘  19 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /progress authenticated render (96ms)
  ✘  20 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /trading/accounts authenticated render (96ms)
  ✘  21 [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /login authenticated render (95ms)


  1) [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › / authenticated render ──────────────────

    Error: [e2e/admin] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.

       at e2e/fixtures/admin.ts:35

      33 |
      34 |   if (!url || !key) {
    > 35 |     throw new Error(
         |           ^
      36 |       '[e2e/admin] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
      37 |     );
      38 |   }
        at getAdminClient (/Users/jocohe/projects/trading-journal/apps/frontend/e2e/fixtures/admin.ts:35:11)
        at createE2eUser (/Users/jocohe/projects/trading-journal/apps/frontend/e2e/fixtures/auth.ts:52:47)
        at Object.authenticatedUser (/Users/jocohe/projects/trading-journal/apps/frontend/e2e/fixtures/auth.ts:52:47)

  2) [chromium] › e2e/walkthrough/all-pages.spec.ts:13:7 › /current-finances authenticated render ──

    Error: [e2e/admin] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.

       at e2e/fixtures/admin.ts:35
```

## Issue
All 21 E2E tests failed at the fixture stage before any page navigation occurred. The error chain is:

1. Test tries to use `authenticatedUser` fixture
2. Fixture calls `createE2eUser()`  
3. `createE2eUser()` calls `getAdminClient()`
4. `getAdminClient()` reads `process.env.SUPABASE_SERVICE_ROLE_KEY` → **undefined**
5. Throws error

## Next Steps
⚠️ **Required before retry:**
- Add `SUPABASE_SERVICE_ROLE_KEY` to `/Users/jocohe/projects/trading-journal/.env`
- This should be the Supabase service role secret key from the project dashboard (available in dev/staging only, never production)

Once set, re-run the walkthrough harness.
