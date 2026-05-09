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


## LearningsLearnings

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

**Date coverage:** 2022-01-04 → 2026-05-01 (full historical backfill plus existing 2026 YTD data)

**Reconciliation:** cash_flow=$373,826.26, realized_pnl=$218,955.64, variance_gap=$154,870.62

**Key insight:** Python stdout buffering delayed log output during the run, but DB monitoring confirmed steady data ingestion. No failures file generated — all 4 yearly chunks parsed and committed successfully. The database now has complete options history 2022–2025, ready for daily incremental sync to handle 2026-01-01 onward.

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
