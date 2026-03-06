### 2026-02-23T22:46:19Z: Squad team initialized
**By:** Squad (Coordinator)
**What:** Initialized the squad roster, routing, casting registry/history, and per-agent charter/history files for this repository.
**Why:** Establish a persistent operating team for coordinated multi-agent delivery.

### 2026-02-23T22:46:19Z: Casting universe selected
**By:** Squad (Coordinator)
**What:** Persistent cast uses The Usual Suspects naming with Scribe and Ralph exempt from casting.
**Why:** Keep stable memorable identifiers while preserving deterministic squad identity.

### 2026-02-23T23:00:00Z: Financial Precision and Type Safety (consolidated)
**By:** Fenster, Hockney
**Category:** Financial Accuracy, Data Integrity
**Status:** Requires Action

**What:** Critical finding across both frontend and backend: financial calculations lack proper precision handling.
- Frontend: All 53 components use native JavaScript numbers; no Decimal or BigNumber types found
- Backend: All 48 monetary fields in SQLModel use Python float type for prices, trades, PnL, commissions

**Why:** Floating-point arithmetic causes cumulative rounding errors in portfolio calculations. For a trading application, this is mission-critical and violates financial data integrity principles. Native numbers cannot reliably represent decimal monetary values.

**Recommendation:** 
1. Add `decimal.js` or `bignumber.js` to frontend; refactor all financial operations
2. Migrate backend monetary fields to Python `Decimal` type (requires Alembic migration and API contract updates)
3. Add TypeScript interfaces for all API responses to improve type safety
4. Establish quality gate: all PRs must use Decimal/BigNumber for monetary calculations (no float arithmetic)

**Impact:** Breaking change for backend API; additive for frontend. Estimated 1-2 weeks implementation.

### 2026-02-23T23:00:00Z: Security Hardening (consolidated)
**By:** Keaton, Hockney, Rabin
**Category:** Security, Authentication, Production Readiness
**Status:** CRITICAL - Blocks Production Deployment

**Critical Issues Identified:**
1. **Credentials Exposed** - .env file contains plaintext IB credentials and DB passwords in version control (complete account compromise risk)
2. **No Authentication** - All 17 API endpoints lack authentication; anyone with network access can view/modify/delete financial data
3. **Unrestricted CORS** - allow_origins=["*"] enables CSRF attacks and data exfiltration
4. **Missing Security Headers** - No CSP, X-Frame-Options, X-Content-Type-Options, HSTS
5. **Insecure Data Storage** - Financial settings in browser localStorage without encryption

**Immediate Actions (Week 1):**
- Rotate all exposed credentials immediately
- Remove .env from git history using git filter-repo or BFG Repo-Cleaner
- Implement JWT-based authentication with bcrypt password hashing
- Restrict CORS to specific origins only (localhost:3000 for dev, production domain)
- Add security headers middleware
- Remove database credentials from code (fail fast if not configured)

**Follow-up Actions (Week 2-3):**
- Implement rate limiting on API endpoints
- Add comprehensive input validation for financial endpoints
- Audit SQL construction for injection risks
- Encrypt or move sensitive settings from localStorage to backend
- Implement audit logging for financial operations
- Validate file upload endpoints (type, size, malware scanning)

**Risk Assessment:** Application should NOT be deployed to production in current state. Estimated 2-3 weeks to production-ready with dedicated effort.

### 2026-02-23T23:00:00Z: Testing and Quality Assurance (consolidated)
**By:** Fenster, Hockney, Keaton
**Category:** Quality, Testing, CI/CD
**Status:** Requires Action

**Issues:**
- Frontend: Zero test files found (no .test.ts/.test.tsx/.spec.ts/.spec.tsx)
- Backend: Only 10 test files; no visible tests for core financial calculations (trade PnL, daily summaries)
- No CI/CD pipeline: only Squad workflows present, no automated lint/test/build on PR

**What:** Establish testing infrastructure and automated quality gates.

**Recommendations:**
1. Set up React Testing Library for frontend with vitest or Jest
2. Create comprehensive pytest suite for backend financial calculations
3. Add GitHub Actions workflows for lint/test/build on every PR
4. Establish quality gates: all PRs must pass tests, maintain >85% coverage on financial logic
5. Test data import validation, error handling, edge cases

**Timeline:** 1-2 weeks for initial setup; ongoing as part of development workflow.

### 2026-02-23T23:00:00Z: API Documentation and DevOps (consolidated)
**By:** Keaton
**Category:** Documentation, Developer Experience, DevOps
**Status:** Requires Action

**Issues:**
- FastAPI application lacks OpenAPI documentation generation
- No documented authentication strategy or rate limiting approach
- Missing CI/CD pipeline and automated deployment workflow

**What:** Enable API documentation and establish production deployment practices.

**Recommendations:**
1. Enable FastAPI's built-in OpenAPI docs endpoint in main.py
2. Create security.md documenting current authentication strategy and implementation roadmap
3. Add GitHub Actions workflows for CI/CD (lint, test, build, deploy)
4. Document CORS configuration and environment-specific secrets management
5. Create deployment runbook for production hardening checklist

**Priority:** High - Required before production deployment.
# Architecture Decision: Company Analysis Page ("Split-Brain" View)

**Author:** Keaton (Lead)
**Date:** 2025-07-18
**Status:** Proposed
**Requested by:** Jony Vesterman Cohen

---

## 1. Route Path

**Route:** `/analyze`
**App Router path:** `apps/frontend/src/app/analyze/page.tsx`

**Rationale:** `/analyze` is short, action-oriented, and avoids collision with existing routes (`/trading/*`, `/options`, `/backtest`). It sits at the top level like other trading tools (`/options`, `/ladder`, `/holdings`) rather than nested under `/trading/` — consistent with how the app routes standalone tool pages. The page is about *analyzing a company*, not managing trades, so it deserves its own namespace.

**Alternative considered:** `/trading/analyze` — rejected because existing TRADING-section pages like `/options`, `/ladder`, `/holdings` already use top-level paths.

---

## 2. Page Component Structure

```
apps/frontend/src/components/Analyze/
├── AnalyzePage.tsx              # Page shell: ticker search bar + Split-Brain toggle
├── SplitBrainToggle.tsx         # Toggle between "Long-Term" and "Short-Term" views
├── TickerSearch.tsx              # Autocomplete ticker input (debounced API call)
│
├── longterm/
│   ├── LongTermView.tsx         # Container for all Long-Term panes
│   ├── PriceChartWithFairValue.tsx  # 1Y/5Y line chart + DCF fair-value overlay
│   ├── AISynthesis.tsx          # "Growth Engine" + "Bear Case" bulleted lists
│   ├── FinancialScorecard.tsx   # ROIC vs WACC, Revenue/FCF CAGR, Net Debt/EBITDA
│   ├── ValuationBenchmarks.tsx  # Forward P/E, PEG, EV/FCF display cards
│   └── DCFCalculator.tsx        # Interactive sliders → recalculates fair value live
│
├── shortterm/
│   ├── ShortTermView.tsx        # Container for all Short-Term panes
│   ├── CandlestickChart.tsx     # 1M candlestick + EMA 50/200 + Bollinger + volume
│   ├── MomentumPanel.tsx        # RSI + MACD indicators
│   ├── AIPriceAction.tsx        # "Current Support", "Setup Quality" summary
│   ├── OptionChainSnapshot.tsx  # IV Percentile, IV Rank table
│   └── BreakevenVisualizer.tsx  # Price vs Strike vs Breakeven visual
│
└── hooks/
    ├── useCompanyFundamentals.ts  # Fetch + cache fundamentals data
    ├── usePriceHistory.ts         # Fetch OHLCV data for charts
    ├── useOptionChain.ts          # Fetch options chain data
    └── useDCFCalculator.ts        # Client-side DCF recalculation on slider change
```

**Key design decisions:**
- `SplitBrainToggle` uses React state (not URL params) — both views share the same ticker context, switching is instant
- Chart components follow the `OptionsChart.tsx` pattern: `useRef` + `useEffect` with `createChart` from lightweight-charts
- DCF Calculator does client-side recalculation via `useDCFCalculator` hook — sliders call a pure function, no API round-trip needed
- Each view is lazy-loaded with `React.lazy()` to avoid loading Short-Term chart code when in Long-Term mode

---

## 3. API Contracts

All endpoints under prefix `/api/analyze`. New router file: `apps/backend/app/api/analyze.py`.

### 3.1 Company Fundamentals

```
GET /api/analyze/fundamentals/{ticker}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "market_cap": 3200000000000,
  "currency": "USD",
  "financials": {
    "roic": 0.562,
    "wacc": 0.098,
    "revenue_cagr_5y": 0.082,
    "fcf_cagr_5y": 0.115,
    "net_debt_ebitda": 0.42,
    "forward_pe": 28.5,
    "peg_ratio": 2.1,
    "ev_fcf": 25.3,
    "trailing_eps": 6.42,
    "forward_eps": 7.10,
    "dividend_yield": 0.0055
  },
  "dcf_inputs": {
    "current_fcf": 110000000000,
    "shares_outstanding": 15400000000,
    "growth_rate_default": 0.08,
    "discount_rate_default": 0.10,
    "terminal_growth": 0.025,
    "projection_years": 10
  }
}
```

**Source:** yfinance `ticker.info`, `ticker.financials`, `ticker.cashflow`, `ticker.balance_sheet`

### 3.2 Price History

```
GET /api/analyze/price-history/{ticker}?period={1y|5y|1mo}&interval={1d|1wk}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "period": "1y",
  "interval": "1d",
  "data": [
    {
      "time": "2024-07-18",
      "open": 178.50,
      "high": 182.30,
      "low": 177.80,
      "close": 181.20,
      "volume": 52340000
    }
  ]
}
```

**Source:** yfinance `ticker.history(period, interval)`

### 3.3 Technical Indicators

```
GET /api/analyze/technicals/{ticker}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "as_of": "2025-07-18",
  "indicators": {
    "ema_50": 179.30,
    "ema_200": 172.15,
    "rsi_14": 62.5,
    "macd": {
      "macd_line": 2.45,
      "signal_line": 1.80,
      "histogram": 0.65
    },
    "bollinger": {
      "upper": 188.50,
      "middle": 181.20,
      "lower": 173.90,
      "bandwidth": 0.081
    }
  },
  "support_resistance": {
    "support_1": 175.00,
    "resistance_1": 190.00,
    "trend": "bullish"
  }
}
```

**Source:** Calculated server-side from yfinance OHLCV using standard TA formulas (EMA, RSI, MACD, Bollinger Bands)

### 3.4 Option Chain

```
GET /api/analyze/options/{ticker}?expiry={YYYY-MM-DD}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "current_price": 181.20,
  "expirations": ["2025-07-25", "2025-08-01", "2025-08-15"],
  "selected_expiry": "2025-07-25",
  "iv_percentile": 32.5,
  "iv_rank": 28.1,
  "calls": [
    {
      "strike": 180.0,
      "bid": 3.20,
      "ask": 3.40,
      "iv": 0.245,
      "delta": 0.52,
      "gamma": 0.035,
      "theta": -0.12,
      "volume": 1520,
      "open_interest": 8400
    }
  ],
  "puts": [
    {
      "strike": 180.0,
      "bid": 2.80,
      "ask": 3.00,
      "iv": 0.252,
      "delta": -0.48,
      "gamma": 0.034,
      "theta": -0.11,
      "volume": 980,
      "open_interest": 6200
    }
  ]
}
```

**Source:** yfinance `ticker.options` for expirations, `ticker.option_chain(expiry)` for chain data

### 3.5 AI Synthesis (Future — Stub First)

```
GET /api/analyze/synthesis/{ticker}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "generated_at": "2025-07-18T14:00:00Z",
  "growth_engine": [
    "Services revenue growing 15% YoY, now 25% of total revenue",
    "Vision Pro ecosystem expanding developer adoption",
    "India manufacturing diversification reducing supply chain risk"
  ],
  "bear_case": [
    "iPhone unit sales declining 3% in key China market",
    "Regulatory pressure on App Store fees in EU",
    "Premium valuation leaves little margin of safety at 28x forward P/E"
  ],
  "price_action_summary": {
    "current_support": "$175 (200-day EMA + high volume node)",
    "setup_quality": "Moderate — consolidating above support, awaiting catalyst"
  }
}
```

**Phase 1:** Return hardcoded/templated synthesis derived from fundamentals data (no LLM).
**Phase 2:** Integrate Copilot SDK or OpenAI for genuine AI synthesis from financial data + news.

---

## 4. Financial Model Interfaces

### 4.1 DCF Valuation (McManus)

```python
# apps/backend/app/services/analyze_service.py

def calculate_dcf(
    current_fcf: float,        # Latest free cash flow
    growth_rate: float,         # Annual FCF growth rate (slider: 0-30%)
    discount_rate: float,       # WACC / required return (slider: 5-20%)
    terminal_growth: float,     # Terminal perpetuity growth (default 2.5%)
    projection_years: int,      # Typically 10
    shares_outstanding: float,  # For per-share fair value
) -> dict:
    """Returns projected FCFs, terminal value, enterprise value, fair value per share."""
```

**Output:** `{ "projected_fcfs": [...], "terminal_value": float, "enterprise_value": float, "fair_value_per_share": float }`

### 4.2 ROIC Calculation

```python
def calculate_roic(
    nopat: float,          # Net Operating Profit After Tax
    invested_capital: float # Total equity + net debt
) -> float:
```

**Source fields:** From yfinance financials and balance_sheet DataFrames.

### 4.3 Technical Indicators (McManus)

```python
def calculate_ema(prices: list[float], period: int) -> list[float]:
def calculate_rsi(prices: list[float], period: int = 14) -> list[float]:
def calculate_macd(prices: list[float]) -> dict:  # macd_line, signal, histogram
def calculate_bollinger(prices: list[float], period: int = 20, std_dev: float = 2.0) -> dict:
```

These are pure functions operating on price arrays. No external dependencies — standard formulas.

### 4.4 IV Percentile / IV Rank

```python
def calculate_iv_percentile(current_iv: float, historical_ivs: list[float]) -> float:
    """% of days in past year where IV was below current IV."""

def calculate_iv_rank(current_iv: float, high_iv_52w: float, low_iv_52w: float) -> float:
    """(Current IV - 52w Low) / (52w High - 52w Low) * 100"""
```

### 4.5 Breakeven Calculator

```python
def calculate_breakeven(
    strike: float,
    premium: float,
    option_type: str,  # "call" | "put"
    current_price: float,
) -> dict:
    """Returns breakeven price and distance from current price."""
```

---

## 5. Data Sources

| Data Need | Source | Notes |
|-----------|--------|-------|
| Company info, financials | `yfinance` ticker.info, .financials, .cashflow, .balance_sheet | Already in dependencies |
| Price history (OHLCV) | `yfinance` ticker.history() | Supports 1d, 1wk, 1mo intervals |
| Option chains + Greeks | `yfinance` ticker.option_chain() | Greeks included in chain data |
| Technical indicators | **Calculated server-side** | Pure math from OHLCV — no extra deps |
| IV historical data | `yfinance` options chain over time | May need caching strategy for 52-week lookback |
| AI Synthesis | **Phase 1: Template-based** from fundamentals | Phase 2: Copilot SDK / OpenAI integration |
| Social sentiment | **Out of scope for v1** | Future: Reddit/Twitter APIs or third-party sentiment feeds |

**Caching strategy:** yfinance calls are slow (1-3s per ticker). Add a simple in-memory TTL cache (5-minute expiry for prices, 1-hour for fundamentals) using `cachetools` or a dict-based approach in the service layer.

---

## 6. Nav Integration

**File:** `apps/frontend/src/components/Layout/MainLayout.tsx`
**Location:** After the "Backtest" link (line 156), before the Settings divider (line 158).

Insert:
```tsx
<Link
    href="/analyze"
    className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
    onClick={() => setMenuOpen(false)}
>
    Company Analysis
</Link>
```

This places it as the last item in the TRADING section — logically it's a research/analysis tool that complements the existing trading execution pages above it.

---

## 7. Work Decomposition

### Phase 1: Foundation (No dependencies between tasks)

| # | Task | Agent | Depends On | Description |
|---|------|-------|------------|-------------|
| 1 | Backend router + fundamentals endpoint | **Hockney** | — | Create `app/api/analyze.py`, register in `main.py`, implement `GET /api/analyze/fundamentals/{ticker}` using yfinance |
| 2 | Backend price history endpoint | **Hockney** | — | Implement `GET /api/analyze/price-history/{ticker}` with period/interval params |
| 3 | Financial calculation service | **McManus** | — | Implement `app/services/analyze_service.py` with DCF, ROIC, EMA, RSI, MACD, Bollinger pure functions |
| 4 | Frontend page shell + nav link | **Fenster** | — | Create `app/analyze/page.tsx`, `AnalyzePage.tsx`, `SplitBrainToggle.tsx`, `TickerSearch.tsx`, add nav link in MainLayout |

### Phase 2: Long-Term View (Depends on Phase 1)

| # | Task | Agent | Depends On | Description |
|---|------|-------|------------|-------------|
| 5 | Price chart with fair value overlay | **Fenster** | 2, 3 | `PriceChartWithFairValue.tsx` — line chart using lightweight-charts, DCF overlay line |
| 6 | Financial Scorecard component | **Fenster** | 1 | `FinancialScorecard.tsx` — display ROIC/WACC, CAGR, Debt/EBITDA from fundamentals endpoint |
| 7 | Valuation Benchmarks + DCF Calculator | **Fenster** | 1, 3 | `ValuationBenchmarks.tsx` + `DCFCalculator.tsx` with interactive sliders |
| 8 | AI Synthesis stub | **Hockney** | 1 | `GET /api/analyze/synthesis/{ticker}` — template-based summary from fundamentals data |
| 9 | AI Synthesis component | **Fenster** | 8 | `AISynthesis.tsx` — render growth engine + bear case lists |

### Phase 3: Short-Term View (Depends on Phase 1)

| # | Task | Agent | Depends On | Description |
|---|------|-------|------------|-------------|
| 10 | Technicals endpoint | **Hockney** | 2, 3 | `GET /api/analyze/technicals/{ticker}` — calls McManus calculation functions |
| 11 | Option chain endpoint | **Hockney** | 3 | `GET /api/analyze/options/{ticker}` — wraps yfinance option_chain + IV calculations |
| 12 | Candlestick chart + indicators | **Fenster** | 2, 10 | `CandlestickChart.tsx` + `MomentumPanel.tsx` — candlestick series with overlays |
| 13 | Option chain + breakeven UI | **Fenster** | 11 | `OptionChainSnapshot.tsx` + `BreakevenVisualizer.tsx` |
| 14 | AI Price Action component | **Fenster** | 8, 10 | `AIPriceAction.tsx` — support/resistance + setup quality display |

### Phase 4: Polish

| # | Task | Agent | Depends On | Description |
|---|------|-------|------------|-------------|
| 15 | Caching layer for yfinance | **Hockney** | 1, 2, 10, 11 | Add TTL-based in-memory cache to avoid repeated yfinance calls |
| 16 | Loading states + error handling | **Fenster** | 5-14 | Skeleton loaders, error boundaries, empty states for all components |
| 17 | Integration review | **Keaton** | All | End-to-end review, verify data flow, chart performance, mobile responsiveness |

---

## Design Principles Applied

1. **Separation:** Backend does all financial math — frontend is a render layer with one exception (DCF slider recalculation for instant feedback)
2. **yfinance first:** No new dependencies for data. yfinance covers fundamentals, prices, and options chains
3. **Incremental delivery:** Each phase delivers a working slice. Phase 1 + 2 alone gives a useful Long-Term analysis tool
4. **AI as enhancement, not dependency:** Synthesis is template-based in v1. The page works without AI — it adds color but isn't load-bearing
5. **Chart consistency:** All charts follow the `OptionsChart.tsx` pattern (dark theme, slate grid, lightweight-charts API)

---

## Open Questions

1. **Ticker universe:** Should we restrict to US equities, or support international tickers (TASE, LSE)? yfinance supports both but data coverage varies.
2. **Persistence:** Should analysis results be saved to DB, or is this always live/ephemeral? Recommend ephemeral for v1.
3. **AI Phase 2 timeline:** When do we want genuine LLM synthesis? Copilot SDK is already in the project — could integrate relatively quickly.

---

*This plan is ready for team review. Hockney, McManus, and Fenster can begin Phase 1 tasks in parallel immediately.*
### 2025-07-24: Company Analysis — Financial Calculation Module Structure
**By:** McManus (Data/Finance Dev)
**Category:** Architecture, Financial Accuracy
**Status:** Implemented

**What:** Created `app/services/analysis/` as a Python package with 5 submodules:
- `dcf.py` — Two-stage DCF with Gordon Growth terminal value, net-debt adjustment, margin-of-safety
- `scorecard.py` — ROIC, WACC, CAGR (revenue + FCF), Net Debt/EBITDA, value-creation check
- `valuation.py` — Forward P/E, PEG Ratio, EV/FCF
- `technicals.py` — EMA, Bollinger Bands, RSI (Wilder's), MACD, Support/Resistance pivot detection
- `options_analytics.py` — IV Percentile, IV Rank, Cash Secured Put breakeven, Greeks formatter

**Why:** Company Analysis page requires both long-term valuation models and short-term technical/options analytics. All functions are pure (no DB, no network, no side effects) so Hockney can wrap them in API endpoints without coupling concerns.

**Design decisions:**
1. All monetary calculations use `decimal.Decimal` per team precision decision — converted to float only at serialization boundary
2. Technical indicators work on `List[float]` (not pandas Series) to keep them framework-agnostic
3. Each module has Pydantic input/output models for the composite functions, plus standalone functions for individual metrics
4. Support/Resistance uses pivot-point detection with configurable clustering tolerance
5. 48 tests cover all models including edge cases (negative values, zero denominators, insufficient data)

**Impact:** Additive — no existing code modified. Hockney can import from `app.services.analysis` directly.

### 2025-07-18: UI Decision — Company Analysis Page Shell
**By:** Fenster (Frontend Dev)
**Category:** Frontend, UI/UX
**Status:** Implemented

**What:** Split-Brain Toggle UI component with pill/segmented control styling. Blue for Long-Term Investor view, amber for Short-Term Income view. Toggle state is React state only (no URL params). Ticker validation is client-side only: uppercase, alphabetic, 1–5 characters for US equity tickers.

**Design decisions:**
- Color distinction gives instant visual feedback about active "brain"
- Both views use `shadow-lg` with color-tinted glow for premium feel
- Placeholder card structure (3 cards per view) with dashed borders makes Phase 2/3 drop-in integration straightforward
- Page layout follows `pension/page.tsx` pattern: `min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8`, cards use `bg-slate-900 border border-slate-800 rounded-xl p-6`

**Files Created:**
- `apps/frontend/src/app/analyze/page.tsx`
- `apps/frontend/src/components/Analyze/AnalyzePage.tsx`
- `apps/frontend/src/components/Analyze/SplitBrainToggle.tsx`
- `apps/frontend/src/components/Analyze/TickerSearch.tsx`
- `apps/frontend/src/components/Analyze/LongTermView.tsx`
- `apps/frontend/src/components/Analyze/ShortTermView.tsx`
- Modified: `apps/frontend/src/components/Layout/MainLayout.tsx` (added nav link)

**Impact:** Additive. No breaking changes.

### 2025-07-18: API Router Implementation — Analyze Endpoints
**By:** Hockney (Backend Dev)
**Category:** Backend, API Design
**Status:** Implemented

**What:** Created `/api/analyze` router with 5 endpoints wiring yfinance data to McManus's pure calculation functions:
1. `GET /api/analyze/fundamentals/{ticker}` — Company financials + DCF inputs
2. `GET /api/analyze/price-history/{ticker}` — OHLCV with period/interval params
3. `GET /api/analyze/technicals/{ticker}` — Latest EMA, RSI, MACD, Bollinger scalar values
4. `GET /api/analyze/options/{ticker}` — Option chain with IV percentile/rank
5. `GET /api/analyze/synthesis/{ticker}` — Template-based observations (Phase 1)

**Design decisions:**
- WACC Cost of Equity uses CAPM (4.3% risk-free, 5.5% market premium) — hardcoded for now, should be configurable Phase 2
- IV Percentile/Rank approximated from current chain distribution (not historical) — true 52w percentile requires data provider Phase 2
- Technicals return scalars only (last valid value per indicator), not full arrays — separate endpoint can be added if charts need time series
- Synthesis uses conditional templates on financial ratios (no raw number interpolation without context)
- Error handling: 404 for unknown tickers, 502 for yfinance failures, individual metrics return `null` on calc failure (don't block response)

**Files:**
- Created: `apps/backend/app/api/analyze.py`
- Modified: `apps/backend/main.py` (router import/registration)

**Open items:**
- [ ] Add TTL caching for yfinance calls (Phase 4)
- [ ] Replace hardcoded CAPM parameters
- [ ] Source proper historical IV data

### 2026-07-24: Growth Story Agent + Copilot SDK Service
**By:** Kobayashi (AI Agent Engineer)
**Category:** AI Integration, Feature Development
**Status:** Implemented

**What:** Created Growth Story analysis feature — three artifacts:
1. `.github/agents/growth-analyst.agent.md` — Agent persona for Copilot Chat and backend SDK reference. Senior Equity Research Analyst with structured search phase, source weighting (SEC filings > news > social), three-scenario framework, JSON output contract.
2. `apps/backend/app/services/growth_story.py` — Copilot SDK service following established `copilot_analyzer.py` pattern. Uses streaming delta accumulation, `send_and_wait`, `claude-opus-4.6`, and `system_message` with `mode: "append"`.
3. `apps/backend/app/api/analyze.py` — Added `POST /api/analyze/growth-story/{ticker}` endpoint with optional company_name/sector, yfinance fallback, 180s timeout, proper error handling.

**Why:** Delivers Phase 2 AI synthesis with web search, multi-source analysis, structured scenarios. POST method chosen because it triggers expensive AI operation (not cached lookup).

**Design decisions:**
- System message uses `mode: "append"` — preserves Copilot safety guardrails while injecting analyst persona
- Response parsing handles multiple JSON extraction strategies (direct parse, markdown stripping, object extraction)
- Agent file doubles as both Copilot Chat persona and canonical backend system prompt reference
- 180s timeout accommodates web search + multi-source analysis
- Existing synthesis endpoint preserved as fast fallback (no modifications)

**Impact:** Additive — no existing endpoints/services modified.
### 2026-07-25: Frontend Test Infrastructure — Tooling and Patterns
**By:** Redfoot (Tester)
**Category:** Testing, Quality, Infrastructure
**Status:** Implemented (PR #15, draft)

**What:** Established frontend test infrastructure with vitest + React Testing Library + jsdom. Created 4 test files (20 tests) covering PensionTable, AnalyzePage, SplitBrainToggle, and OptionChainSnapshot.

**Design decisions:**
1. **vitest over Jest** — vitest integrates natively with the Vite ecosystem, shares config patterns with the existing Next.js setup, runs faster, and has built-in ESM support. No babel config needed.
2. **Global mocks in setup.ts** — `lightweight-charts` and `next/navigation` are mocked globally because nearly every component depends on one or both. This avoids repetitive per-file mock boilerplate.
3. **Child component mocking pattern** — Page-level tests (AnalyzePage) mock child views (LongTermView, ShortTermView) to isolate page logic (routing, toggle state, ticker validation) from data-fetching and rendering concerns. This keeps tests fast and focused.
4. **Null-safety as a test priority** — OptionChainSnapshot tests explicitly verify behavior with null Greeks and IV metrics. This validates the recent null-safety fix and prevents regressions from API data inconsistencies.
5. **Test scripts convention** — `npm test` (CI), `npm run test:watch` (dev), `npm run test:coverage` (quality gate). Consistent with team decision on quality gates.

**Impact:** Additive. No existing code modified (only package.json scripts added). Foundation for expanding coverage to all 53+ frontend components.

**Next steps:**
- Add tests for chart components (will need more sophisticated lightweight-charts mock interactions)
- Add tests for data hooks (useCompanyFundamentals, usePriceHistory, etc.) with fetch mocking
- Set up coverage thresholds once baseline is established
- Wire `npm test` into CI pipeline (GitHub Actions)
### 2026-03-05: yfinance Caching — In-Memory TTL with cachetools
**By:** Hockney (Backend Dev)
**Category:** Performance, API Design
**Status:** Implemented (PR #14, draft)

**What:** Added `cachetools.TTLCache`-based in-memory caching for all `/api/analyze` endpoints. Each cache type has its own TTL:
- Prices/technicals/options: 5 minutes (300s)
- Fundamentals: 1 hour (3600s)

**Why:** yfinance calls are slow (1-3s per ticker). Repeated requests for the same ticker within the TTL window now return instantly from cache. This directly addresses the Phase 4 caching item from the Company Analysis architecture decision.

**Design decisions:**
1. **cachetools over Redis** — For a single-instance personal app, in-memory caching is simpler and has zero operational overhead. If the app scales to multiple workers/instances, this should migrate to Redis.
2. **Thread lock, not asyncio lock** — yfinance is synchronous and runs in FastAPI's threadpool. A `threading.Lock` protects the shared cache dict correctly.
3. **JSONResponse for cached responses** — Switching from returning raw dicts to `JSONResponse` when cache headers are needed. This is a slight change in response behavior (no Pydantic serialization on cached hits) but the data is already serialized.
4. **Cache-stats endpoint is public** — No auth yet on the app. When JWT auth is added (per Security Hardening decision), this endpoint should be admin-only.
5. **No cache invalidation API** — For a personal app with TTL-based expiry, manual invalidation isn't needed yet. Can add `DELETE /api/analyze/cache` if required.

**Impact:** Additive — no breaking changes. Existing test suite passes.

### 2026-07-25: Growth Story AI — Production Hardening Pattern
**By:** Kobayashi (AI Agent Engineer)
**Category:** AI Integration, Reliability, Error Handling
**Status:** Implemented (PR #16)

**What:** Established the production hardening pattern for Copilot SDK services:
1. SDK service returns `None` on failure (timeout, SDK error, malformed JSON, schema validation failure) instead of raising exceptions
2. Endpoint handles fallback — reuses existing template-based synthesis endpoint
3. Every response carries `source` field ("ai" | "template") and `analysis_duration_seconds`
4. Schema validation gate: AI output is checked for required keys before acceptance
5. Retry strategy: on malformed JSON, retry once with a simplified prompt; if retry also fails, fall back to template

**Why:** The original implementation raised exceptions on any SDK failure, which caused 502/504 errors in the UI. For a personal trading app, a degraded-but-functional response (template) is always better than a broken endpoint. The `source` field lets the frontend show appropriate confidence indicators.

**Design decisions:**
1. **None-return pattern over exceptions** — The service handles its own retry/timeout internally and returns `None` to signal "I couldn't do it." This keeps the endpoint simple and testable.
2. **120s retry timeout (vs 180s initial)** — The retry prompt is simpler and shouldn't need as long. Total worst-case wall time is ~300s, but the 180s initial timeout covers 95% of cases.
3. **Schema validation is structural only** — We check that keys exist and are the right type, but don't validate content quality. Content quality is the agent prompt's job.
4. **Agent prompt strengthened** — Added explicit required-fields table, noise filter rules, source weighting priority table. This reduces malformed JSON occurrences at the source.

**Impact:** No breaking changes. The endpoint never crashes on SDK failures now. Template fallback provides consistent UX. This pattern should be replicated for any future SDK-powered endpoints.
### 2026-02-23: Real API Integration Testing for /analyze Page
**By:** Redfoot (Tester)
**Category:** Testing, E2E, Architecture
**Status:** Implemented (PR #16)

**What:** Playwright E2E tests for `/analyze` page use REAL API calls to the backend (which calls yfinance), not mocks. 11 comprehensive tests covering page load, ticker search, toggle switching, financial data display (Scorecard, Valuation Benchmarks, DCF), error handling.

**Why:** 
- Integration coverage: Mocking the API tests only the frontend in isolation, missing integration issues between frontend, backend, and yfinance
- Real behavior: Live market data has edge cases (missing data, null values, API errors) hard to predict and mock accurately
- Confidence: Tests passing with real APIs give higher confidence for production
- Trade-off: Tests are slower (5-15s each), can be flaky if yfinance is down, but catch real bugs

**Design decisions:**
- Test timeouts: 30s per test, 15s for API-dependent visibility assertions
- Assertions focus on UI presence and label text (not exact numbers, which vary)
- Toggle buttons tested via `aria-pressed` attribute
- Metric labels must include spaces: "Net Debt / EBITDA" not "NetDebt/EBITDA"

**Alternatives rejected:**
- Mock all API calls: False confidence, misses integration issues
- Hybrid (mock some, real for others): Added complexity without benefit
- Separate mock/integration suites: Possible future if flakiness becomes issue (>5% external failures, >2min runtime)

**Team impact:** Frontend devs accept longer E2E runs; CI/CD needs network access to yfinance; tests need periodic review if yfinance API changes.

**Revisit if:** E2E flakiness >5%, runtime >2min, or team grows and needs faster feedback loops.

### 2026-03-06: Allow `.squad/` files on protected branches
**By:** Kujan (DevOps/Platform)  
**Date:** 2026-03-06  
**Status:** Implemented (Commit: 904c595)  
**Impact:** CI/CD workflow behavior change

**What:** Remove `.squad/` and `.squad/**` path patterns from the forbidden paths check in `.github/workflows/squad-main-guard.yml` while maintaining protection for `.ai-team/`, `.ai-team-templates/`, `docs/proposals/`, and `team-docs/`.

**Why:** The squad framework is actively used on `main` for team state management. The `.squad/` directory already contains 66 tracked files and is part of the team's normal workflow. The guard correctly blocks other developer/template directories which should stay off production branches.

**Decision:** Removed `.squad/` from forbidden paths check. Kept protection for: `.ai-team/`, `.ai-team-templates/`, `team-docs/`, `docs/proposals/`.

**Changes:**
- Line 78 (filter): Removed `.squad` and `.squad/**` check
- Line 98 (error message): Removed `.squad/` mention from runtime team state description
- Lines 113-114 (remediation): Removed `git rm --cached -r .squad/` command
- Line 121 (note): Updated to reference only `.ai-team/`

**Verification:** All other forbidden paths remain blocked. CI now green (run 22758227640).
