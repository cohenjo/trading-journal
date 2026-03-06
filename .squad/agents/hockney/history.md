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
