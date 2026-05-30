# Hockney History Archive (2026-05-30)

**Archived:** 2026-05-30T07:57:13Z (34,045 bytes → archived, new file created)

**Contents:** Full session notes from 2026-05-19 through 2026-05-30.

## Summary Index

### Credit-Card Expense Pipeline (CC-2 through CC-14)

- **CC-2 Parser Architecture (2026-05-28):** 4 PDF formats (Cal/CalPayBox/Max/Isracard), Hebrew RTL handling, pdfplumber integration, 39-test scenario catalog. Key: each issuer has distinct statement layout; regex-based field extraction with fallback to visual coordinates.

- **CC-4 Route Handlers & Supabase (2026-05-28):** FastAPI endpoints (`GET /categories`, `GET /unresolved`, `POST /resolve`, `GET /monthly-summary`, `GET /by-category`), Supabase DBMS auth pattern (`user_id: UUID = Depends(get_current_user_id)`), household scoping (explicit `_require_household` call + WHERE filter, not RLS alone).

- **CC-5 Inbox Scanner Worker (2026-05-29):** APScheduler 60s job, two-phase DB transactions (status='processing' survives Phase 2 failure), thread-safe locks (`threading.Lock(blocking=False)`), `shutil.move` for cross-device safety, 350 lines, 63 tests pass.

- **CC-11 Worker Implementation & Fixes (2026-05-28 + Follow-up):** Thread-safe parser timeout (`concurrent.futures.ThreadPoolExecutor` replacing SIGALRM), Docker volume mount for inbox, all 63 tests passing. **Commit:** `12aeb4b` (timeout fix), `462afc9` (docker mount).

- **CC-12 Security Review (2026-05-29):** Auth dependency pattern, household scoping explicit, Decimal→float serialization, cross-DB month grouping (`func.substr(cast(col, String), 1, 7)`), rate-limit gap (no slowapi, tracked in CC-13 TODO), atomic UPSERT pattern, mapping poisoning guard, seeded_session slug_map keys.

- **CC-14 Backfill Completion (2026-05-29):** 30/30 PDFs ingested (0 errors), 407 transactions, 4 issuers, 4 cardholders. Key learnings: `expense_inbox_file_hash_unique` dedup crash (skip DB insert for duplicates, move file only), `expense_categories` must be seeded before rules run (McManus/Keaton prerequisite), CalPayBox statement dates return 0001-01-01 (non-blocking, file with McManus), transfers tagged as `resolution_status='transfer'`, Hebrew merchants stored RTL-reversed (expected, display layer reverses for UI), Docker source code not volume-mounted (patching host has no effect until rebuild).

### RSU Automation (2026-05-27)

- **RSU Pricing Pipeline:** `price_cache` + `dividend_yield` decimal fraction, yfinance integration, nightly worker, API endpoint `GET /price-data/{symbol}`, MSFT/WIX support, zero-yield handling. Key: `price_cache` is separate from `stock_positions`; never mix them. **Decision:** `.squad/decisions/inbox/hockney-rsu-pricing.md` (merged).

- **RSU Yield Units Normalization:** Percentage form convention (0.87 = 0.87%), `_yfinance_yield_to_percent()` normalization at yfinance boundary, data migration `f2a3b4c5d6e7` (idempotent, multiplies 0 < x < 1 only). **Decision:** `.squad/decisions/inbox/hockney-rsu-yield-units.md` (merged).

### Diagnostics (2026-05-19)

- **Flex Query Worker:** Two decoupled sync paths (`trading_account_config.last_synced` vs. `options_flex_sync_state.last_sync_at`), orphaned E2E test row (`E2E_TRADING_*` with stale `household_id`) caused 7 silent failures, APScheduler logs but doesn't alert (recommend GitHub-issue pattern like nightly-backup), Flex API succeeds but local DB write fails (health check: query IBKR Flex API directly), `IBKR_FLEX_TOKEN` missing from docker-compose.backend.yml (passed via `.env` auto-read, should document in `.env.example`).

## Key Files Modified

Core CC pipeline (500+ lines):
- `apps/backend/app/api/expenses.py` (5 endpoints, ~350 lines)
- `apps/backend/app/worker/expenses_inbox.py` (350 lines)
- `apps/backend/app/worker/rsu_plan_hydration.py` (RSU hydration, ~150 lines)
- `apps/backend/app/services/price_cache.py` (pricing + yield normalization)

Migrations:
- `apps/backend/alembic/versions/e5f6a7b8c9d0_add_dividend_yield_to_price_cache.py`
- `apps/backend/alembic/versions/f2a3b4c5d6e7_normalize_price_cache_yield_to_percent.py`

Docker:
- `docker-compose.backend.yml` (add credit-card inbox volume mount)

Frontend:
- `apps/frontend/src/app/finances/expenses/_components/CategoryPicker.tsx` (dynamic category fetch)

Tests: 100+ new tests, all passing.

## Key Decisions

- RSU business rules hard-coded (25% tax, Payout policy, not configurable)
- Decimal precision: percentage form in `price_cache` + plan JSON; decimal fraction in `stock_positions` (separate domain)
- Static frontend category data goes stale → dynamic fetch pattern established
- APScheduler thread-pool jobs require thread-safe timeouts (not SIGALRM)
- Two-phase DB commits ensure partial success doesn't lose data

## Open Questions / Follow-ups

- ~~Yield units mismatch~~ (resolved via normalization boundary + data migration)
- Rate-limit gap (CC-13 TODO, slowapi not in codebase)
- Statement header date extraction for CalPayBox/supplementary Cal PDFs (file with McManus)
- E2E test cleanup in teardown + join guard in `_load_accounts()` (Flex Query follow-up)
