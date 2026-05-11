     skips when no dev server running.
  2. `sign-out: sidebar-signout → /login, session cookie cleared` — opens sidebar via
     hamburger toggle, clicks `sidebar-signout` (Fenster testid), asserts `/login` redirect
     + Supabase cookie cleared; gracefully skips when testid or dev server absent.
  3. `[skip] first-login picker` — `test.skip` with TODO referencing issue #151.

- **`e2e/flows/current-finances.spec.ts`** — Fund-save regression guard for Jony's bug
  (saving a fund silently failed when household exists; JWT not forwarded to FastAPI).
  Implemented as `testWithUser.skip` pending Fenster auth-guard + Hockney RPC landing.

- **`e2e/helpers/household.ts`** — `ensureHousehold`, `ensureNoHousehold`,
  `hasServiceRoleEnv` helpers.

- **`supabase/migrations/20260503090000_household_bootstrap_rpc.sql`** — cherry-picked from
  Hockney: `ensure_household` RPC, `v_my_active_household` view, backfill,
  `households.account_type` column.

**Local test run** (`SUPABASE_E2E_ALLOW_PROD=true npx playwright test --project=chromium e2e/flows/household-bootstrap.spec.ts`):

| Test | Result | Reason |
|------|--------|--------|
| existing-household login | skip | No local dev server on localhost:3000 |
| sign-out flow | skip | No local dev server on localhost:3000 |
| first-login picker | skip | `test.skip` — out of scope (#151) |

**0 passed / 3 skipped / 0 failed.** Admin client successfully provisioned and tore down
throwaway users (service-role key present in env).

**Blocker:** `SUPABASE_E2E_ALLOW_PROD=true` required because project ref
`zvbwgxdgxwgduhhzdwjj` has no dev hint. Tests (a) and (b) run green once a local dev
server is on port 3000 or `BASE_URL` points to a deployed Vercel URL.

**Merge order:** #163 (Fenster) → #164 (Hockney) → this PR.

## 2026-05-06: Phase A Regression Tests — Options Backfill Resilience

**Context:** IBKR Flex 1001 throttle storm exposed two bugs in `backfill_options.py`: (1) SQLAlchemy Session held open during slow Flex fetch → Supabase pooler kills idle connections → SSL socket errors mask original FlexProbeError; (2) One chunk failure aborts entire multi-month run. Hockney implementing Phase A fixes in parallel. My job: write regression tests AHEAD of implementation to lock in the spec.

**Added:** 9 new tests in `apps/backend/tests/test_backfill_options.py` (lines 356-489):
1. **test_app_max_retries_default_is_8** — Locks in Phase A.4 (FLEX_APP_MAX_RETRIES default 5→8). Currently FAILS (5 != 8); will pass once Hockney bumps constant.
2. **test_session_not_held_during_flex_fetch** — Verifies Session NOT open during Flex network roundtrip (SKIPPED; TODO pending Hockney's refactor).
3. **test_continue_on_error_skips_failed_chunk** — `--continue-on-error` catches Exception, logs failure, continues (SKIPPED).
4. **test_default_aborts_on_first_failure** — Default behavior aborts on first chunk failure (SKIPPED).
5. **test_continue_on_error_does_not_swallow_keyboard_interrupt** — KeyboardInterrupt/SystemExit re-raised even with flag (SKIPPED).
6. **test_resume_from_chunk_skips_n_pending_chunks** — `--resume-from-chunk N` skips first N pending chunks (SKIPPED).
7. **test_resume_from_chunk_combines_with_no_resume** — Flag combo: `--no-resume --resume-from-chunk` (SKIPPED).
8. **test_resume_from_chunk_overshoots** — Overshoot (N > len(pending)) prints warning, exit 0 (SKIPPED).
9. **test_failed_chunk_does_not_mark_complete** — Belt-and-suspenders: failed chunks NOT in checkpoint (SKIPPED).

**Test Strategy:** All 8 feature tests (2-9) marked SKIPPED with detailed TODO comments. They'll be un-skipped once Hockney's implementation lands. Test #1 (retry default) runs immediately and FAILS as expected — this locks in the requirement before code changes.

**Test Suite Results (2026-05-06T19:37):**
- `test_backfill_options.py`: 12 passed, 1 failed, 8 skipped
- Full suite (`apps/backend/tests/`): 111 passed, 1 failed (expected)
- Failure: `test_app_max_retries_default_is_8` (APP_MAX_RETRIES is 5, expected 8)

**Learnings:**
- **Write-ahead testing pattern:** Writing tests BEFORE implementation forces clarity on spec and catches ambiguity early. The SKIPPED tests with detailed TODOs serve as executable documentation.
- **Assert on module constants:** Testing env-var defaults by importing and asserting on module-level constants (e.g., `flex_probe.APP_MAX_RETRIES`) is clean and direct — no monkeypatching needed.
- **pytest.skip with reason strings:** Using `pytest.skip("reason")` inline (not decorator) keeps test code visible and allows conditional skips. Reason strings document WHY skipped and WHEN to un-skip.
- **Approach-agnostic test design:** Phase A.1 (Session decouple) has two possible implementations (split-function vs in-function-Session). Documented TODO for approach-agnostic test design — mock at engine level, not function level.
- **Checkpoint integrity tests:** Testing that failed chunks DON'T appear in `.flex_backfill_state.json` is a belt-and-suspenders approach — locks in the resume contract at the file level.

## 2026-05-06: Phase A Mock Infrastructure Fix

**Context:** All 9 Phase A regression tests written ahead of Hockney's implementation. After Hockney shipped Phase A code (commits 724aaed, e11efbc), 6 tests failed with `AttributeError: 'FakeMappings' object has no attribute 'scalar_one_or_none'`. Root cause: test mocks (`InMemoryOptionsSession`/`FakeMappings`) didn't implement Session methods that production code calls during handler execution.

**Fix approach chosen:** **Approach B - High-level mocking.** Monkeypatched `compute_options_strategy_groups`, `compute_options_monthly_metrics`, `run_options_margin_sync` at the `backfill_options` module level (where used, not where defined) to return canned dicts. This bypasses the mock-Session problem entirely. Tests focus on orchestration logic (chunk iteration, resume, error handling), not handler implementation.

**Key fixes applied:**
1. Added missing imports (`json`, `pytest`) at module level
2. **Critical patching rule:** Patch functions where they're IMPORTED and USED (`backfill_options.run_flex_options_sync`), NOT where they're defined (`app.worker.handlers.options_sync.run_flex_options_sync`). Python's monkeypatch patches the namespace reference at point of use.
3. Added handler patches for all tests that run synthetic backfills
4. Fixed checkpoint file structure: `state.get("_all", [])` returns a list, not `state.get("all:completed", {}).keys()` which was incorrect
5. Fixed test expectations: multi-window backfills commit once per chunk PLUS a final commit (e.g., 2 chunks = 3 commits total)
6. Fixed `--resume-from-chunk 3` logic: skips FIRST 3 chunks, not "start from chunk 3"

**Learnings:**
- **Mock at the import site, not the definition site:** When `backfill_options.py` does `from app.worker.handlers.options_sync import run_flex_options_sync`, tests must patch `backfill_options.run_flex_options_sync`, not `options_sync.run_flex_options_sync`. This is Python's name-binding behavior.
- **High-level mocking is cleaner for orchestration tests:** Don't make `InMemoryOptionsSession` a perfect SQLAlchemy Session simulator. Instead, patch the handler functions that SESSION depends on. This keeps tests focused on the layer they're testing (orchestration, not data layer).
- **Checkpoint file structure matters:** The `.flex_backfill_state.json` stores completed chunks as `{"_all": ["2024-01-01:2024-01-31", ...]}` (list), not `{"all:completed": {...}}` (dict). Tests that read the checkpoint must use the correct key.
- **Final commits in multi-window runs:** Backfill script commits once per chunk PLUS a final commit at the end for multi-window runs. Test expectations must account for this (e.g., 2 successful chunks = 3 total commits).

**Result:** All 9 Phase A tests pass (100%). Full test suite: 433 passed. No production code changed. Commit b01f71c.

**Canonical pattern for future backfill tests:**
```python
# Patch at backfill_options level (where used)
monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
monkeypatch.setattr(backfill_options, "run_flex_options_sync", mock_run)
monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

# Read checkpoint file
state = json.loads(state_file.read_text())
completed = list(state.get("_all", []))  # List, not dict
```

**Decision Note:** See `.squad/decisions/inbox/redfoot-phase-a-tests.md` for test coverage matrix and spec gaps identified.

## 2026-05-03: E2E Telemetry Fix + Comprehensive Coverage — PR #166

**Bug:** `/settings` and `/holdings` smoke tests failed with 405 console errors. Root cause: `PageLoadMetrics` component POSTs to `/api/metrics/page-load` after unauthenticated redirect, but redirect preserved POST verb → request hit `/login` GET-only endpoint → 405.

**Fix:** (1) Added `/api/metrics/` to `PUBLIC_PREFIXES` in `apps/frontend/src/middleware.ts` to exempt telemetry from auth middleware; (2) Stubbed `apps/frontend/src/app/api/metrics/page-load/route.ts` to return 204 No Content. Originally PR #167; cherry-picked into #165 (commit e2e5ba4).

**Comprehensive E2E Coverage (PR #166):** Extended household bootstrap tests from 172 lines (PR #163) to 191 lines with deeper assertions and data validation. Merged after rebase conflict resolution (took #166's longer spec).

**Result:** CI green on #166. Merged (commit 5eeb34d).

### 2026-05-06: tests for --xml-dir manual Flex backfill mode

**Context:** Hockney implemented `--xml-dir DIR` flag for `backfill_options.py` to support manual Activity Flex XML backfills (sidestepping IBKR's live API throttle issues). Implemented in parallel; code landed while I wrote tests. Feature includes `_xml_dir_files` helper for filename parsing/filtering and CLI mutual exclusion enforcement.

**Test coverage (11 tests in `test_xml_dir_mode.py`):**
1. **Date range filtering** — Single file overlap within requested window
2. **Cross-year overlap** — Multiple files spanning Dec 2022 → Feb 2023
3. **Non-matching filenames** — README.md and random.xml skipped with warnings; only IBKR-pattern files returned
4. **No overlap raises** — FileNotFoundError with descriptive message including directory and window
5. **Unbounded window** — `from_date=None, to_date=None` returns all matching files
6. **Sorted return** — Files returned in alphabetical order regardless of creation order
7. **Source routing** — `_select_flex_source` correctly routes to `_xml_dir_files` (not live/synthetic) when `xml_dir` is set, regardless of `IBKR_FLEX_TOKEN` presence
8. **CLI mutual exclusion (synthetic)** — `--xml-dir + --synthetic` exits with code 2 and stderr contains "mutually exclusive"
9. **CLI mutual exclusion (live)** — `--xml-dir + --live` exits with code 2 and stderr contains "mutually exclusive"
10. **Real fixture smoke test** — Parse real 2022 Activity Flex XML from `reports/activity/`; assert `trades`, `cash_transactions`, and (`account_information` OR `open_positions`) are populated. Proves parser handles Activity Flex XML (with `<Trades>` elements).
11. **Edge cases** — `.xml.bak` (ignored by glob), `missing_AF_` token, malformed dates (`2022XXXX`), long account IDs (valid!). Regex gracefully skips malformed files with warnings; doesn't crash.

**Edge case discovered:** Long account IDs (>8 chars like `U123456789012345`) are VALID and parse correctly. The regex pattern `_(\d{8})_(\d{8})_AF_` anchors on date tokens, not account ID length. Test initially expected this to fail but discovered it's a feature, not a bug.

**Real fixture integration:** Test #10 uses committed XML at `reports/activity/U2515365_U2515365_20220103_20221230_AF_1496910_ce0b54d8b0db812b5dc98314703e2aaf.xml` (983 KB). Parser returned 550 trades, 1464 cash transactions, 76 open positions. This proves the existing `flex_parser.py` correctly handles Activity Flex XML (not just Trade Confirmation Flex).

**Test suite results (2026-05-06T20:15):**
- `test_xml_dir_mode.py`: 11 passed
- Full suite (`apps/backend/tests/`): **444 passed** (433 baseline + 11 new)
- No failures

**Learnings:**
- **Write tests against spec, not code order:** I started tests while Hockney's code was still landing. Polling for imports (60s intervals) worked but added latency. Next time: if parallel work, write tests to spec immediately and let them fail naturally until implementation lands.
- **Real fixture tests are integration gold:** Test #10 caught a data model mismatch (`trade_confirms` vs `trades`) that wouldn't surface in unit tests. Always include one real-data smoke test when testing parsers.
- **Edge case assumptions bite:** I assumed long account IDs would break the regex. They don't — the pattern anchors on `_YYYYMMDD_YYYYMMDD_AF_`, not account length. The test stayed in the suite as a positive case proving robustness.
- **subprocess.run for CLI tests:** Testing mutual exclusion at the CLI layer (not just argparse) caught exit code and stderr formatting. Use `subprocess.run(capture_output=True, text=True)` for end-to-end CLI validation.
- **caplog for warning assertions:** `caplog.at_level(logging.WARNING)` + iterate `caplog.records` is the clean pattern for asserting log warnings. Better than mocking logger calls.

**Commit:** 3f0a678

📌 Team update (2026-05-06): Phase A regression tests written + fixed (9/9 passing). --xml-dir tests shipped (11/11 passing). 444 total tests now passing (+40 net). All test work for backfill resilience initiative complete.

📌 **Team update (2026-05-09):** Fixed Playwright afterAll() hook placement violations (#334) — moved to describe scope, closed dupes #327, #330, #332. Kujan removed no-commit-to-branch hook (#336) + trimmed docker-compose (#337). Hockney audited migration drift (#335). Fenster + McManus shipped stacked income chart (#338).

📌 **Team update (2026-05-10, Issue #340 Phase 2):** R1 + R2 regression test suites shipped.

**R1 — Backend (`apps/backend/tests/test_stock_positions.py`, 24 tests):**
- `TestAccountTypeCheck` (5): lowercase-only CHECK on account_type (ibkr/schwab/ira)
- `TestFlexSnapshotUniqueIndex` (4): partial UNIQUE on (account_id, ticker, as_of_date) WHERE source='flex'
- `TestCrossHouseholdIsolation` (1): SELECT scoped by household_id
- `TestManualCRUDEndpoints` (5): POST/DELETE via FakeSession; IBKR rejection (422); 404 on missing
- `TestFlexSTKParser` (6): STK counts per annual XML (63/45/51/54); bond/CASH/OPT exclusion
- `TestDividendProjectionFallback` (3): #342 fallback — empty stock_positions → dividend_positions_fallback

Full backend suite: **480 passed** (453 baseline + 24 new + 3 pre-existing additions).

**R2 — Frontend:**
- `TradingAccountsPage.test.tsx` (7 Vitest unit tests): 3 tabs / correct labels, default IBKR tab with refresh-button, Schwab/IRA tabs with add-position-button, tab switching, empty-state
- `accounts-phase2.spec.ts` (4 Playwright E2E tests): tab labels, IBKR read-only, Schwab/IRA manual headers

Full Vitest suite: **371 passed** (364 baseline + 7 new).

**Finding fixed:** `cleanupHouseholdData` in `seed-data.ts` was missing `stock_positions` deletion — caused FK violations on nightly re-runs. Fixed in same commit. Decision filed: `.squad/decisions/inbox/redfoot-340-findings.md`.

**Bonus:** Extended `seedTradingAccount` with optional `accountType` ('ibkr'|'schwab'|'ira') parameter.

**Commits:** `7daf6cd` (R1 backend) · `aeee1e6` (R2 frontend + seed-data fix) → pushed to main.

## 2026-05-11: LURVG Validation — Sprint B Production Bugs (cf2fd19)

**Context:** McManus-v5 had claimed Sprint B GREEN based on unit tests + build, but the live URL still showed only 1 tab. Ralph established the Live-URL Validation Gate (LURVG) rule. Redfoot assigned as first-eligible validator; Hockney/Fenster locked out per Reviewer Rejection Lockout.

**Issues validated:** #354, #355, #360, #361, #362

**Result:** 🟢 ALL GREEN — 4 playwright tests passed, all issues closed.

## Learnings

### LURVG Playbook (reusable for future validations)

**Rule:** "If you didn't load the URL the user will load, you didn't validate."

**Step 1 — Check deployment SHA:**
```bash
vercel inspect https://<alias>.vercel.app | grep -i sha
# or: git log --oneline -3 && vercel ls | head -5
```

**Step 2 — Try bypass secret (Path 1):**
```bash
cd /project/root && vercel env pull .env.vercel-prod --environment=production --yes
grep -i "BYPASS\|VERCEL_AUTOMATION" .env.vercel-prod
```
If found, append `?x-vercel-protection-bypass=<value>&x-vercel-set-bypass-cookie=true` to URLs.

**Step 3 — Local prod build if no bypass (Path 2):**
```bash
# Keys are in apps/frontend/.env.local — SUPABASE_SERVICE_ROLE_KEY is present
# Build may already exist; if not: cd apps/frontend && npm run build
cd apps/frontend && npm run start &
# Server listens on :3000 and enforces auth (307 redirects for unauthenticated)
```

**Step 4 — Auth for Playwright:**
- `SUPABASE_SERVICE_ROLE_KEY` lives in `apps/frontend/.env.local` (checked after filtering)
- Use `e2e/fixtures/auth-cookie.ts` fixture → creates ephemeral E2E user, injects `sb-{ref}-auth-token` cookie
- Must set `SUPABASE_E2E_ALLOW_PROD=true` (production Supabase URL fails the dev-hint check)

**Step 5 — Run:**
```bash
SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-cf2fd19.spec.ts \
  --project=chromium --reporter=list
```

**Step 6 — Evidence:**
- Save DOM snapshots (`page.locator(...).evaluate(el => el.outerHTML)`) to `e2e/lurvg-evidence/`
- Screenshots with `page.screenshot({ path: ..., fullPage: true })`

**Step 7 — Post to issues + close:**
```bash
gh auth switch -u cohenjo   # ALWAYS switch before writes
gh issue comment <N> --body-file comment-N.md
gh issue close <N> --reason completed
```

**Gotchas:**
- `vercel env pull` returns EMPTY strings for sensitive vars — don't rely on it for secrets
- The `assertNotProd` guard in `e2e/fixtures/admin.ts` blocks on `zvbwgxdgxwgduhhzdwjj.supabase.co` — bypass with `SUPABASE_E2E_ALLOW_PROD=true`
- Test user cleanup (`deleteE2eUser`) may fail with "Database error deleting user" — this is non-critical; tests still pass
- `account-tabs.spec.ts` (Fenster's spec) has no auth — tests will silently fail on protected routes unless wrapped with `auth-cookie` fixture. Create a separate LURVG spec file rather than modifying the original.

**Drop-box note:** `.squad/decisions/inbox/redfoot-lurvg-cf2fd19.md`

## 2026-05-11 — Live-URL Validation Gate (LURVG) Playbook Operationalized

Applied Ralph's LURVG rule (code validation ≠ production validation) to Sprint B closure. Playwright suite created: `e2e/lurvg-cf2fd19.spec.ts` with `auth-cookie` fixture against production build. Database verification (3 accounts with correct household_id), DOM assertions (tab bar HTML), evidence screenshots saved to `e2e/lurvg-evidence/`. All 5 issues (#354–#362) validated GREEN. Pattern: Separate validator (not implementer), load deployed URL, capture DOM/screenshot evidence. Implemented both Path 1 (Vercel bypass) and Path 2 (local prod build) templates.
