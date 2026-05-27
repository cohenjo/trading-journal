# Shared Decisions & Directives

**Older entries archived to `.squad/decisions-archive/`.**

## Active Architectural Directives

### 2026-05-27: RSU Automation & Dividend Handling (consolidated)

**By:** Keaton (Lead), Hockney (Backend), McManus (Engine), Fenster (Frontend), Redfoot (Tester), via Copilot directive

**What:**

RSU accounts (Wix RSU, MSFT RSU) require special handling across the entire system:

1. **Pricing & Dividend Data**
   - Extended `price_cache` table with `dividend_yield NUMERIC(18,8)` column (migration `e5f6a7b8c9d0`)
   - New worker `rsu_plan_hydration` (cron `5 22 * * MON-FRI`) scans all plans for RSU items and patches JSON with current price, yield, fixed 25% tax rate, and Payout policy
   - New API endpoint `GET /api/finances/price-data/{symbol}` returns cached price + yield
   - Yahoo Finance resolution: MSFT and WIX are NASDAQ-listed; resolved as-is. Dividend yield stored as decimal fraction (0.0087 for 0.87%). Zero-yield tickers (WIX) store `null`.

2. **Tax & Policy Enforcement**
   - **Dividend tax rate = 25% fixed** (not plan-level `incomeTaxRate`). Applied via `applyRsuDividendOverrides()` in both `PlanEngine.ts` and `simulation.ts`
   - **Dividend policy = Payout mandatory** — RSU dividends cannot be reinvested; they flow to income pool as ordinary income
   - User can explicitly override tax rate to non-zero value; 25% is only applied when current rate is zero
   - `gross.gt(0)` guard prevents spurious zero-value dividend lines for zero-yield accounts (e.g., Wix)

3. **Frontend UI**
   - Dividend Policy section entirely hidden (not disabled) for RSU accounts — RSU Configuration block is the single authoritative surface
   - `dividendYieldOverride` flag does not reset on ticker change (preserves user intent)
   - RSU Config block visible only in planning mode (snapshots are read-only)
   - `stock_symbol` is the canonical field name in `account_settings` (not `ticker`)
   - Defensive integration: RSU code casts `data as typeof data & { dividend_yield?: number }` for forward compatibility with Hockney's endpoint extension

4. **Acceptance Criteria** (10 criteria + edge cases; all pass: 21 backend + 12 component + 13 engine tests = 46 new tests passing)
   - AC1–AC4: Price refresh, zero-yield handling, tax rate, payout policy
   - AC5–AC9: UI rendering, ticker lookup, error handling, currency conversion
   - AC10: Edge cases (zero yield, user override, multiple RSU accounts, zero shares)

**Why:**

- User-stated business rules for employer RSU grants: fixed 25% withholding tax, mandatory payout (no reinvestment), live price/yield updates
- RSU dividends are taxed as ordinary income in Israel, not capital gains
- Broker doesn't allow DRIP on RSU dividends → must route to income pool
- Extending `price_cache` is simpler than syncing RSU → `stock_positions`
- Unified rule enforcement across backend, frontend engine, and UI prevents divergent behavior

**Implementation Status:**

| Component | Status | Notes |
|-----------|--------|-------|
| Backend: `price_cache` migration | ✅ Done | Column added, `PriceQuote.dividend_yield` defined |
| Backend: `rsu_plan_hydration` worker | ✅ Done | Cron registered, JSON patching implemented |
| Backend: `/price-data/{symbol}` endpoint | ✅ Done | Returns cached price + yield |
| Backend tests | 71 passed, 3 skipped | — |
| Frontend: Engine (`PlanEngine.ts` + `simulation.ts`) | ✅ Done | RSU overrides + 25% tax + Payout enforcement |
| Frontend: Engine tests | 42/42 pass | — |
| Frontend: UI (`PlanAccountDetails.tsx` + yield banner) | ✅ Done | Hidden Dividend Policy, override toggle, readonly yield display |
| Frontend: UI tests | 23/23 pass | 13 pre-existing failing tests repaired |
| Acceptance tests | 46 new tests: 21 backend, 12 component, 13 engine | All pass ✅ |

**Known Issues & Follow-ups:**

1. ⚠️ **Yield units convention mismatch** — `plan_components.py:278` divides by 100, assuming percentage form; `price_cache` stores decimal fraction. A follow-up Hockney spawn is normalizing units (pending: `hockney-rsu-yield-units.md`)

2. User override of `dividend_tax_rate` to non-zero value wins over 25% default — this is intentional (AC10b covers this)

3. If user switches account type Broker → RSU → Broker, previous Dividend Policy settings are lost (acceptable trade-off; RSU Config block is authoritative while type=RSU)

**Branch:** `squad/rsu-ui-wiring`

**Design Memo:** `.squad/log/2026-05-27-rsu-automation-design.md`

**Related Decisions Merged from Inbox:**
- `copilot-rsu-rules.md` (user directive)
- `keaton-rsu-design.md` (architecture)
- `hockney-rsu-pricing.md` (backend pricing pipeline)
- `mcmanus-rsu-tax-model.md` (engine tax rules)
- `fenster-rsu-ui.md` (UI decisions)
- `redfoot-rsu-acceptance.md` (acceptance criteria)
