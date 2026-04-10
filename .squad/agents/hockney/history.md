# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

### 2026-02-23: Initial Backend Codebase Review

**Findings:**

1. **Critical: Float usage for financial calculations** - All monetary fields (pnl, price, proceeds, taxes, commission) use Python `float` instead of `Decimal`. This violates financial precision requirements and can cause rounding errors in P&L calculations.

2. **Missing input validation** - API endpoints lack Pydantic request/response models. Direct SQLModel use without validation layer increases risk of bad data entering the system.

3. **Insufficient error handling** - Only 5 HTTPException/raise statements found across main API files. Need comprehensive error boundaries for database failures, calculation errors, and invalid state transitions.

4. **Security exposure** - `.env` file contains plaintext credentials (TWS_USERID, TWS_PASSWORD) and is tracked. Should be in `.gitignore` and use secret management.

5. **CORS wide open** - `allow_origins=["*"]` in production is a security risk for financial data APIs.

6. **Limited test coverage** - Only 10 test files found. Critical financial calculation logic (trade PnL, daily summaries, portfolio metrics) needs comprehensive unit tests with known expected values.

7. **Database table creation disabled** - `create_db_and_tables()` is a no-op. Relying solely on Alembic migrations is correct but startup code is misleading.

8. **Logging inconsistency** - Only 12 files use proper logging. Need structured logging across all API routes and service layers for audit trail.

**Positive aspects:**
- Good migration history with 19 Alembic versions showing iterative schema evolution
- Proper OpenTelemetry instrumentation setup for observability
- SQLModel/SQLAlchemy patterns are generally sound
- Service layer separation exists (data_ingestion, dividend_service, etc.)

**Immediate recommendations:**
1. Replace all `float` with `Decimal` for monetary fields
2. Add Pydantic validation schemas for all endpoints
3. Implement comprehensive error handling strategy
4. Remove `.env` from tracking, add to `.gitignore`
5. Restrict CORS to known frontend origins
6. Add test coverage for all financial calculations

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety consolidated - Critical: both frontend and backend use unsafe numeric types. Quality gate established: all PRs must use Decimal/BigNumber for monetary operations. Estimated 1-2 weeks for migration. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL findings: credentials in git, no auth, unrestricted CORS. Week 1: rotate credentials, JWT auth, restrict CORS, security headers. Application blocked from production in current state. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** Testing and Quality - Backend lacks comprehensive financial calculation tests. Need pytest suite with known test cases for trade PnL, daily summaries, portfolio metrics. GitHub Actions CI/CD pipeline required. — Fenster, Hockney, Keaton

### 2025-07-18: Company Analysis API Router Built

**What was built:**
Created `apps/backend/app/api/analyze.py` with all 5 endpoints for the Analyze page:

1. `GET /api/analyze/fundamentals/{ticker}` — Full fundamentals with ROIC, WACC, CAGR, valuation multiples, DCF inputs. Uses McManus's scorecard, valuation, and DCF service functions.
2. `GET /api/analyze/price-history/{ticker}` — OHLCV data with configurable period/interval via query params.
3. `GET /api/analyze/technicals/{ticker}` — 6-month daily data run through EMA, RSI, MACD, Bollinger, support/resistance. Returns latest scalar values matching the architecture contract.
4. `GET /api/analyze/options/{ticker}` — Option chain with IV percentile/rank. ATM IV used as current IV reference against chain distribution.
5. `GET /api/analyze/synthesis/{ticker}` — Phase 1 template-based synthesis. Derives growth_engine, bear_case, and price_action_summary from yfinance info fields. No LLM dependency.

**Integration:**
- Registered in `main.py` alongside existing routers (import + include_router).
- Router uses `/api/analyze` prefix with "analyze" tag.
- All endpoints use `try/except` around yfinance calls with appropriate HTTP error codes (404, 502).

**Design decisions:**
- ROIC/WACC calculations extract raw data from yfinance DataFrames (Operating Income, Tax Provision, etc.) and feed McManus's pure functions. Tax rate is computed dynamically from Pretax Income / Tax Provision.
- WACC uses CAPM for cost of equity (risk-free + beta × market premium) since yfinance doesn't provide WACC directly.
- Technicals endpoint returns latest scalar values (not full arrays) to match the architecture contract's response shape.
- IV percentile/rank uses the current option chain's IV distribution as a proxy since yfinance doesn't provide historical IV time series. This is a known approximation — noted for Phase 2 improvement.
- Synthesis endpoint uses conditional template logic based on financial ratios, not hardcoded text.

**Dependencies on McManus's services:**
- `calculate_roic`, `calculate_wacc`, `calculate_cagr`, `calculate_net_debt_to_ebitda` from scorecard
- `calculate_forward_pe`, `calculate_peg_ratio`, `calculate_ev_fcf` from valuation
- `calculate_ema`, `calculate_rsi`, `calculate_macd`, `calculate_bollinger_bands`, `detect_support_resistance` from technicals
- `calculate_iv_percentile`, `calculate_iv_rank` from options_analytics

### 2026-03-05: yfinance Caching Layer (Issue #7)

**What was built:**
Created `apps/backend/app/services/cache.py` — thread-safe in-memory TTL cache using `cachetools.TTLCache`. Four cache types with different TTLs:
- `price`: 100 entries, 5-min TTL
- `fundamentals`: 50 entries, 1-hour TTL
- `technicals`: 100 entries, 5-min TTL
- `options`: 50 entries, 5-min TTL

Updated `apps/backend/app/api/analyze.py` to wrap all 4 yfinance-backed endpoints with cache check/store logic. Added `X-Cache: HIT/MISS` and `Cache-Control` response headers. Added `GET /api/analyze/cache-stats` monitoring endpoint.

**Design decisions:**
- Used `threading.Lock` for thread safety since yfinance calls are sync and may run in FastAPI's threadpool executor
- Cache key format varies by endpoint: ticker-only for fundamentals/technicals, `ticker:period:interval` for price-history, `ticker:expiry` for options
- Returns `JSONResponse` instead of raw dict when cache is involved, to set custom headers
- Hit/miss counters are tracked per cache type for observability
- Cache stats endpoint is unauthenticated (monitoring use case) — should be locked down when auth is added

**PR:** #14 (draft)
**Branch:** `squad/7-yfinance-cache`
**Dependency added:** `cachetools>=5.5.0`

### 2026-03-06: analyze Router Registration Commit (f81ec80)

**What was done:**
- Registered the `analyze` router in `main.py` — added import and `app.include_router(analyze.router)` call
- Fix addresses 404 errors on `/analyze` page that were due to router not being attached to the FastAPI app
- Commit f81ec80 landed on squad/4 branch

**Impact:**
- `/analyze` page now routes correctly to backend endpoints
- All 5 analyze endpoints (fundamentals, price-history, technicals, options, synthesis) now accessible
- Backend ready for E2E testing

**Cross-team:** Redfoot proceeded to write E2E tests once this fix was in place.

### 2026-03-07: Stable Pension Identity Flow

**What changed:**
- Reworked `apps/backend/app/api/pension.py` so pension uploads derive a stable identity from owner + product + account/fund metadata and carry it through snapshot storage, plan items, dashboard series ids, and delete operations.
- Dashboard responses now emit only the latest active pension identities, which keeps deleted products out of the table/chart while still allowing historical snapshots to exist in storage.
- Added regression coverage in `apps/backend/tests/test_pension_api.py` for multi-product uploads, stable identifiers, dashboard payload filtering, and delete-by-identity behavior.

**Patterns / decisions:**
- For JSON-backed finance assets, use a stable id derived from business identity rather than random UUIDs when the same logical account must survive snapshot cloning, UI refreshes, and deletes.
- When a dashboard is meant to represent current holdings, build its active account list from the latest snapshot first, then backfill history only for those active series ids.
- Keep pension product metadata (`pension_product`, `pension_fund_name`, `account_number`) in `details` so frontend display and future migrations do not need to reverse-engineer names.

**Key paths:**
- `apps/backend/app/api/pension.py`
- `apps/backend/app/utils/copilot_analyzer.py`
- `apps/backend/tests/test_pension_api.py`

### 2025-07-19: Pension Upload Bug Fixes (Latest Snapshot + Hebrew RTL)

**What was fixed:**

1. **Bug 1 — Pension parsed but invisible on dashboard:** The upload endpoint only upserted into the report-date snapshot. If later snapshots existed, the dashboard (which reads `snapshots[-1]`) never saw the pension. Fix: after upserting into the report-date snapshot, also propagate the pension into the latest snapshot when the dates differ. Historical data preserved at the correct date; dashboard shows it immediately.

2. **Bug 2 — Complementary pension uploaded with 0 ILS:** Hebrew RTL text extraction via pdfplumber garbled keywords, causing the AI model to return null for Total Amount. Fix: expanded the copilot_analyzer system prompt with detailed RTL handling instructions—reverse-reading guidance, common Hebrew financial keywords, heuristic to pick the largest number as balance, and a self-validation step (if sub-fields are non-zero but total is 0, re-examine). Also added `_validate_pension_payload()` in pension.py that logs warnings and returns them in the upload response when total is 0 but sub-fields are not.

**Patterns / decisions:**
- Upload endpoints for time-series data should always propagate to the "current" record so dashboards reflect changes immediately, not just to the historical slot.
- AI analyzer prompts for Hebrew PDFs need explicit RTL reversal guidance and numeric-heuristic fallbacks.
- Zero-value detection with warning propagation to the API response gives the frontend a chance to alert the user without silently losing data.

**Key paths:**
- `apps/backend/app/api/pension.py` — upload endpoint, `_validate_pension_payload()`
- `apps/backend/app/utils/copilot_analyzer.py` — Hebrew RTL prompt improvements
- `apps/backend/tests/test_pension_api.py` — 3 new regression tests

📌 **Team update (2026-03-07T20:18:16Z):** Pension upload bugs fixed — snapshot propagation for dashboard visibility + Hebrew RTL analyzer prompt + zero-value validation. All 17 tests passing. — Hockney, Redfoot

### 2025-07-21: Deterministic Table Extraction for Pension PDFs

**What was built:**
Added `_extract_from_tables()` to `apps/backend/app/utils/copilot_analyzer.py` — a deterministic, zero-AI-cost extraction path for Clal-style pension PDFs. The function uses pdfplumber's table extraction (which works perfectly even with Hebrew RTL) to parse TABLE 2 (financial summary) by matching reversed Hebrew keyword labels.

**How it works:**
1. `analyze_report()` now calls `_extract_from_tables()` FIRST.
2. If deterministic extraction returns a valid result (total > 0), it's returned immediately — no AI call.
3. If it fails (no tables, unrecognised structure, zero total), falls back to existing Copilot SDK AI analysis.
4. Logging indicates which path was taken.

**Key patterns:**
- Hebrew RTL text from pdfplumber has reversed word order but numbers are intact. Table cells have the number in column 0 and the Hebrew label in column 1.
- Name is extracted from page text using regex between `:ז.ת רפסמ` and `:תימעה םש` patterns, then reversed word-by-word.
- Product type detected by searching title area for `המילשמ` (comp) vs `הפיקמ` (comprehensive) vs `למג` (gemel).
- Earnings+fees row has both values separated by `\n` in one cell — split and take absolute value for fees.
- Monthly deposits = YTD deposits / report month number.
- Insurance fees = sum of disability + death insurance (absolute values).

**Verified against:**
- `sample/reports/Jony/Report_03_2025-comp.pdf` → 800,545 ILS (פנסיה משלימה)
- `sample/reports/Jony/Report_03_2025.pdf` → 1,194,873 ILS (פנסיה מקיפה)

**Key paths:**
- `apps/backend/app/utils/copilot_analyzer.py` — `_extract_from_tables()`, modified `analyze_report()`

📌 **Team update (2026-03-07T20:59:37Z):** Deterministic table extraction implemented and tested. `_extract_from_tables()` reliably parses Clal pension PDFs (800,545 ILS comp, 1,194,873 ILS main). AI fallback preserved. 21 tests total, all passing. Non-breaking change. — Hockney, Redfoot

### 2026-03-07: Pension Reclassification to Savings

**What changed:**
Reclassified Israeli pension accounts from `category: "Investments"` to `category: "Savings"` with `draw_income: true` and `max_withdrawal_rate: 0`. Israeli pensions are savings vehicles that convert to monthly income payments at retirement age — you cannot withdraw from them before retirement.

**Changes in `apps/backend/app/api/pension.py`:**

1. **`extract_pension_payload()` (line 161):** Changed category from "Investments" to "Savings"
2. **`extract_pension_payload()` (line 168):** Added `max_withdrawal_rate: 0` to prevent withdrawals
3. **`extract_pension_payload()` (line 182):** Added `draw_income: True` to details dict for plan editor display
4. **`upsert_plan_pension()` (line 381):** Added `draw_income: True` to account_settings for new plan items

**Verification:**
- `_recalculate_snapshot()` correctly sums by category string — pensions now contribute to `total_savings` instead of `total_investments`
- `upsert_snapshot_pension()` filters by `type == "Pension"` (category-independent) — works correctly
- `_latest_active_pensions()` filters by `type == "Pension"` (category-independent) — works correctly
- All 21 tests pass without modification — tests were already written in a category-agnostic way

**Key insight:**
The codebase was already architected for this change. All pension-specific logic uses `type == "Pension"` filtering rather than category filtering, which made the reclassification seamless. The `_recalculate_snapshot()` function automatically moves pension values from the investments bucket to the savings bucket based on the category field.

**Key paths:**
- `apps/backend/app/api/pension.py` — pension data extraction and storage

📌 Team update (2026-03-07T21:49:50Z): Pension category reclassification completed and merged across team. Backend, frontend, and testing layers verified. All 26 tests passing. Category-agnostic architecture documented for future reorganizations. — Scribe (Team Orchestration)

### 2025-07-21: Pension Data Migration (Investments → Savings)

**What was built:**
Added `migrate_pensions_to_savings()` to `apps/backend/app/api/pension.py` — an idempotent migration function that fixes existing pension data in the database after the category reclassification from "Investments" to "Savings".

**How it works:**
1. Scans all `FinanceSnapshot` rows and reclassifies pension items from `category: "Investments"` to `category: "Savings"`
2. Backfills `draw_income: True` in `details` and `max_withdrawal_rate: 0` on pension items missing these fields
3. Recalculates snapshot totals (`total_savings`, `total_investments`, `total_assets`) after migration
4. Scans `Plan` table and backfills `draw_income: True` in `account_settings` for pension plan items
5. Runs automatically at app startup via the lifespan hook in `main.py`
6. Fully idempotent — safe to run on every startup, only modifies items that need changes

**Key patterns:**
- Startup migrations should be idempotent and check-before-modify to avoid unnecessary writes
- The `flag_modified(snapshot, "data")` call is required for SQLAlchemy to detect JSON column mutations
- Reuses `_recalculate_snapshot()` to keep totals consistent after category changes

### 2026-04-10: Backend Financial Core Testing Sprint (Week 1)

**Context:** Implemented P0 testing tasks from approved testing plan to establish comprehensive test coverage for financial calculation utilities.

**Work Completed:**

1. **Task 1: conftest.py Infrastructure (1 hour)** ✅
   - Created shared test fixtures in `apps/backend/tests/conftest.py`:
     - `engine` fixture: SQLite in-memory with StaticPool for test isolation
     - `session` fixture: SQLModel Session with auto-rollback
     - `client` fixture: Sync TestClient with dependency injection override
     - `async_client` fixture: HTTPX AsyncClient for async endpoint testing
   - Created `tests/fixtures/` directory for future test data
   - Verified all 94 existing tests still pass after infrastructure changes

2. **Task 2: test_currency.py (2 hours)** ✅
   - 24 comprehensive tests for `app/utils/currency.py`
   - Coverage areas: Known conversions (ILS, USD, EUR, ILA), round-trip consistency, edge cases
   - Key insight: ILA (Agorot) uses rate 0.01 relative to ILS base

3. **Task 3: test_bond_cashflows.py (3 hours)** ✅
   - 20 comprehensive tests for `app/utils/bond_cashflows.py`
   - Coverage areas: Coupon frequencies, date arithmetic, cashflow generation, bond ladder integration
   - Critical finding: Loop uses `payment_date < maturity_date`, final coupon at maturity not in loop

4. **Task 4: test_trade_matcher.py (3 hours)** ✅
   - 13 comprehensive tests for `app/utils/trade_matcher.py`
   - Coverage areas: FIFO matching, short positions, P&L validation, edge cases
   - Algorithm insight: FIFO via chronological sorting, matches first open with first close

**Testing Metrics:**
- Tests before: 95 (94 passing, 1 pre-existing failure)
- Tests added: 57 new tests (24 + 20 + 13)
- Tests after: 138 total (137 passing, same 1 pre-existing failure)

**Branch:** `squad/testing-backend-financial-core`

**Learnings:**
- Hardcoded FX rates in currency.py are temporary - need real-time rate integration
- Trade matcher only handles exact quantity matches - may need partial fill logic
- All financial calculations preserve decimal precision in tests, but underlying code still uses float

📌 **Financial testing foundation established.** Core utility modules now have comprehensive test coverage with known expected values.

**Tests added (4 new, 30 total):**
- `test_migrate_reclassifies_legacy_pension_items` — verifies category change, draw_income, max_withdrawal_rate, and recalculated totals
- `test_migrate_is_idempotent` — second run produces zero changes
- `test_migrate_backfills_plan_draw_income` — plan account_settings get draw_income
- `test_migrate_skips_already_correct_data` — correctly-classified items untouched

**Key paths:**
- `apps/backend/app/api/pension.py` — `migrate_pensions_to_savings()`
- `apps/backend/main.py` — lifespan startup hook
- `apps/backend/tests/test_pension_api.py` — migration tests
