# Archived Decisions

Decisions older than 30 days from 2026-04-30 are archived here.

---

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

## Archived 2026-05-09

### 2026-04-30: Issue Decomposition: Hosting Migration
**By:** Keaton (Lead), requested by Jony Vesterman Cohen
**Category:** Planning, Architecture
**Status:** Ready for review

**What:** Decomposed the approved hosting design (design.md v2) into 31 GitHub issues across 6 phases (Prep → Foundation → Data → Frontend → Sharing → Cutover).

**Key metrics:**
- **Total issues:** 31
- **Total phases:** 6
- **Critical path depth:** 9 (TJ-000 → TJ-004 → TJ-005 → TJ-007 → TJ-018 → TJ-025 → TJ-026 → TJ-029 → TJ-030)
- **Most work:** Kujan (10 issues — heavy infra/DevOps load), Fenster (7 issues — frontend + sharing UX)
- **@copilot-suitable:** 9 issues (TJ-002, TJ-009, TJ-014, TJ-015, TJ-017, TJ-019, TJ-024, TJ-027, TJ-028)

**Design.md insufficiencies flagged:**
1. **Table classification not fully specified:** design.md §6 surveys tables but doesn't produce a definitive classification table. TJ-003 creates this as a prerequisite for TJ-005.
2. **Email delivery for invites unspecified:** design.md §5 mentions email but doesn't specify provider. TJ-021 defers to logging invite URLs with email integration as follow-up.
3. **Custom domain decision still pending:** design.md §17 lists this as a Jony decision. TJ-026 (prod deploy) notes the dependency.
4. **Preview OAuth strategy needs spike:** design.md §4.1 describes three options but doesn't pick one. TJ-025 validates whichever approach is chosen.
5. **Audit log schema not detailed:** design.md §5 describes audit requirements but doesn't provide DDL. TJ-024 creates this.

**Artifacts:**
- `docs/design-hosting/issue-manifest.json`
- `docs/design-hosting/issue-manifest.md`
# Decision: Analyze Page — Shared Components & Error Resilience

**Author:** Fenster (Frontend)
**Date:** 2025-07-24
**Issue:** #6 — Company Analysis polish for v0.0.1

## Context

The Analyze page had duplicated skeleton/error UI across ShortTermView and LongTermView, no per-section error isolation, no retry support in shortterm hooks, and rigid grid layouts on mobile.

## Decisions

1. **Extracted `shared/` component library** — SkeletonCard, ErrorBanner (with optional `onRetry`), SectionErrorBoundary (React class error boundary), and EmptyState live under `Analyze/shared/` with a barrel export. Both views now import from this single source.

2. **Per-section error boundaries** — Every data-driven section in both views is wrapped in `<SectionErrorBoundary>`. A crash in one section (e.g. chart rendering) no longer takes down the entire page.

3. **Retry on all hooks** — All 4 shortterm hooks (`useTechnicals`, `usePriceHistory`, `useSynthesis`, `useOptionChain`) now expose `refetch` via `useCallback`. Longterm hooks already had this. Each section's ErrorBanner wires to the relevant hook's `refetch`.

4. **Mobile-responsive grids** — FinancialScorecard changed from `grid-cols-2` to `grid-cols-1 sm:grid-cols-2`. ShortTermView grids changed from `md:grid-cols-2` to `sm:grid-cols-2` for earlier breakpoint.

5. **Improved empty & error states** — No-ticker-selected now shows an EmptyState with suggestions. Invalid-ticker errors show a descriptive message with icon and retry button.

## Trade-offs

- SectionErrorBoundary is a class component (React requirement for error boundaries). This is the only class component in the codebase.
- The `shared/` folder is scoped to Analyze. If other pages need these components later, they can be promoted to a top-level `shared/` or `ui/` directory.
### 2026-04-30: Supabase 2-Project Topology (Free Tier)
**By:** Keaton (Lead), requested by Jony Vesterman Cohen
**Category:** Architecture, Infrastructure
**Status:** Approved — reflects Kujan's verified finding against live Supabase docs

**Context:** The approved hosting design (`docs/design-hosting/design.md`) assumed three Supabase environments mapped to three remote projects. Kujan's remote runbook (`docs/design-hosting/runbooks/supabase-02-remote.md`) verified against live Supabase pricing that the **free tier allows a maximum of 2 active projects per organisation**. A 3-project topology therefore requires a paid plan from day one.

**Decision:** Adopt a **2-project topology** that stays within the free tier:

| Slot | Supabase project | Serves |
|---|---|---|
| 1 | **Production** | Vercel production deployments only |
| 2 | **Dev/Preview** | Local development + all Vercel preview deployments (shared state) |
| — | **Local Docker** (`supabase start`) | Fully offline iteration; no remote project slot consumed |

**Rationale:**
- Free tier = 2 projects max. Using 3 costs $25/mo on Pro immediately.
- Dev and preview share enough characteristics (non-production data, seed-able, ephemeral) that sharing a single remote project is acceptable for a small team.
- Local Docker (`supabase start`) gives any developer a fully isolated environment without touching the remote project count.

**Trade-offs:**

**Risk:** Preview branches share Dev/Preview state. Two PRs that mutate the same database row (e.g., both seeding the same household fixture) can collide or produce confusing test results.

**Mitigations (in priority order):**
1. **Opt-in per-PR seed reset** — a CI step that truncates and re-seeds the Dev/Preview project when a PR opts in via a label or workflow flag. Cheap and sufficient for a solo/duo team.
2. **Upgrade to Supabase Pro ($25/mo)** — adds a third project slot, allowing true per-environment isolation. Appropriate when team size reaches 3+ active contributors or when preview-state collisions become frequent.

**Affected Artefacts:**
- `docs/design-hosting/design.md` — Phase 1 topology, Acceptance Criteria §15 item 3, Edge Case §13 "Preview deploys hitting prod data", top-of-doc changelog note.
- `docs/design-hosting/runbooks/supabase-02-remote.md` — already correct per Kujan's runbook; no changes needed.

---

### 2026-05-01: Supabase Setup Runbook & Local Development Workflow
**By:** Kujan (DevOps/Platform), requested by Jony Vesterman Cohen
**Category:** Infrastructure, Documentation
**Status:** Implemented

**What:** Split the original combined hosting runbook into focused agent deliverables. Kujan owns Supabase setup and operations; Hockney will handle Vercel deployment separately. The trading journal application uses Supabase for Postgres + Auth with household-based sharing model and RLS enforcement.

**Key Decisions:**

1. **Local Development via Supabase CLI:** Use `supabase start` for local Docker-based development stack instead of standalone Postgres container.
   - Single command boots Postgres, GoTrue (auth), PostgREST, Storage, Studio, and Inbucket
   - Automatic migrations replay on `supabase db reset`
   - Consistent local/remote schema via `supabase link` + `supabase db push`
   - Studio web UI at `http://127.0.0.1:54323` for schema inspection

2. **Connection String Strategy:** Use **direct connection** (port 54322 local, 5432 remote) for migrations and long-running jobs. Use **transaction pooler** (port 6543) for production web traffic with `?statement_cache_size=0`.
   - Alembic/SQLAlchemy migrations fail through PgBouncer transaction pooler
   - Direct connections support session-level features and long transactions
   - Transaction pooler optimizes short-lived serverless/web requests

3. **Migration Workflow:** SQL-first migrations via `supabase migration new` with manual review. Avoid Studio UI diff tool for financial schema.
   - Financial applications require explicit control over constraints, indexes, and RLS policies
   - SQL migrations are reviewable, testable, and version-controlled
   - Studio diff tool can miss security-critical policies or generate verbose/redundant DDL

4. **Three-Environment Strategy:** Provision three Supabase projects: `trading-journal-dev`, `trading-journal-preview`, `trading-journal-prod`.
   - **Dev:** Integration testing, schema experimentation, safe to break
   - **Preview:** PR validation, stakeholder review, matches production config
   - **Prod:** Live user data, strict change control

5. **Region Selection:** Recommend `eu-central-1` (Frankfurt) for Israel-based primary developer.
   - Frankfurt offers ~80-120 ms latency to Israel (verified via cloudping.info)
   - **Cannot change region post-creation** — must choose correctly upfront

6. **Free-Tier Monitoring:** Defer PDF file uploads until paid tier. Monitor database size before Phase 1 schema deployment.
   - 500 MB database storage, 1 GB file storage, 5 GB monthly egress bandwidth
   - Upgrade trigger: DB > 400 MB OR egress > 80% of quota

7. **OAuth Configuration Pattern:** Configure Google OAuth for both local (`http://127.0.0.1:54321/auth/v1/callback`) and remote (`https://<project-ref>.supabase.co/auth/v1/callback`).
   - Google Console: Add both callback URIs to Authorized redirect URIs
   - Supabase: Configure in Dashboard → Authentication → Providers → Google
   - Preview deploy OAuth requires explicit Vercel preview URLs in Google Console OR Supabase wildcard support (must verify)

8. **RLS Helper Function Pattern:** Use `is_household_member(hid uuid)` security definer function + policies on every user-data table.
   - Centralized authorization logic (DRY)
   - `security definer` grants function access to `household_members` table
   - Simplifies per-table policies to single `using (public.is_household_member(household_id))` clause

**Verification Checklist (⚠️ items):**
- Region selection (`eu-central-1` latency acceptable)
- Management API field names (verify `region` vs. `region_id`)
- Free-tier quotas (50k MAU / 500 MB DB / 5 GB egress)
- Backup retention (7-day free tier)
- Project pause policy (~7 days inactivity)
- OAuth preview URL behavior (wildcard support)
- Local DB size check before TJ-005 schema deploy
- PgBouncer parameter (`statement_cache_size=0`) in production pooler URL

**Outcomes:**
- Runbook Delivered: `docs/design-hosting/setup-supabase.md` (498 lines, 11 sections)
- Cross-References: Links to Hockney's Vercel runbook, design docs, and GitHub issues TJ-001/004/005/007
- Verification Items: 8 ⚠️-flagged items requiring user confirmation before Phase 1
- CLI Commands: Quick reference appendix with 15+ common operations
- Troubleshooting: 7 common issues + solutions

---

### 2026-05-01T19:35:00+03:00: User directive — frontend talks to Supabase directly

**By:** Jony (cohenjo) (via Copilot)

**What:** Frontend should access Supabase directly for simple CRUD. Backend (FastAPI) is reserved for heavy/batch processing and talks directly to the DB. No frontend→backend HTTP. If Python can be deployed on Vercel, the backend may live there too — but simple CRUD still goes directly to the DB from the frontend.

**Why:** Original design intent. Decouples frontend from backend deployment, fits Vercel-native model, leverages Supabase RLS as the security boundary.

---

### 2026-05-01T19:45:07+03:00: User directive — prefer latest tier models

**By:** Jony (cohenjo) (via Copilot)

**What:** Use latest available models when spawning agents:
- Premium: `claude-opus-4.7` (was opus-4.6)
- Standard: `claude-sonnet-4.6` (was sonnet-4.5)
- Premium alt: `gpt-5.5` (was gpt-5.4)
- Fast: `claude-haiku-4.5` (unchanged)

Charter `Preferred` fields that pin sonnet-4.5 should be treated as "use sonnet 4.6" until explicitly overridden by the user.

**Why:** User wants to ride the latest model tier; sonnet 4.6 noted as more advanced than 4.5.

---

### 2026-05-01T19:30:41+03:00: API Rewrite Hardening — next.config.ts defensive validation

**By:** Kujan (DevOps/Platform)

**What:** `apps/frontend/next.config.ts` now keeps the local-development fallback to `http://127.0.0.1:8000`, but production build/start validates `NEXT_PUBLIC_API_URL` before configuring `/api/:path*` rewrites. Production now fails loudly if the value is missing, empty, malformed, non-HTTP(S), localhost, loopback, or private-address based.

**Why:** Production write paths depend on `/api/*` rewrites. Without validation, deployments silently fail when `NEXT_PUBLIC_API_URL` is misconfigured or missing.

**Open decision:** Backend deployment strategy is OPEN. The user must choose between:
1. Deploying the FastAPI backend in `apps/backend` publicly and setting Vercel `NEXT_PUBLIC_API_URL` to that public backend URL.
2. Porting the required API endpoints to Next.js route handlers so Vercel owns the API surface.

Until that decision is made and implemented, production write paths that depend on `/api/*` remain broken.

---

### 2026-05-01: Phase 3 Execution Plan — Frontend↔Supabase Direct

**By:** Keaton (Lead)

**What:** Execute Phase 3 migration per the plan at `docs/design-hosting/phase-3-execution-plan.md`. User reaffirmed architecture directive: "frontend to function with the DB and not be dependent on backend. Backend processing too complex for the frontend should remain in the backend and be processed directly vs the DB. No frontend to backend communications."

**Decision:**

1. **Directive Confirmed:** User's "frontend to DB" matches design doc's "Server Actions calling Supabase-direct." No conflict—proceed.

2. **Endpoint Disposition:**
   - **MOVE (15+ routers):** Simple CRUD → Server Actions (finances, plans CRUD, holdings, dividends, trades, insurance, pension, bonds, summary, day, ladder, ndx, options CRUD, trading CRUD).
   - **KEEP (4+ routers/subsets):** Heavy compute → backend workers (backtest, analyze, tax_condor, plans/simulate).
   - **DEPRECATE (2 routers):** auth (→ Supabase Auth), metrics (→ Vercel Analytics).

3. **Priority Order:**
   - **Week 1:** finances (broken in prod) → plans CRUD → holdings → dividends.
   - **Week 2:** trades → insurance → pension → summary dashboards.
   - **Week 3:** bonds → options CRUD → trading CRUD.

4. **Stop-the-Bleed:** Implement Server Action for POST /api/finances immediately (Fenster, 1 day). Proper fix; no temporary FastAPI deploy.

5. **Risks & Mitigations:**
   - RLS gaps → Rabin audit before prod deploy.
   - household_id injection loss → Fenster creates injection helper.
   - Pydantic validation loss → Port schemas to Zod.
   - Supabase rate limits → Use pooled connection URL.
   - Audit trail loss → Preserve created_by/audit_log in Server Actions.

**Next Actions:** Fenster implements finances Server Action (stop-the-bleed); Hockney audits all routers; Rabin audits RLS; Kujan verifies Supabase connection limits.

**References:** `docs/design-hosting/phase-3-execution-plan.md`, `docs/design-hosting/design.md` (§9 Phase 3), Production bug: POST /api/finances → 404.

---

### 2026-05-01: Backend Endpoint Disposition Audit

**By:** Hockney

**What:** Completed full audit of 67 backend endpoints across 19 routers. Disposition matrix documented at `docs/design-hosting/endpoint-disposition.md`.

**Headline Counts:**
- **32 MOVE** — simple CRUD, migrate to Server Actions
- **28 KEEP** — heavy compute/batch, stays in FastAPI
- **7 DEPRECATE** — replaced by Supabase Auth or obsolete

**Key Findings:**

1. **Household ID injection is the primary cross-cutting concern.** 14 routers currently call `get_user_household_id(session, user_id)` to resolve household. MOVE candidates need equivalent RLS policies + Server Action household context.

2. **Mixed routers need careful migration.** 5 routers (analyze, dividends, finances, ndx, trading) have both MOVE + KEEP endpoints. Frontend routing must split calls during Phase 3.

3. **Phase 3 can start immediately with 20 low-hanging fruit endpoints** (holdings, insurance, plans CRUD, summary). These are single-table queries with clear household scoping.

**Recommendations:** Phase 3A (20 simple CRUD) → Phase 3B (5 mixed-router partial) → Phase 3C (defer complex) → Phase 4 (keep 28 heavy/batch in FastAPI).

---

### 2026-05-01: Optional Auth Pattern for Telemetry Endpoints

**By:** Hockney (Backend Dev)

**Issue:** #125 — `/api/metrics/page-load` returns 401 on every page

**Problem:** Metrics endpoint was returning 401 Unauthorized on every authenticated page load, polluting console logs and losing telemetry data.

**Root cause:**
1. Metrics router mounted with `dependencies=auth_dep` requiring JWT auth
2. Frontend uses `navigator.sendBeacon()` for page-load telemetry
3. **sendBeacon() cannot attach custom HTTP headers** (spec limitation)
4. Result: Every sendBeacon() → 401, even for authenticated users

**Solution:** Created **optional auth pattern** for telemetry endpoints. Metrics router uses `get_current_user_optional()` which validates auth if present, returns None if absent/invalid. Endpoint degrades gracefully: captures `user_id` when available, logs anonymously otherwise.

**Pattern for Future Telemetry:**
- ✅ Page-load metrics
- ✅ Error reporting / crash telemetry
- ✅ Real User Monitoring (RUM)
- ✅ Analytics events sent via sendBeacon()
- ❌ NOT for business-critical endpoints with PII/RBAC requirements

**References:** `apps/backend/app/dependencies.py` (get_current_user_optional), `apps/backend/app/api/metrics.py` (first consumer), PR #137.

---

### 2026-05-01: Frontend API Call Site Audit & Supabase Direct Migration Plan

**By:** Fenster (Frontend Dev)

**Context:** Production bug: `/current-finances` page calls `POST /api/finances/` which returns **404 on Vercel** because `next.config.ts` rewrite points at a non-deployed FastAPI host. User directive: "Frontend → Supabase directly for simple CRUD. No frontend↔backend HTTP coupling."

**Decision:** Migrate to **Server Action** (`app/current-finances/actions.ts`) that writes directly to Supabase `finance_snapshots` table. Eliminates FastAPI dependency for this flow.

**Migration shape:**
- Server Action fetches user → household_id from `user_profile.default_household_id`
- Upserts row into `finance_snapshots` with composite PK `(household_id, date)`
- RLS enforces write permission via `is_household_writer(household_id)`
- Returns `{ success: boolean, error?: string }` to client
- Client shows inline error banner (replaces `alert()`)

**Key Statistics:**
- **Total call sites:** 89 across 16 features
- **Broken call sites:** 1 (`POST /api/finances` → 404 on Vercel)
- **Missing JWT forwarding:** 5 (TradingAccountDashboard.tsx — direct `fetch()` without `apiFetch` wrapper)
- **Absolute URL construction:** 6 (Analyze/longterm hooks + pension — uses `NEXT_PUBLIC_API_URL`)

**Decision Criteria:**
- **Use Server Action when:** Mutation with business logic, data must be written, want to avoid exposing Supabase queries, need server-side context
- **Use Direct Supabase Client when:** Read-only, real-time subscriptions, optimistic UI, query params user-driven

**Effort:** M-size (2-4 hours) — includes Server Action implementation, improved error UX, unit + E2E tests.

**References:** `docs/design-hosting/frontend-api-callsites.md` (full audit with call site inventory).

---

### 2026-05-01T19:36:00+03:00: Python Backend Hosting — Keep Local Docker

**By:** Kujan (DevOps/Platform) | Approved by Jony

**Question:** Can the FastAPI backend (`apps/backend/`) run on Vercel as serverless functions, or does it need a separate hosted backend?

**Decision:** **Keep local Docker backend. Do not migrate to Vercel Functions.**

**Rationale:**
1. **Vercel constraints disqualify production workloads:**
   - 60s max execution (backtests often exceed this)
   - Ephemeral filesystem (no persistent sockets for IB Gateway)
   - No native WebSocket/long-poll support
   - Cold starts 8–15s (blocks interactive requests)

2. **Trading-journal backend has stateful operations:**
   - `POST /api/backtest/run` — compute-heavy; processes OHLC data with pandas/scipy/numpy
   - `GET /api/trading/*` — IB Gateway socket connections (requires persistent process)
   - Scheduled data imports (IBKR/Schwab token sync)
   - Background workers for async tasks

3. **Splitting endpoints across Vercel + local increases complexity without benefit:**
   - Two deployment targets to manage
   - Cross-environment test burden
   - Auth token passing between backends
   - No cost savings (hosting still needed for stateful workloads)

4. **Current architecture is sound:**
   - Local Docker (dev) → Render.com/Railway/Fly.io (prod)
   - Single deployment model; same image runs everywhere
   - No timeout risk; no ephemeral filesystem issues

**Implementation:** No changes required. Current hosting topology stands: Frontend (Vercel) | Backend (Docker/Render/Railway/Fly.io) | Database (Supabase).

---

### 2026-05-01: RLS Coverage Audit — Frontend-Direct CRUD Readiness

**By:** Rabin (Security Engineer)

**Issue:** Phase 3 frontend-direct CRUD security readiness

**Status:** ✅ Ready to proceed (database-side protection complete)

**Summary:** Completed comprehensive Row Level Security (RLS) audit on 9 household-scoped tables targeted for frontend-direct CRUD in Phase 3. **All audited tables are database-ready.** RLS policies are fully implemented with consistent household-scoped access control using proven helper functions.

**Key metric:** 9/9 tables fully covered with 4-policy RLS (SELECT/INSERT/UPDATE/DELETE) and household_id validation.

**Findings:**

### ✅ Database Protection: READY
- finance_snapshots, plans, dividend_positions, dividend_accounts, insurance_policies, bond_holdings, optioncontract, trade, execution, manualtrade, matchedtrade
- All have RLS enabled with full CRUD policies
- All use `is_household_member()` (SELECT/READ) and `is_household_writer()` (INSERT/UPDATE/DELETE) helpers
- All policies check `household_id IS NOT NULL` to prevent NULL-bypass attacks
- Helpers include soft-delete boundary check (`households.deleted_at IS NULL`)

### ⚠️ Application Responsibility Shift: CRITICAL
- **Current state (backend injection):** `get_user_household_id(db, user_id)` looks up user's primary household
- **Future state (frontend-direct):** Frontend reads household_id from Supabase Auth JWT; passes it in all CRUD requests
- **No database auto-injection:** No triggers, no `current_setting()`, no DEFAULT on household_id columns (intentional)
- **Frontend must source household_id from auth session, not from user input**

### ⚠️ Top 3 Risks if Mitigation Not Implemented
1. **Client sends malicious household_id:** RLS will reject (policy checks ownership). **Mitigation:** Frontend must NOT expose household_id as user input; always source from session JWT/profile
2. **Frontend omits household_id:** RLS policy `household_id IS NOT NULL` check rejects. **Mitigation:** Frontend TypeScript types must make household_id a required field (not optional)
3. **Viewer role escalates to writer:** RLS uses `is_household_writer()` = (role IN ('owner', 'member')). **Mitigation:** Frontend respects viewer role; DB enforces at RLS layer

**Recommendation for Phase 3:**

### Frontend Work Checklist
- [ ] TypeScript models for all CRUD operations mark household_id as required (not optional)
- [ ] Frontend auth hook reads household_id from Supabase JWT/user_profile at session init
- [ ] All INSERT/UPDATE operations automatically include session household_id (not from user input)
- [ ] Frontend UI does NOT expose household_id as editable field
- [ ] Use Supabase anon-key for frontend CRUD (RLS applies automatically based on Auth JWT)
- [ ] Unit/E2E tests verify RLS rejection when sending mismatched household_id

### Backend Deprecation Plan
- [ ] Keaton: Document which API endpoints are transitioning to frontend-direct
- [ ] Keaton: Verify service-role key is reserved for async jobs only
- [ ] Keaton: Remove household_id injection from deprecated endpoints as Phase 3 cutover completes

**Deliverable:** `docs/design-hosting/rls-coverage-audit.md` (per-table audit matrix, household_id source verification, risk assessment, pre-Phase-3 checklist).



# Decision: Pattern for Direct-to-Supabase Server Actions (finances)

**Author:** Fenster (Frontend Dev)
**Date:** 2026-07-31
**Branch:** squad/finances-server-action
**Status:** Implemented

---

## Context

POST `/api/finances` returned 404 on Vercel because `next.config.ts` rewrites
`/api/*` to a FastAPI backend that is not deployed there. The approved
architecture directive says: frontend talks to Supabase directly for simple
CRUD; backend stays for heavy/batch only.

---

## Decision

Replace `apiFetch('/api/finances/*')` calls with Next.js **Server Actions** that
use the SSR Supabase client (`@/lib/supabase/server`) directly.

---

## Pattern to Copy for the Next 15 Features

### 1. File layout

```
apps/frontend/src/app/<feature>/
  actions.ts        ← 'use server' — all Supabase writes/reads
  page.tsx          ← 'use client' — imports actions, calls them
  actions.test.ts   ← vitest unit tests (mock @/lib/supabase/server)
```

### 2. Always resolve household_id from the session

```ts
// ✅ CORRECT — household_id from DB, scoped to the authenticated user
const householdId = await resolveHouseholdId(user.id);  // queries household_members

// ❌ NEVER — household_id from caller input
async function saveX(data: XInput & { household_id: string }) { ... }
```

The helper:
```ts
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();
  return data?.household_id ?? null;
}
```

### 3. Standard Server Action shape

```ts
'use server';
import { createClient } from '@/lib/supabase/server';

export type XActionResult = { success: true } | { success: false; error: string };

export async function saveX(payload: XPayload): Promise<XActionResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: 'Not authenticated' };

  // Validate inputs here (no Zod yet — manual guards are fine)

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return { success: false, error: 'No active household found' };

  const { error } = await supabase.from('your_table').upsert({ household_id: householdId, ...payload });
  if (error) return { success: false, error: 'Failed to save. Please try again.' };
  return { success: true };
}
```

### 4. Client component consumption

```tsx
'use client';
import { saveX } from './actions';

// In handler:
const result = await saveX(payload);
if (!result.success) setSaveError(result.error);
```

### 5. Replace alert() with inline error banner

```tsx
{saveError && (
  <div role="alert" className="... text-red-300">
    <span>{saveError}</span>
    <button onClick={() => setSaveError(null)}>✕</button>
  </div>
)}
```

### 6. Unit test skeleton (vitest)

Mock `@/lib/supabase/server` with `vi.mock(...)` and test:
- Unauthenticated → error, no DB write
- No household → error, no DB write
- Happy path → household_id from session passed to upsert
- DB error → error returned to caller

---

## RLS green-light

All target tables have full RLS coverage (Rabin audit, `rls-coverage-audit.md`).
Using the Supabase anon key with the SSR client means RLS is always enforced.
**Never use the service-role key in Server Actions that handle user data.**

---

## What stays in FastAPI

Heavy compute: backtest, analyze/*, synthesis, growth-story. These do NOT
become Server Actions — they stay Docker-local and are called via
`apiFetch('/api/analyze/...')` with `NEXT_PUBLIC_API_URL`.

# Decision: Auto-provision household on signup via DB trigger

**Author:** Hockney (Backend Dev)
**Date:** 2026-05-02
**Status:** Implemented — migration `20260502120000_auto_provision_household_on_signup.sql`

## Context

When the frontend migrated from FastAPI `/api/finances` to a Next.js Server Action writing directly to Supabase (PR #140), the `resolveHouseholdId()` helper began returning `null` for users with no `household_members` row. The FastAPI backend had implicitly handled household provisioning at the application layer; there was no DB-level guarantee.

## Decision

**Add a Postgres trigger** (`trg_auth_users_create_household`) on `auth.users` AFTER INSERT that:
1. Inserts a personal `households` row (name derived from `raw_user_meta_data.full_name` → `email` → `'My Household'`)
2. Inserts an `owner` row in `household_members`

This follows the same pattern as `trg_auth_users_create_profile` (migration `20260430130400`): SECURITY DEFINER + `SET search_path = public, auth`.

Also included: an idempotent backfill for all existing `auth.users` rows without an active household membership.

## Rationale

- **Trigger is the correct long-term fix**: it fires at the DB layer regardless of whether provisioning comes from FastAPI, a Server Action, OAuth, or a future CLI tool.
- **Option B (frontend lazy-create)** was rejected: it would require a `service_role` client in a Server Action (bypasses RLS), and it pushes a DB invariant into application code.
- Minimally invasive: no changes to the Server Action, no new tables, no RLS changes.

## Affected Teams

- **Frontend (Fenster):** No changes required. `resolveHouseholdId` will now always find a row for authenticated users.
- **Backend (Hockney):** The existing `get_user_household_id()` service function continues to work correctly; it is a pure lookup.
- **Data (McManus):** The trigger mirrors the `handle_new_auth_user()` pattern already in `20260430130400`. Schema is unchanged.

# Soften /api Rewrite Guard — Skip Instead of Throw

**Author:** Kujan (DevOps)
**Date:** 2026-04-30
**Status:** MERGED
**PR:** #139

## Decision

The production guard in `apps/frontend/next.config.ts` that throws when `NEXT_PUBLIC_API_URL` is missing has been replaced with a **skip-with-warning** pattern.

## Why

The architecture directive is: **frontend talks to Supabase directly via Server Actions — no public backend exists on Vercel.** Therefore, `NEXT_PUBLIC_API_URL` will never be set on Vercel (production or preview), making the original guard block all Vercel builds.

Evidence: PR #138 (`squad/finances-server-action`) failed its Vercel preview deploy due to the missing env var.

## What Changed

1. **When `NODE_ENV === 'production'` and `NEXT_PUBLIC_API_URL` is missing/empty/private/localhost:**
   - Log a clear warning that `/api/*` rewrites are disabled (this is expected).
   - Return empty rewrites array (so unmigrated `/api/*` call sites will get a 404 at runtime — fail-fast, desired behavior).

2. **When `NODE_ENV === 'production'` and `NEXT_PUBLIC_API_URL` is a valid public URL:**
   - Register the rewrite as before (preserves opt-in for self-hosted backend deployments).

3. **Dev environment (`NODE_ENV !== 'production'):**
   - Fallback to `http://127.0.0.1:8000` (Docker Compose or Aspire) — unchanged.

4. **Invalid URLs in production:**
   - Still throw with a clear error (bad format, wrong protocol, etc.) — actual configuration errors should fail-fast.

## Key Insight

Guard logic should distinguish between:
- **Intended absence** (e.g., no backend URL on Vercel) → skip gracefully with warnings
- **Actual configuration errors** (e.g., invalid URL format) → fail-fast with errors

The architecture directive is the source of truth for what's intended.

## Testing

✓ Production build succeeds without `NEXT_PUBLIC_API_URL`
✓ Warning message correctly logged
✓ Dev environment fallback verified

## Impact

- **Unblocks** Vercel preview deploys (PR #138 and future PRs).
- **Preserves** opt-in rewrite behavior for self-hosted backends.
- **Improves** error messaging for actual configuration problems.
