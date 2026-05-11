## 2026-05-11 — Build fix: extract `detectPaymentFrequency` from `'use server'` module (commit `9a438a2`)

**Scope:** Next.js 15 RSC rule: every export in a `'use server'` file **must be async**. Synchronous pure utilities must live in plain modules (`src/lib/…`), never directly exported from `actions.ts`. Moved `detectPaymentFrequency` → `src/lib/dividends/payment-frequency.ts`; updated `actions.ts` (import) and test file. Vercel preview ● Ready: `https://trading-journal-bd3xbzyx3-cohenjos-projects.vercel.app`.

## 2026-05-11 — #363 TS hotfix: DividendPosition → DividendPositionRecord (commit `55ea014`)

**Scope:** Renamed legacy CRUD interface in `apps/frontend/src/app/dividends/actions.ts` to `DividendPositionRecord` to eliminate TS2440/TS2484 conflicts with the enriched `DividendPosition` imported from `@/types/dividends`. Removed conflicting re-export. 471/471 tests pass. Runtime behavior unchanged.

## 2026-05-11 — #363/#364 Dividends positions-mirror + Bonds per-account (PR #365, commit `fb74195`)

**Scope:** Add `getDividendPositions(accountKey)` + `getDividendSummary()` to dividends backend so UI tabs consume live `stock_positions` data instead of the legacy empty `dividend_positions` table. Add `getLadderOverviewByAccount(accountKey)` for bonds tab filtering.

**Key learnings:**
- `trading_account_config.account_type` = lowercase 'ibkr'/'schwab'/'ira' is the canonical tab key.
  Resolution: `account_type → config.id (int) → stock_positions.account_id (int FK)`. Source: `trading/actions.ts:435`.
- `dividend_payments.account_id` is TEXT (IBKR string "U2515365") — never integer. Join by symbol instead.
- `dedupeLatestSnapshot()` in `trading/actions.ts` is sacred and unexported. Call `getStockPositions(configId)` to avoid duplication.
- `dividend_accruals.gross_rate` = per-payment per-share amount (multiply by `paymentsPerYear(frequency)` for annual forward yield).
- Withholding Tax rows in `dividend_payments.type` must be excluded before TTM aggregation.
- TTM window anchor = server-side `new Date()`. All payment `ex_date` comparisons in JS (no DB-side date filter in current implementation — filter is post-fetch in JS).
- Schwab/IRA `dividend_positions` and `bond_holdings` are empty by construction (no data rows). This is expected, not a bug.
- When refactoring `getDividendDashboard()`, the legacy `positions` field still reads from the old `dividend_positions` table. Only `annual_income` stat was updated. Full deprecation deferred.
- Test mock pattern: must mock `@/app/trading/actions` when testing `dividends/actions.ts` because `getDividendDashboard` now calls `getStockPositions`.

**Files touched:** `src/types/dividends.ts` (new), `src/app/dividends/actions.ts`, `src/app/dividends/actions.test.ts`, `src/app/dividends/__tests__/dividend-positions.test.ts` (new), `src/app/ladder/actions.ts`

---

## 2026-05-09 — #335 Migration Drift Resolution (Option B — Pragmatic Prune)

**Scope:** Reconcile 47 local migration files vs 46 remote-applied. Align timestamps,
commit-back remote-only SQL, apply 8 pending migrations, defer 1 destructive one.

**Executed:**

**Phase 1 — Alignment (commit `85eebb3`):**
- Renamed 14 local files to match remote timestamps (remote timestamp is canonical).
  Includes 3 from recent #340 work that used manually-set 2026-05-10 timestamps but
  were applied to prod with auto-generated 2026-05-09 timestamps.
- Pulled SQL for 5 remote-only migrations from `supabase_migrations.schema_migrations.statements`
  using `array_to_string(statements, E';\n')` via psql.

**Phase 2 — Prune:**
- 0 files deleted — all 9 local-only migrations have active code refs or open issues.

**Phase 3 — Apply (via `supabase db push --db-url $SUPABASE_DIRECT_SESSION_URL --include-all`):**
- Applied 8 migrations: wave2b_holdings_dividends_db, revoke_handle_new_user_household_exec,
  analyze_batch_results, add_trading_last_synced_at, options_ladder_schema_close,
  household_audit_trail, household_refresh_state, household_invites_schema.
- Remote count: 46 → 54.

**Phase 4 — Deferred:**
- `20260501120000_align_insurance_policies_household_id.sql` deferred. Has `DROP COLUMN user_id`
  + `DELETE FROM insurance_policies WHERE household_id IS NULL`. Awaiting Jony go/no-go.

**Key learnings:**
- See `.squad/decisions/inbox/hockney-335-prune-results.md` → Learnings section.

---

## 2026-05-09 — #340 follow-up: seed 3 canonical accounts

**Scope:** Idempotent migration to pre-create InteractiveBrokers/Schwab/LeumiIRA in trading_account_config.

**Executed:**
- Created `20260510000002_seed_canonical_accounts.sql` — UPSERT logic preserves IBKR connection; seeded Schwab/LeumiIRA with placeholder host/port/client_id.
- Migration applied successfully; 213 stock_positions remain attached to IBKR (account_id=1).
- Backend tests: 456/456 passing (no regressions).
- Commit: `b44a1b8` pushed to origin/main.

---

- All 14 existing backfill tests pass
- Added smoke tests for Phase A.1-A.3 (session decoupling, continue-on-error, resume-from-chunk)

**Key Files:**
- `apps/backend/app/worker/handlers/options_sync.py` — added `_fetch_flex_options_paths()`, updated `run_flex_options_sync()` with `pre_fetched_paths` parameter
- `apps/backend/scripts/backfill_options.py` — refactored chunk loop to fetch→open Session→apply, added `--continue-on-error` and `--resume-from-chunk` flags, added failed-chunk tracking and end-of-run summary
- `apps/backend/scripts/flex_probe.py` — bumped `APP_MAX_RETRIES` default from 5 to 8
- `apps/backend/.env.example` — added retry config docs
- `apps/backend/tests/test_flex_send_request.py` — updated default retry test
- `.squad/skills/two-tier-api-retry/SKILL.md` — captured skill from prior work

**Commits:**
- `fix(backfill): decouple SQLAlchemy Session from Flex fetch (Phase A.1)` — session-lifetime fix
- `feat(backfill): add --continue-on-error and --resume-from-chunk (Phase A.2-A.3)` — resilience flags

**Recommendation to Jony:** Re-run the backfill with these flags as needed:
- Default behavior: abort on first failure (safest for CI)
- `--continue-on-error`: push through all chunks, collect failures, retry later
- `--resume-from-chunk 3`: manually skip first 3 pending chunks (recovery escape hatch)
- Worst-case 1001 patience is now ~50min (up from ~25min)


## Learnings

### 2026-05-09: Migration Drift Reconciliation Patterns

**SUPABASE_DIRECT_SESSION_URL is required for CLI operations.** The transaction-mode
pooler rejects prepared statements used by `supabase migration list --db-url` and
`supabase db push --db-url`. Always use the session-pooler URL (direct session URL) for
Supabase CLI operations, not the transaction-pooler DATABASE_URL.

**Pulling remote-only SQL:** When a migration was applied directly to prod without a
local file, retrieve the SQL from `supabase_migrations.schema_migrations.statements`
(a `text[]` column). Use:
```sql
SELECT array_to_string(statements, E';\n')
FROM supabase_migrations.schema_migrations
WHERE version = '20260504134746';
```
via `psql "$SUPABASE_DIRECT_SESSION_URL"`. Wrap in a header comment noting it was
pulled from production.

**`supabase db push` rejects out-of-order migrations.** If local pending migrations have
timestamps *earlier* than the last remote-applied migration, `db push` aborts with an
error listing the out-of-order files. Rerun with `--include-all` to override.

**Temporary skip trick for deferred migrations:** Rename the file from `*.sql` to
`*.sql.deferred` before `db push`. The CLI skips it (filename doesn't match pattern).
Rename back after the push. Clean and reversible.

**Remote timestamp is canonical.** When a migration was applied to prod, the Supabase
CLI assigns a timestamp in `schema_migrations`. If the local file has a different
timestamp (from manual renaming, merge conflict fixes, etc.), rename the local file to
match the remote timestamp. Remote always wins.

**Watch for #340-style timestamp drift.** When Hockney creates migration files with
manually-set timestamps (e.g., `20260510000001`) but pushes to prod, Supabase auto-
generates a different timestamp (e.g., `20260509180919`). Track this by running
`supabase migration list` immediately after applying — mismatches show as remote-only.

### 2026-05-06: Session-Lifetime Bug Pattern in Long-Running Network Calls

**Context:** When SQLAlchemy Session is opened before a slow network roundtrip (e.g., IBKR Flex API taking ~17min worst-case), Supabase pooler kills idle connections at ~10min. When the network call finally completes (or fails), any attempt to use the Session (e.g., `session.rollback()`) raises `SSL SYSCALL Socket is not connected` — masking the original error.

**Pattern:** Database session lifecycle must NOT span slow external network calls. Best practice: pre-fetch all network data FIRST, then open Session for fast DB writes only.

**Implementation:** Split fetch-then-apply:
1. `fetch_*(...) → data` (no Session, network I/O)
2. `with Session(engine) as session: apply(session, data, ...)` (Session-bound work)

This pattern applies to any DB-backed service that calls slow external APIs (e.g., yfinance, IBKR, AI model inference endpoints). The Session should only be open during actual DB operations, not during network waits.

**Alternative considered but rejected:** DB keepalive pings during long waits. This is fragile (what if keepalive itself fails?) and wasteful (holding a connection open for no reason). Better to not open the connection until you need it.

### 2026-05-06: Chunk-Level Error Handling for Multi-Month Backfills

**Context:** Multi-month backfills are inherently fragile: one chunk failure (e.g., IBKR 1001 throttle, network blip, transient DB issue) aborts the entire run, losing progress on all other chunks.

**Design decision:** Add `--continue-on-error` flag (default: False) that catches chunk-level exceptions, logs them, does NOT mark the chunk complete, and continues to the next chunk. At the end, print a summary of all failures and exit with code 1 if any failed.

**Why default to False:** Preserves current abort-on-first-failure behavior, which is safest for CI and automated runs. Users opt into continue-on-error when they want to push through a multi-month backfill and collect all failures in one run.

**Critical:** Failed chunks MUST NOT be marked complete in the checkpoint. The resume contract is: "checkpoint contains only successfully completed chunks." This way, `--no-resume` or a fresh run will retry failed chunks.

**Exception handling subtlety:** MUST re-raise `KeyboardInterrupt` and `SystemExit` (user interrupts), NOT catch them. The `except Exception:` clause handles application-level errors (FlexProbeError, DB errors, parsing errors), not user/OS signals.

### 2026-05-06: Manual Recovery Escape Hatch with --resume-from-chunk

**Context:** Checkpoint state can become corrupt (JSON parse error, accidental deletion) OR Jony wants to manually skip past a known-bad chunk window (e.g., IBKR data corruption for a specific month, already reported to IBKR). The existing `--no-resume` flag helps (reprocess all chunks) but doesn't let you skip specific chunks.

**Design decision:** Add `--resume-from-chunk N` (1-indexed) that skips the first N **pending** chunks (after checkpoint filtering). This is compatible with `--no-resume`: you can do both together.

**Example:** Jony has 10 chunks (Jan-Oct 2024). Checkpoint says chunks 1-3 are complete. He knows chunk 4 (April 2024) has IBKR data corruption and wants to skip it for now, process 5-10.
- `--resume-from-chunk 2` skips the first 2 **pending** chunks (4 and 5), processes 6-10.
- OR: `--no-resume --resume-from-chunk 4` ignores checkpoint, treats all 10 as pending, skips first 4 (1-4), processes 5-10.

**Why 1-indexed:** Humans count from 1, not 0. CLI flags should be human-readable.

### 2026-05-06: Persistent Failure Log — McManus Data Integrity Mitigation

**Context:** Phase A landed with stderr summary of failed chunks (per `--continue-on-error`), but that's transient — once Jony closes his terminal, the failure list is gone. McManus's data-integrity review (verdict: ⚠️ Safe-with-mitigations) called for a **persistent record** so a future operator (or cron job) can detect and act on gaps without scrolling logs.

**Implementation:**
- Added `FAILURES_FILE = Path(".flex_backfill_failures.json")` alongside `STATE_FILE`
- Write JSON file at end of run IF `--continue-on-error` AND `failed_chunks` non-empty
- **Overwrite behavior:** each run produces a fresh failure list (file represents "last run's failures")
- Delete file if all chunks succeed (so file existence = "last run had failures" signal)
- Don't write on dry-run (consistent with checkpoint gating)

**Schema (JSON):**
```json
{
  "account_key": "U2515365",
  "run_started_at": "2026-05-06T16:37:12Z",
  "run_finished_at": "2026-05-06T17:42:08Z",
  "command_args": ["--start", "2024-06-01", "--end", "2024-12-31", "--chunk-months", "1", "--continue-on-error"],
  "failed_chunks": [
    {
      "chunk_key": "2024-09-01:2024-09-30",
      "window_start": "2024-09-01",
      "window_end": "2024-09-30",
      "error_type": "FlexProbeError",
      "error_message": "SendRequest failed for trades: 1001 throttle persists after 8 retries...",
      "failed_at": "2026-05-06T17:08:42Z"
    }
  ]
}
```

**Operational guidance added to stderr summary:**
```
Failure detail written to .flex_backfill_failures.json

To retry failed chunks: re-run the same command (resume will skip succeeded chunks and retry only the failures).
To inspect: cat .flex_backfill_failures.json | jq .
```

**Tests:** `test_failures_file_written_on_continue_on_error` (3-chunk run, chunk 2 fails, JSON schema verified), `test_failures_file_deleted_when_all_succeed` (seed file from prior run, all succeed, file deleted).

### 2026-05-06: --xml-dir mode for manual Flex backfills

Added third input mode to `backfill_options.py`: read Activity Flex XMLs from a local directory instead of fetching from the live IBKR API. This sidesteps 1001 throttle errors entirely for one-time historical backfills (multi-year date ranges). Daily incremental sync continues to use the live API (small windows, low throttle risk).

**Mechanism:** New `--xml-dir DIR` flag (mutually exclusive with `--synthetic` and `--live`). Script discovers XMLs matching IBKR filename pattern `{accountId}_{accountId}_{YYYYMMDD}_{YYYYMMDD}_AF_{queryId}_{hash}.xml`, parses embedded date ranges from filenames, filters by overlap with the requested backfill window, and feeds them through the existing `parse_flex_files` → upsert pipeline. No network calls, no 1001 throttle, instant processing.

**Implementation:**
- `backfill_options.py`: Added `--xml-dir` CLI argument, validation (directory exists, contains matching XMLs), mutual-exclusion check extended to cover all three modes, conditional sleep skip (no API = no inter-chunk delay), updated docstring with usage examples.
- `options_sync.py`: Threaded `xml_dir` parameter through `_fetch_flex_options_paths` → `_select_flex_source`. Added `_xml_dir_files()` helper: filename pattern regex, date range parsing (strptime), overlap filter (inclusive), sorted deterministic output. Non-matching files logged as warnings (graceful degradation if user drops non-Flex files in directory).

**Verified with manual 2024 Activity Flex export** (full year, 983KB, from IBKR Account Management UI):
- File discovery: 1 file matched window [2024-01-01, 2024-12-31]
- Parse counts: trade_count=827, cash_event_count=1061, position_count=29, leg_count=827
- Test suite: 433 passed (no regressions)

**Redfoot test coverage** (landed in parallel, commits 3f0a678 + ef85440): 4 tests added covering file discovery, date filtering, pattern mismatch handling, and end-to-end dry-run. All pass.

**Operational shape:** Jony places manual XML exports in `reports/activity/` (already gitignored) and runs:
```bash
uv run python scripts/backfill_options.py \
  --start 2022-01-01 --end 2024-12-31 \
  --xml-dir reports/activity \
  --chunk-months 12 --account U2515365
```
No IBKR_FLEX_TOKEN required, no network calls, no throttle risk, idempotent upserts.

### 2026-05-06: Production backfill 2022–2025 (manual XML mode)

Ran the actual production backfill using 4 manually-exported Activity Flex XML files (2022, 2023, 2024, 2025) covering full history for account U2515365. Backfill completed successfully in ~13 minutes with no failures.

**Ingestion results:**
- **3,249 options trades** (460 in 2022, 836 in 2023, 827 in 2024, 1,126 in 2025)
- **5,246 cash events**
- **147 positions** (113 new)
- **3,562 strategy groups** (includes 313 existing 2026 trades)
- **1,262 legs** (849 new)
- **48 monthly metrics** (12 per year × 4 years)

**Row count deltas:**
- options_trades: 994 → 3,562 (+2,568 from backfill)
- options_cash_events: 1,321 → 6,007 (+4,686)
- options_positions: 34 → 147 (+113)
- options_strategy_groups: 994 → 3,562 (+2,568)
- options_legs: 413 → 1,262 (+849)
- options_dashboard_monthly: 13 → 53 (+40)

📌 Team update (2026-05-06): Flex backfill resilience shipped — 4 rounds completed (Phase A session/CLI flags + failure log + --xml-dir mode + production run 2022–2025). Keaton's pre-merge review in flight.

📌 Team update (2026-07-02): Lifecycle classifier fix shipped — Trade Lifecycle Timeline and Roll Efficiency Donut charts were broken because the 2022–2025 IBKR backfill omitted `openCloseIndicator` from the Flex report template. This caused `_event_type_from_open_close(None)` to return `"adjustment"` for all trades, making the strategy grouper classify every trade as an ungrouped singleton with status "open" (3,562/3,562), and leaving `options_roll_events` completely empty.

**Root cause:** IBKR Flex `Trades` section in backfill XML lacked `openCloseIndicator` attribute → "adjustment" event_type fallback → both `_is_open()` / `_is_close()` fail → no groups form → no rolls detected.

**Fix:**
1. `flex_parser.py`: New `_event_type_from_trade_attrs()` function infers event_type via: OCI → notes codes (Ep/Ex/A) → fifoPnlRealized != 0 → default "open"
2. `options_grouping.py`: SQL CASE expressions in `_load_strategy_trades()` apply same inference to existing DB rows at reclassification time
3. `scripts/reclassify_options.py`: One-shot runner for existing backfill data

**Key learnings:**
- IBKR `notes` field codes: `Ep` = Expired, `Ex` = Exercised, `A` = Assignment — use these before PnL inference
- `realized_pnl != 0` is a reliable proxy for "closing trade" in standard FIFO accounting
- `"P"` notes code was found ~50/50 buy/sell split — meaning unconfirmed, NOT used in inference
- Reclassification needs both `compute_options_strategy_groups` AND `compute_options_monthly_metrics` re-run to fix donut chart counts

📌 Team update (2026-05-07): McManus's lifecycle/roll canonical spec now authoritative. Two latent bugs identified: (1) `_status()` misclassifies rolls as "open" — needs net-quantity fix; (2) `classify_roll()` uses wrong field (`realized_pnl` vs. `net_cash_flow`). Fixes documented in `.squad/decisions.md`.

📌 **Team update (2026-05-09):** Migration drift audit (#335) completed — 335-line reconciliation plan awaiting Jony approval. Kujan trimmed docker-compose to worker-only (#337). Redfoot fixed Playwright afterAll() hook placement (#334). Fenster + McManus shipped stacked income chart on /summary (#338).

## 2026-05-09T18:19:36+03:00 — Issue #339 Part A: Dividend Estimations Persistence

**Context:** Users entering historical dividend income on `/dividends/estimations` saw data disappear after refresh.

**Root cause:** No `dividend_estimations` table existed. The page only updated local state via `setHistoricalData(newData)` with no API call.

**Fix:**
- Created `supabase/migrations/20260509151900_dividend_estimations_table.sql`:
  - Table: `dividend_estimations(household_id, year, amount)` with unique constraint on `(household_id, year)`
  - RLS policies: household-scoped read/write using `is_household_member` / `is_household_writer`
  - Indexes on `household_id` and `year` for efficient queries
- Added server actions in `apps/frontend/src/app/dividends/actions.ts`:
  - `getDividendEstimations()`: Fetches all estimations for the user's household
  - `saveDividendEstimations()`: Delete-then-insert pattern for idempotent upsert
- Updated `/dividends/estimations/page.tsx`:
  - Load estimations on mount via `getDividendEstimations()`
  - Save via `saveDividendEstimations()` with loading states and inline error/success alerts

**Outcome:** Estimations now persist across refreshes. Upsert by `(household_id, year)` ensures no duplicates.

**Pattern learned:** Always verify table existence before building CRUD UI. Follow household-scoped RLS pattern with `resolveHouseholdId` helper.

**Paired with:** Fenster (frontend integration) — working as Hockney (backend).

### 2026-05-10: #340 Phase 2 — stock_positions + dividend projection

**Issue:** #340 Phase 2 — trading accounts, stock positions, dividend projection.

#### H1 — stock_positions table + account_type CHECK

Landed migration `20260510000001_add_stock_positions.sql`:
- New `stock_positions` table with extended Flex payload fields (description, sub_category, mark_price, market_value, unrealized_pnl, raw_payload, last_broker_sync_at) beyond Keaton's schema sketch, incorporating McManus's field mapping from the representative STK row.
- Indexes: `(household_id, account_id)`, `(household_id, ticker)`, partial UNIQUE `(account_id, ticker, as_of_date) WHERE source='flex'`.
- Household-scoped RLS matching `options_positions` pattern (is_household_member / is_household_writer).
- `account_type` on `trading_account_config`: discovered existing CHECK constraint `trading_account_config_account_type_check` allowing only `'IBKR'/'SCHWAB'` (uppercase). Dropped it, lowercased existing row (IBKR → ibkr), added new CHECK `IN ('ibkr','schwab','ira')`.
- Updated `TradingAccountType` Python enum to lowercase values + `IRA = "ira"`.
- **Pitfall:** `trading_service.py` compared `config.account_type == "IBKR"` (string literal). Fixed to accept both `'IBKR'` and `'ibkr'` for backward compat.

#### H2 — Manual Position CRUD API

New `apps/backend/app/api/positions.py`:
- `POST /api/accounts/positions` — create `source='manual'`; rejects IBKR accounts (422).
- `PUT /api/accounts/positions/{id}` — partial update (quantity/cost_basis/as_of_date); rejects flex-sourced rows.
- `DELETE /api/accounts/positions/{id}` — hard delete; rejects flex rows (404 if not manual/own household).
- `GET /api/accounts/positions[?account_id=N&as_of_date=D]` — list with JOIN on `trading_account_config`.
- **Pitfall:** FastAPI `status_code=204` with a typed return model raises `AssertionError` at import time. Changed DELETE to return `{"deleted": True}` with status 200.

#### H3 — Flex STK Parser + Handler

**Parser fix** (lines 198–200 bug from McManus):
- Added `FlexStockPosition` Pydantic model with full attribute mapping from representative Flex XML row.
- `parse_flex_files()` now has an `elif assetCategory == "STK" and putCall == ""` branch in the `OpenPositions` section; BOND/CASH rows are excluded by the STK category check.
- `parse_stock_open_position()` helper handles missing symbol/quantity gracefully (returns None with warning log).
- `FlexParseResult` extended with `stock_positions: list[FlexStockPosition]`.
- `_scope_result()` and `_parsed_account_ids()` updated to propagate `stock_positions`.

**Sync handler** (`_sync_stock_positions()` in `options_sync.py`):
- Delete-then-insert keyed on `(household_id, account_id, as_of_date, source='flex')`, same pattern as `options_positions`.
- Called from `run_flex_options_sync()` alongside existing options positions sync.
- Returns row count; added `stock_position_count` to job result.

**Backfill result:** 4 Activity Flex XMLs in `reports/activity/` → 213 rows:
- 2022-12-30: 63 STK positions
- 2023-12-29: 45 STK positions
- 2024-12-31: 51 STK positions
- 2025-12-31: 54 STK positions
(Matches McManus's expected counts exactly.)

**IBKR quirk documented:** `openDateTime` is always empty for STK rows in Activity Flex — only aggregate position quantity and average cost basis are available. Per-lot holding-period data is not possible from this source; documented in `FlexStockPosition` docstring.

#### H4 — GET /api/dividends/projection

- Primary path: `stock_positions JOIN dividend_ticker_data ON ticker`; uses `dividend_rate` (already annualised); subquery selects latest `as_of_date` per `(household, account)` to avoid stale snapshots.
- Response: `{total_annual, source, by_ticker[{ticker, quantity, annual}], by_account[{account_id, name, annual}]}`.
- **#342 regression guard:** when `stock_positions` is empty (no Flex sync yet), falls back to `dividend_positions JOIN dividend_ticker_data`. `source` field signals `'dividend_positions_fallback'` to the client.

#### Learnings

- **FastAPI DELETE + 204:** Using `status_code=204` with any response_model or typed return raises `AssertionError` at app startup — FastAPI forbids body on 204. Use 200 + `{"deleted": True}` for JSON APIs that want to confirm deletion.
- **Postgres ENUM migration difficulty:** `tradingaccounttype` enum with uppercase values needed to change to lowercase + add new value. Rather than `ALTER TYPE ... ADD VALUE` (which would still leave uppercase-lowercase mismatch for existing rows), converted the column to `text` via the existing CHECK constraint migration pattern — drop old CHECK, bulk-update values to lower(), add new CHECK. Much cleaner.
- **Backfill via Supabase tool vs. app script:** The `backfill_options.py` script was slow to produce output (suspected DB connection pooler warm-up latency on the Supabase side). For one-shot backfills, constructing raw SQL INSERT via the Supabase MCP or a minimal Python script against the engine is faster.
- **FlexParseResult immutability + new field:** Adding a field to a `ConfigDict(frozen=True)` Pydantic model requires updating all constructor call sites (`_scope_result`, `_filter_result_by_dates`, `FlexParseResult(...)` in `parse_flex_files`). Missing one causes a Pydantic validation error at runtime. Always grep for all construction sites when adding fields.

---

📌 **Team update (2026-05-09):** #340 API fix was bypassed by frontend; future API work should verify the actual frontend data path before declaring done. Also, `SUPABASE_DIRECT_SESSION_URL` env var now available for tooling and migration ops. Use `psql ... schema_migrations.statements` technique to retrieve remote-applied SQL (see prune results). — Scribe

---

## 2026-05-10 — 📌 Heads-up: McManus Flex Validation Findings for Parser Implementation

**From:** Scribe (consolidating McManus validation work)
**Reference:** `.squad/decisions/inbox/mcmanus-flex-validation.md` (§6 pre-implementation checklist)

**Status:** YTD 2026-01-01→2026-05-08 Flex XML validated. **Stocks (57 positions) + dividend accruals are ingestion-ready NOW** — all required fields present.

**What's blocked:**
- **FII section missing from portal** — but NOT actually blocking STK ingestion. OpenPositions already carries all identifier fields inline (cusip, isin, figi, securityID, listingExchange, issuer). `security_reference` table can be seeded from OpenPositions data without waiting for portal config changes.
- **Bonds + dividend payments:** Blocked on 3–4 portal changes (FII/accruedInterest/assetCategory/fxRateToBase + LBD scope). Stocks can proceed in parallel.

**§6 Pre-Implementation Checklist for your parser:**
1. Symbol parsing for bond maturity encoding (`"AAPL 4 1/4 02/09/47"` → coupon 4.25%, maturity 2047-02-09)
2. CashTransactions routing by `type` field — pattern: when `assetCategory` is missing (current portal config), route transactions by type string:
   - `"Bond Interest Received"` → bond coupon
   - `"Bond Interest Paid"` → (unusual; confirm if appears)
   - `"Dividends"` → equity dividend
   - `"Withholding Tax"` → WHT (route to correct tax category)
   - `"Broker Interest"` → cash interest
   - `"Other Fees"` → expenses
3. External FX rates table for base-currency income summaries (CashTransactions missing `fxRateToBase`)
4. Handle `accruedInterest` field when FII section is enabled (currently empty, but schema will be ready)

**Recommended order (Jony not yet decided on portal changes):**
1. Implement stocks-only parser (v1) — use OpenPositions identifiers directly
2. Add tests for stocks → dividend accruals join
3. Deploy to worker + verify e2e
4. Once Jony enables portal changes: add bonds + CashTransactions type-routing

**Learnings pattern:** CashTransactions type-field routing is the fallback when structured fields are missing. Applies to any broker that sends `type` strings without `assetCategory` metadata.

---

## 2026-05-10 — Flex Pipeline v2: BOND + Dividends Schema & Parser

**Scope:** Implement schema + parser support for IBKR Activity Flex BOND positions, dividend payments, dividend accruals, and security reference table. Unblocks 4 missing target tables from mcmanus-flex-revalidation-2026-05-10.

**Migrations (5):**
- `20260510000100` — extend stock_positions with 8 identifier/cost columns
- `20260510000200` — extend bond_holdings with Flex snapshot columns; DROP NOT NULL on issuer/coupon fields
- `20260510000300` — NEW dividend_payments table (idempotency via UNIQUE source_transaction_id)
- `20260510000400` — NEW dividend_accruals table (window-delete idempotency)
- `20260510000500` — NEW security_reference table (con_id PK, FII precedence upsert)

**Parser changes (flex_parser.py):**
- Added `import re` (oversight — parse_bond_symbol used re without importing it)
- New models: FlexBondPosition, FlexDividendPayment, FlexDividendAccrual, FlexSecurityInfo
- Extended FlexStockPosition + FlexParseResult
- New parse functions: parse_bond_symbol(), parse_bond_open_position(), parse_dividend_payment(), parse_dividend_accrual(), parse_security_info()
- parse_bond_symbol() handles: mixed fractions (4 1/4 → 4.25), fraction-only (3/4 → 0.75), CUSIP suffix, 2/4-digit years

**Sync handler changes (options_sync.py):**
- New: _sync_bond_positions(), _upsert_dividend_payment(), _sync_dividend_accruals(), _upsert_security_reference(), _seed_security_reference_from_positions()
- Updated: _scope_result(), _filter_result_by_dates(), _parsed_account_ids(), _ingest_account(), run_flex_options_sync()
- Fixed: missing `params = {}` initializer in _load_accounts() (broken during refactor)

**Tests:** Created tests/test_flex_bond_parser.py — 21 pass, 4 skip. Full suite: 500 passed (was 479).

**Learnings:**
- Never name a Pydantic field the same as a builtin/imported type. `date: date | None` in FlexDividendAccrual caused `TypeError: unsupported operand type(s) for |: 'NoneType' and 'NoneType'` — Pydantic's annotation evaluator resolves `date` to the field itself (None) in the class namespace. Renamed to `accrual_date`.
- When copying a multi-arg function signature, always verify all call sites match the new signature. `_sync_bond_positions()` had 5 args but was called with 4.
- `from __future__ import annotations` defers annotation evaluation to import time, not class definition time. Field name shadowing only surfaces when Pydantic evaluates the string annotation — not at class body parse time.

**Pending:**
- supabase db push --include-all on production
- Phase 3 backfill script (backfill_flex_v2.py)
- IBKR portal fixes needed: accruedInterest field in BOND rows, FinancialInstrumentInformation section

---

## 2026-05-10 — ✅ Flex Pipeline v2: Parser + 5 Migrations + Phase 3 Backfill (Complete)

**Scope:** Full backend implementation of Flex pipeline v2 to land IBKR Activity Flex BOND positions, dividend payments/accruals, and security reference data.

**Executed:**

**Phase 1 — Parser & Schema (commit f25f05c):**
- 5 migrations: `20260510000100` (extend stock_positions 8 cols), `20260510000200` (bond_holdings Flex upgrade), `20260510000300` (dividend_payments table), `20260510000400` (dividend_accruals), `20260510000500` (security_reference con_id PK).
- Parser: Extended FlexStockPosition with 6 identifier fields. New models: FlexBondPosition, FlexDividendPayment, FlexDividendAccrual, FlexSecurityInfo. New parse functions: parse_bond_symbol(), parse_bond_open_position(), parse_dividend_payment(), parse_dividend_accrual(), parse_security_info().
- parse_bond_symbol() handles: mixed fractions (4 1/4), fraction-only (3/4), CUSIP suffix, 2/4-digit years.
- Sync handler: 5 new sync functions (_sync_bond_positions, _upsert_dividend_payment, _sync_dividend_accruals, _upsert_security_reference, _seed_security_reference_from_positions).
- Tests: 21 pass, 4 skip on master XML. Full suite: 500 passed (was 479).
- **Bug discovered:** Pydantic field name shadowing in FlexDividendAccrual.date (renamed to accrual_date) — avoided TypeError in type annotation evaluation.

**Phase 3 — Backfill (commit eacd8d4):**
- Script: apps/backend/scripts/backfill_flex_v2.py (26 tests, all passing).
- Results: 5,524 dividend_payments + 217 dividend_accruals + 75 security_reference + 18 bond_holdings + 270 stock_positions (identifier cols + cost_basis_total).
- Idempotency verified by running backfill twice; row counts stable.

**Phase 4 — Hotfix (commit 6a808ef):**
- Migration `20260510000600_bond_holdings_add_listing_exchange.sql` — schema/code drift caught during Phase E backfill (listing_exchange missing from bond_holdings schema but referenced in _sync_bond_positions). Column added; 18 bond rows backfilled with listing_exchange from raw_payload.

**Key Learnings:**
1. Backfill from raw_payload does not require re-fetching upstream API. Use idempotency keys per-table (UNIQUE constraints or window-delete strategies).
2. Bond symbol string parser (parse_bond_symbol) is reliable v1 truth before FII portal section is enabled. Handles mixed fractions, decimals, CUSIP suffixes, 2/4-digit years.
3. CashTransaction routing by `type` field (Dividends/WHT/PIL) is robust when assetCategory is missing from portal. 5,524 dividend events routed with zero misclassifications.
4. **Pydantic field name shadowing:** Avoid stdlib type names as model attributes (e.g., use accrual_date instead of date). Shadowing causes TypeError during class construction.
5. **Schema/code drift:** Integration tests must call the actual sync function, not direct SQL INSERT, to catch schema gaps. Caught by Phase E backfill, not by unit tests.

**Pending:**
- supabase db push --include-all on production (Kujan applied 2026-05-10 01:15 UTC).
- Live Flex sync blocked by IBKR error 1001 throttle (Kujan attempted 2026-05-10, 8 retries over 43min failed). Workaround: re-save Flex query in Account Management or wait ~30min.
- Portal fixes needed for full data completeness: accruedInterest (BOND rows), assetCategory/fxRateToBase (CashTransactions). McManus revalidation v2 verdict: YELLOW (7/12 portal items complete; pipeline ready for next sync).

---

## 2026-05-10 — ✅ Bug Fixes: Stale Positions + Bond Infrastructure + Manual Seed Script

**Commits:** `4cbac98`, `c40c0dc`, `64c6cd6` on `main` (direct per Jony's no-PR-ceremony directive)

**Bug 1 — Stale stock positions (FIXED):**
Root cause: `DISTINCT ON (account_id, ticker) ORDER BY as_of_date DESC` resurrects sold tickers from prior snapshots. Fix: `max_flex_snap` CTE (`MAX(as_of_date) GROUP BY account_id`) filters positions to only tickers present in the latest snapshot. Manual positions use separate dedup path. Historical lookup (`as_of_date` param) correctly filters CTE too. Frontend `dedupeLatestSnapshot()` in `apps/frontend/src/app/trading/actions.ts` rewritten with same semantics: compute `latestFlexDateByAccount` per account, skip stale flex rows. Tests added: `test_flex_stale_tickers_excluded_from_latest_snapshot`, `test_flex_and_manual_mixed_accounts_no_cross_contamination` (suite 529→535). Key file: `apps/backend/app/api/positions.py`.

**Bug 2 — Bond data confirmed correct in DB; frontend bugs delegated to Fenster:**
Confirmed via live query: all 18 `bond_holdings` rows have proper CUSIPs (e.g., `91282CHT1`) in `cusip` column — not in `id`. `coupon_rate` is in percentage units (3.875 = 3.875%). Issue date infrastructure is fully in place (column, parser, sync function) but values NULL because IBKR portal FII section is not enabled. No backend code changes needed — blocked on Jony's portal config. Tests added in `test_flex_bond_parser.py`: `TestBondCouponRateStorageConvention` (2 tests), `TestFlexSecurityInfoIssueDate` (2 tests).

**Bug 3 — Manual position entry scaffolded:**
Created `apps/backend/scripts/seed_manual_account_positions.py` + `apps/backend/scripts/sample_manual_positions.csv`. Idempotent DELETE+INSERT keyed on `(account_id, ticker, as_of_date)`. Validates account is non-IBKR. `--dry-run` flag. Accounts already exist in `trading_account_config` (Schwab id=71, LeumiIRA id=72). Jony must supply actual holdings CSV and run with correct `--account-id`.

**Decisions filed:** `hockney-backend-bugs-2026-05-10.md` (processed by Scribe)

---

### 2026-05-10: Manual Stock Positions CRUD API (Hockney-9)

**Commit:** `6adf8e7`
**Date:** 2026-05-10
**Files:** `apps/backend/app/api/positions.py`, `apps/backend/tests/test_manual_crud.py`

Delivered four endpoints for manual account stock position management: `POST /api/accounts/{account_id}/positions`, `PATCH /api/accounts/{account_id}/positions/{position_id}`, `DELETE /api/accounts/{account_id}/positions/{position_id}`, and `POST /api/accounts/{account_id}/positions/import` (CSV bulk refresh). All endpoints block IBKR accounts with 422. CSV import implements DELETE-then-INSERT semantics in a single transaction. 23 new tests; 558 total passing. Contract documented early for parallel Fenster work. API uses `average_cost` in request bodies (maps to DB `cost_basis`); responses surface `cost_basis` for consistency.

## 2026-05-11 — Lowercase Account Type Normalization + Household Backfill Migration

Backend data bug fix: `trading_account_config` rows had NULL `household_id` (RLS invisible) and uppercase `account_type` (constraint violation). Created idempotent migration `20260511052500_backfill_placeholder_account_households.sql` gating on household existence. Code fix: removed `normalizeAccountType()` helper, inline `.toLowerCase()` with constraint comment. Tests: 16 new tests added across Sprint B cycle. Pattern: always normalize before DB save when constraint is lowercase-only.
