# Options Income Dashboard Design & Architecture

**Status:** Proposed — design only

**Author:** Keaton (Lead), with Hockney (Backend), McManus (Data/Finance), Fenster (Frontend) perspectives

**Date:** 2026-05-04

---

## 1. Overview

The goal is to replace/enhance the current `/options` page with an Options Income Dashboard that shows the two layers Jony needs to manage an income-selling options strategy:

1. **Cash flow / liquidity reality** — premium received, premium paid, commissions, and resulting net cash movement.
2. **Realized P&L / economic reality** — matched-lot profit or loss when legs are closed, expire, are assigned, or are exercised.

This matters most for rolls. A roll can increase cash flow while also crystallizing a loss. The dashboard should therefore make the **variance gap** between cash flow and realized P&L a first-class metric instead of treating premium collected as income by itself.

Current repo anchors:

- `apps/frontend/src/app/options/page.tsx` currently renders a basic projection chart from `options_income`.
- `apps/frontend/src/app/options/actions.ts` reads/writes `public.options_income` through Server Actions and Decimal.js calculations.
- `supabase/migrations/20260503142446_add_options_income.sql` defines the current manual yearly totals table.
- `supabase/migrations/20260430115000_baseline_legacy_schema.sql` already includes legacy IB Flex-shaped `trade`, `execution`, `optioncontract`, and historical option tables that can be used as raw substrate or migration reference.
- `apps/backend/app/api/options.py` is legacy FastAPI and deprecated for projection use.
- `apps/backend/app/services/analysis/options_analytics.py` has reusable Decimal-based primitives for CSP breakeven and return-on-capital-style calculations.
- `apps/backend/app/services/data_ingestion.py`, `apps/backend/app/services/trading_batch.py`, and `apps/backend/app/worker/registry.py` show the existing IB Gateway / `ib_async` and APScheduler worker pattern.
- `supabase/migrations/20260503161310_add_compute_jobs.sql` establishes the TJ-020 worker queue and realtime pattern.

---

## 2. Goals & Non-goals

### Goals

- Show **Net Cash Flow** by period and cumulative over time.
- Show **Realized P&L** by period and cumulative over time using matched lots.
- Show **Variance Gap** = cumulative cash flow minus cumulative realized P&L, especially around rolls.
- Model rolls explicitly so the UI can explain when added credit masked a realized loss.
- Track capital efficiency for income strategies:
  - Capital at Risk.
  - Return on Capital at Risk.
  - Margin Utilization from IBKR-reported margin/buying-power data.
  - Roll Efficiency Score.
- Support Jony's common strategies: cash-secured puts, bullish put spreads, vertical spreads, iron condors, and roll sequences.
- Keep the frontend architecture aligned with TJ-020: the Next.js app talks only to Supabase; Python workers read/write Supabase tables.
- Use `Decimal` / `decimal.Decimal` for monetary calculations and `numeric(18,6)` for persisted monetary values.
- Maintain household-scoped RLS and expose only cooked/read-model data to authenticated household members.

### Non-goals

- **No implementation in this document.** This is design only.
- No live greeks dashboard, implied volatility surface, or full mark-to-market P&L engine in the first release.
- No unrealized greeks/MTM tracking as a primary dashboard metric. Open-position MTM can be a later add-on, but this dashboard is about realized income quality.
- No order-entry or trading execution.
- No multi-broker production rollout in the first slice; the current user is a single household and IBKR-only.
- No replacement of the broader trading journal schema until the options domain model proves itself.

---

## 3. Recommended Architecture

**Decision:** Use **IBKR Flex Query as the primary ingestion source**, with the existing **IB Gateway / `ib_async` worker as a fallback and freshness supplement**.

**Why:** Flex Query is the best fit for the hard problem: tax-prep-quality cash flow, realized P&L, option exercises, assignments, expirations, and closed-lot economics. IB Gateway is already live and useful for intraday positions, margin snapshots, and operational freshness, but reconstructing authoritative realized P&L and rolls from live executions alone is more brittle. SnapTrade is attractive for future multi-broker support, but for this IBKR-only household it adds a vendor layer while still relying on IBKR report-style data underneath.

### Stack summary

| Layer | Decision | Notes |
|---|---|---|
| Ingestion primary | IBKR Flex Query | Daily/T+1 authoritative reports for trades, cash transactions, positions, exercises/assignments/expirations. |
| Ingestion fallback | Existing IB Gateway / `ib_async` | Use for same-day positions, account summary, margin, and gap checks. |
| Worker | Python Docker worker | Add an `options_income_sync` scheduled/queued job using the `compute_jobs` pattern. |
| Storage | Supabase Postgres | New `public.options_*` household-scoped tables; keep legacy tables separate. |
| UI | Next.js 15 on Vercel | Server Actions read cooked tables; client components subscribe to realtime freshness/job status as needed. |
| Frontend charts | `lightweight-charts` | Already used by `OptionsChart`, dividend, backtest, and dashboard charts. |

---

## 4. Data Source Selection

### 4.1 Option A — IBKR Flex Query

IBKR Flex Query provides configurable XML reports fetched via the Flex Web Service API. Jony linked IBKR's Options, Exercises and Expirations reference, which includes assignments, exercises, expirations, cash settlement, proceeds, commissions/taxes, basis, realized P/L, MTM P/L, and trade IDs.

**Pros for this user**

- Most authoritative source for tax-prep and realized P&L.
- Covers the events that matter for options income quality: trades, cash transactions, open/closed positions, exercises, assignments, and expirations.
- Existing legacy `public.trade` shape already resembles IB Flex output (`tradeID`, `netCash`, `fifoPnlRealized`, `openCloseIndicator`, `putCall`, `expiry`, `strike`).
- Works naturally with a worker batch that writes durable raw facts and cooked metrics.
- Does not require IB Gateway to be running at exact ingestion time.

**Cons**

- Usually T+1 / report-lagged, not live.
- XML parsing and query-token configuration are extra setup steps on the IBKR website.
- Flex tokens are per-query/report configuration, so operational setup must be documented and monitored.
- Roll detection still requires domain heuristics; Flex does not directly say, "this was a roll" in the way the dashboard needs.

### 4.2 Option B — SnapTrade

SnapTrade exposes account details, positions, balances, orders, and account activities through a broker-aggregation API. SnapTrade's IBKR integration uses an IBKR Query ID and Token through IBKR's Third-Party Reports configuration.

**Pros for this user**

- Easier if the app later supports Schwab, Fidelity, or multiple household brokerages.
- OAuth-style connection UX and hosted broker integration management.
- Account data model includes activities, balances, positions, and intraday-ish orders depending on broker support.
- Avoids writing Flex XML plumbing directly.

**Cons**

- Extra vendor dependency, cost, uptime, security, and data-contract surface.
- Options-specific lifecycle detail may be less granular than direct Flex reports, especially assignments, exercises, expirations, and roll economics.
- Data freshness varies by broker and endpoint; activities are commonly daily.
- For IBKR, it still depends on IBKR report tokens, so it does not eliminate the core IBKR configuration step.
- Less ideal for tax-prep accuracy unless every needed IBKR field is preserved and validated.

### 4.3 Option C — Existing IB Gateway / `ib_async`

The repo already has IB Gateway integration in `apps/backend/app/services/data_ingestion.py` and the trading sync batch in `apps/backend/app/services/trading_batch.py`. `apps/backend/app/worker/registry.py` schedules `trading_sync` every 15 minutes.

**Pros for this user**

- Already wired and already running on Jony's laptop.
- Best freshness story for live positions, account summary, margin utilization, and same-day operational awareness.
- No third-party vendor beyond IBKR.
- Fits the worker architecture from TJ-020.

**Cons**

- Requires IB Gateway to be running and authenticated.
- Live execution streams and current positions are not enough for authoritative historical taxable realized P&L without substantial reconciliation.
- Roll detection from raw executions is complex and easy to misclassify without closed-lot/report context.
- Historical exercises/assignments/expirations can be harder to reconstruct than reading Flex sections directly.

### 4.4 Final recommendation

Use **Flex Query as primary** and **IB Gateway as fallback/freshness supplement**.

Implementation posture:

1. Flex Query is the source of truth for `options_trades`, `options_cash_events`, assignment/exercise/expiration events, matched realized P&L, and backfill.
2. IB Gateway supplements same-day `options_positions`, account equity, buying power, and margin snapshots.
3. If Flex is unavailable for a day, IB Gateway can mark the dashboard as "intraday estimate" while preserving the last authoritative Flex sync.
4. SnapTrade remains a future adapter only if multi-broker support becomes a real requirement.

---

## 5. Domain Model

The key design decision is to make **rolls and strategy grouping first-class**. A roll is not merely two unrelated trades; it is a realized close plus a new exposure that may improve cash flow while worsening realized P&L.

### 5.1 Concepts

#### `OptionLeg`

An atomic option contract:

- Underlying symbol, IBKR `conid`, expiry, strike, right (`call`/`put`), multiplier, currency.
- Equivalent to a normalized, household-visible successor to legacy `optioncontract` for options-income workflows.

#### `Trade`

An execution/lifecycle event:

- Event kinds: `open`, `close`, `expire`, `assign`, `exercise`, `cash_settle`, `adjustment`.
- Contains cash impact and realized P&L impact as separate fields.
- Links to `OptionLeg` and optionally to a matched opening trade/lot.
- For Flex-backed rows, stores source IDs (`tradeID`, `transactionID`, `ibExecID`) in raw/source fields.

#### `Position`

Current open lots:

- Derived from trades using FIFO by default.
- Stores quantity remaining, average/open premium, opened date, and current strategy group.
- For UI speed, maintained by the worker as a current-position read model rather than recomputed in the browser.

#### `StrategyGroup`

A logical grouping of related option trades:

- Examples: one cash-secured put, one vertical spread, one iron condor, or a multi-step roll chain.
- Carries strategy type, underlying, lifecycle status, opened/closed timestamps, net cash flow, realized P&L, and capital-at-risk summary.
- This is the object rendered in the Trade Lifecycle Timeline.

#### `RollEvent`

A detected/confirmed linkage between a closing trade and a replacement opening trade:

- Same household and underlying.
- Same option right (`put` or `call`) for simple rolls.
- Closing trade quantity and opening trade quantity overlap materially.
- Replacement open occurs within the configured time window.
- Expiry is later and/or strike changes in a direction consistent with repositioning.
- Stored explicitly so future recalculations do not silently change historical roll classification.

### 5.2 Roll detection heuristic

Default heuristic for Phase 2:

1. Candidate close trade has `event_type in ('close', 'expire', 'assign', 'exercise')` or Flex `openCloseIndicator = 'C'`.
2. Candidate open trade has `event_type = 'open'` or Flex `openCloseIndicator = 'O'`.
3. Same household, account, underlying, currency, and option right.
4. Open trade timestamp is within **same trading day by default**, configurable to 15 minutes, 60 minutes, or same-day.
5. Quantity overlap is at least **80%** of the closed absolute quantity.
6. New expiry is later than the closed expiry, or strike differs by at least one strike increment while expiry stays similar.
7. For spreads, pair legs into a strategy candidate first, then detect roll at the spread/strategy level when both a short and long leg are repositioned near-simultaneously.
8. Mark result as `detected`; allow manual override to `confirmed` / `rejected` in a later UI phase.

The worker stores the linkage in `options_roll_events`. Metric recomputation reads stored links first and only runs the heuristic for unclassified trades.

---

## 6. Proposed Supabase Tables

These are DDL sketches for future migrations, not implementation in this PR. All monetary values use `numeric(18,6)`. All tables in `public` must have RLS enabled and household policies matching `public.is_household_member()` / `public.is_household_writer()` patterns used by `options_income`.

### 6.1 Source sync state

```sql
create type public.options_sync_source as enum ('ibkr_flex', 'snaptrade');
-- Note: 'ib_gateway' removed — IB Gateway integration deprecated in favor of Flex queries
create type public.options_sync_status as enum ('pending', 'running', 'succeeded', 'failed');

create table public.options_sync_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source public.options_sync_source not null,
  status public.options_sync_status not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  statement_from date,
  statement_to date,
  rows_seen integer not null default 0,
  rows_inserted integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

Realtime: yes, for freshness indicators and sync banners.

### 6.2 Option legs

```sql
create type public.option_right as enum ('call', 'put');

create table public.options_legs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  source_conid bigint,
  underlying_symbol text not null,
  option_symbol text,
  expiry date not null,
  strike numeric(18,6) not null,
  right public.option_right not null,
  multiplier numeric(18,6) not null default 100,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, account_id, source_conid),
  unique (household_id, account_id, underlying_symbol, expiry, strike, right, multiplier, currency)
);
```

Realtime: usually no; legs change through ingestion and are referenced by cooked tables.

### 6.3 Strategy groups

```sql
create type public.options_strategy_type as enum (
  'cash_secured_put',
  'vertical_spread',
  'iron_condor',
  'covered_call',
  'single_leg',
  'unknown'
);

create type public.options_strategy_status as enum ('open', 'closed', 'expired', 'assigned', 'mixed');

create table public.options_strategy_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  underlying_symbol text not null,
  strategy_type public.options_strategy_type not null default 'unknown',
  status public.options_strategy_status not null default 'open',
  opened_at timestamptz not null,
  closed_at timestamptz,
  parent_group_id uuid references public.options_strategy_groups(id),
  net_cash_flow numeric(18,6) not null default 0,
  realized_pnl numeric(18,6) not null default 0,
  capital_at_risk numeric(18,6),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Realtime: yes, because timeline and KPI cards should update when a worker links rolls or refreshes metrics.

### 6.4 Trades

```sql
create type public.options_trade_event_type as enum (
  'open', 'close', 'expire', 'assign', 'exercise', 'cash_settle', 'adjustment'
);

create type public.options_trade_side as enum ('buy', 'sell');

create table public.options_trades (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  leg_id uuid not null references public.options_legs(id),
  source public.options_sync_source not null,
  source_trade_id text,
  source_transaction_id text,
  source_exec_id text,
  event_type public.options_trade_event_type not null,
  side public.options_trade_side not null,
  trade_time timestamptz not null,
  trade_date date not null,
  quantity numeric(18,6) not null,
  price numeric(18,6) not null,
  gross_amount numeric(18,6) not null,
  commission numeric(18,6) not null default 0,
  fees numeric(18,6) not null default 0,
  net_cash_flow numeric(18,6) not null,
  realized_pnl numeric(18,6) not null default 0,
  matched_open_trade_id uuid references public.options_trades(id),
  fifo_lot_id uuid,
  currency text not null default 'USD',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, source, source_trade_id, source_transaction_id, source_exec_id)
);
```

Realtime: optional; the UI should generally read aggregated tables, not subscribe to every execution.

### 6.5 Cash events

Non-trade cash transactions matter for reconciliation, assignment/exercise cash settlement, fees, and tax estimates. They should remain separate from execution-level option trades but can contribute to dashboard reconciliation when `event_category = 'option_related'`.

```sql
create type public.options_cash_event_category as enum (
  'option_related', 'commission_fee', 'tax_withholding', 'interest', 'dividend', 'transfer', 'other'
);

create table public.options_cash_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  source public.options_sync_source not null,
  source_transaction_id text,
  event_date date not null,
  event_time timestamptz,
  event_category public.options_cash_event_category not null,
  description text,
  amount numeric(18,6) not null,
  currency text not null default 'USD',
  related_trade_id uuid references public.options_trades(id) on delete set null,
  related_strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, source, source_transaction_id)
);
```

Realtime: optional; these feed reconciliation and cooked metrics rather than primary visual blocks.

### 6.6 Positions

```sql
create table public.options_positions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  leg_id uuid not null references public.options_legs(id),
  opened_at timestamptz not null,
  quantity_open numeric(18,6) not null,
  average_open_price numeric(18,6) not null,
  open_cash_flow numeric(18,6) not null,
  capital_at_risk numeric(18,6),
  ib_margin_requirement numeric(18,6),
  last_broker_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Realtime: yes for open-contract counts and margin gauges if IB Gateway sync updates intraday.

### 6.7 Roll events

```sql
create type public.options_roll_classification as enum ('positive', 'negative', 'neutral');
create type public.options_roll_detection_status as enum ('detected', 'confirmed', 'rejected', 'manual');

create table public.options_roll_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  strategy_group_id uuid not null references public.options_strategy_groups(id) on delete cascade,
  closed_trade_id uuid not null references public.options_trades(id),
  opened_trade_id uuid not null references public.options_trades(id),
  detected_at timestamptz not null default now(),
  detection_status public.options_roll_detection_status not null default 'detected',
  classification public.options_roll_classification not null,
  closed_leg_realized_pnl numeric(18,6) not null,
  incremental_cash_flow numeric(18,6) not null,
  old_expiry date,
  new_expiry date,
  old_strike numeric(18,6),
  new_strike numeric(18,6),
  heuristic_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Realtime: yes, because roll detection can change timeline and roll-efficiency widgets.

### 6.8 Aggregated dashboard series

```sql
create table public.options_dashboard_monthly_metrics (
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  period_start date not null,
  period_end date not null,
  net_cash_flow numeric(18,6) not null default 0,
  realized_pnl numeric(18,6) not null default 0,
  cumulative_cash_flow numeric(18,6) not null default 0,
  cumulative_realized_pnl numeric(18,6) not null default 0,
  variance_gap numeric(18,6) not null default 0,
  tax_estimate numeric(18,6),
  capital_at_risk_avg numeric(18,6),
  return_on_capital_at_risk numeric(18,6),
  margin_utilization numeric(18,6),
  positive_roll_count integer not null default 0,
  negative_roll_count integer not null default 0,
  neutral_roll_count integer not null default 0,
  last_computed_at timestamptz not null default now(),
  primary key (household_id, account_id, period_start)
);
```

Realtime: yes, this is the main `/options` read model.

### 6.9 RLS and grants expectations

Each table should follow the same household pattern as `public.options_income`:

```sql
alter table public.options_trades enable row level security;

create policy options_trades_select
  on public.options_trades for select to authenticated
  using (household_id is not null and public.is_household_member(household_id));

create policy options_trades_insert
  on public.options_trades for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

create policy options_trades_update
  on public.options_trades for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));
```

Worker writes should use service-role access from the local Docker worker, not browser credentials. Frontend reads should use authenticated household-scoped Supabase clients. Realtime publication should be added only for `options_sync_runs`, `options_strategy_groups`, `options_positions`, `options_roll_events`, `options_dashboard_monthly_metrics`, and any job-status tables needed for freshness banners.

---

## 7. Computations / Metrics

All monetary math should use `decimal.Decimal` in Python workers and Decimal.js in any Server Action fallback. Persisted values use `numeric(18,6)`.

### 7.1 Net Cash Flow per period

**Formula:**

```text
Net Cash Flow = Σ (premium received - premium paid - commissions - fees)
```

Implementation detail:

- Selling an option generally creates positive cash flow.
- Buying to close generally creates negative cash flow.
- Commissions and fees always reduce cash flow.
- Group by `trade_date` for daily rows and by calendar month for the dashboard.
- Prefer IBKR Flex `netCash` when available; otherwise compute from side, price, quantity, multiplier, commission, and fees.

### 7.2 Realized P&L per period

**Formula for matched lots, FIFO default:**

```text
Realized P&L = Σ (closing value - opening basis - closing commissions - allocated opening commissions)
```

For short premium strategies, this can be equivalently framed as:

```text
Realized P&L = opening credit - closing debit - allocated commissions/fees
```

Rules:

- Date realized by close/expiration/assignment/exercise date.
- FIFO is the default matching assumption unless Jony chooses LIFO or broker-reported lot matching.
- For Flex rows with `fifoPnlRealized`, use IBKR's realized P&L as authoritative and store matching metadata. Worker-calculated FIFO is a reconciliation path, not the primary source when Flex is available.

### 7.3 Variance Gap

**Rolling cumulative formula:**

```text
Variance Gap(window) = Σ Net Cash Flow(window) - Σ Realized P&L(window)
```

Interpretation:

- Positive gap: cash collected exceeds realized economic profit; common during rolls or still-open premium.
- Negative gap: realized P&L exceeds net cash flow, possible after closing previously credited positions.
- The dashboard should show the gap as a warning/diagnostic, not as inherently good or bad.

### 7.4 Capital at Risk

Rules by strategy type:

- **Cash-secured put:**

```text
Capital at Risk = strike × multiplier × absolute(short contracts)
```

Optionally subtract premium received for max-loss-style view, but the gauge should default to gross cash-secured obligation because that matches liquidity planning.

- **Bullish put spread / vertical credit spread:**

```text
Capital at Risk = (short strike - long strike) × multiplier × contracts - net credit received
```

Use absolute strike width and cap at zero.

- **Iron condor:**

```text
Capital at Risk = max(call spread width, put spread width) × multiplier × contracts - net credit received
```

- **Undefined / ungrouped:**

Use broker-reported margin requirement when available; otherwise mark as `unknown` and exclude from Return on Capital at Risk denominator.

### 7.5 Return on Capital at Risk

**Formula:**

```text
Return on Capital at Risk = Realized P&L / Time-weighted Capital at Risk
```

Time weighting:

```text
Time-weighted Capital at Risk = Σ(capital_at_risk_for_group × days_open_in_window) / days_in_window
```

Notes:

- This should be computed by the worker because it needs positions, strategy groups, and day counts.
- Display as a percentage for the selected time window.
- If denominator is zero/unknown, show an empty state rather than `Infinity` or `0%`.

### 7.6 Margin Utilization

**Formula:**

```text
Margin Utilization = IBKR reported margin requirement / Net Liquidation Value
```

Alternative if IBKR reports available funds/buying power more reliably:

```text
Margin Utilization = 1 - (Available Funds / Net Liquidation Value)
```

Source:

- Prefer IB Gateway account summary for same-day margin.
- Flex can provide account-level snapshots for daily history if configured.
- Store in `options_positions.ib_margin_requirement` or a future `options_margin_snapshots` table.

### 7.7 Roll Efficiency

Per `RollEvent`:

```text
classification =
  Positive if closed_leg_realized_pnl >= neutral_threshold
  Negative if closed_leg_realized_pnl <= -neutral_threshold
  Neutral otherwise
```

Default `neutral_threshold`: `$25` or user-configurable.

Score:

```text
Roll Efficiency Score = positive_roll_count / total_classified_roll_count
```

The donut should show positive / negative / neutral percentages, not only the score, because a strategy can have many neutral defensive rolls.

### 7.8 Worked example from Jony

Jony's sequence:

1. Month 0: Bullish put spread sold for 2 months, `+$3,000` cash, no realized P&L yet.
2. Month 1: Roll lower leg, `+$200` cash, `-$1,000` realized loss.
3. Month 2: Close everything, `-$500` cash, `+$2,000` realized gain.

| Period | Net Cash Flow | Realized P&L | Cumulative Cash Flow | Cumulative Realized P&L | Variance Gap |
|---|---:|---:|---:|---:|---:|
| Month 0 | +3,000 | 0 | +3,000 | 0 | +3,000 |
| Month 1 | +200 | -1,000 | +3,200 | -1,000 | +4,200 |
| Month 2 | -500 | +2,000 | +2,700 | +1,000 | +1,700 |

Final interpretation:

- Cash collected: `+$2,700`.
- Realized economic profit: `+$1,000`.
- Variance gap: `+$1,700`.
- The Month 1 roll is **Negative** if the Roll Efficiency classification uses the closed leg's `-$1,000` realized P&L.

---

## 8. Computation Flow / Metric Ownership

Default rule: compute anything aggregating many trades, matching lots, or classifying rolls in the Python worker; keep Server Actions for reading already-aggregated rows and small UI-level transformations.

### 8.1 Worker-owned computations

Add an `options_income_sync` job to the TJ-020 worker pattern:

- `compute_jobs` queued job for manual refresh/backfill.
- Optional scheduled job for daily Flex refresh.
- Optional IB Gateway supplement on the existing 15-minute `trading_sync` cadence or a dedicated `options_intraday_sync` job.

Worker responsibilities:

1. Fetch Flex XML for configured query IDs/tokens.
2. Parse raw report sections into normalized source rows.
3. Upsert `options_legs` and `options_trades` idempotently.
4. Match lots using broker/Flex matching first, FIFO fallback second.
5. Rebuild `options_positions`.
6. Detect/update `options_strategy_groups`.
7. Detect/update `options_roll_events`.
8. Compute `options_dashboard_monthly_metrics`.
9. Write `options_sync_runs` and `compute_jobs.result` for UI freshness.

Metrics that must live in worker/cooked tables:

- Matched realized P&L.
- Strategy grouping.
- Roll detection and roll efficiency.
- Capital-at-risk and time-weighted return.
- Margin utilization history.
- Monthly/cumulative series for charting if source rows exceed a small threshold.

### 8.2 Server Action-owned logic

`apps/frontend/src/app/options/actions.ts` should evolve from projection CRUD toward dashboard reads:

- Resolve household from authenticated Supabase session, as it already does.
- Read `options_dashboard_monthly_metrics`, latest `options_sync_runs`, current `options_positions`, and top strategy groups.
- Use Decimal.js only for small presentation calculations on already-aggregated values, such as selected-window sums or percent formatting.
- Insert a `compute_jobs` row for "Refresh options income" and subscribe to job status using the existing realtime pattern from `compute-job-subscriptions.ts`.

### 8.3 Browser/client-owned logic

Client components should handle:

- Chart rendering.
- Responsive layout.
- Tooltip calculations based on already-provided values.
- Loading, empty, stale, and error states.

The browser should not perform FIFO matching, roll detection, or large aggregations.

---

## 9. UI Design for `/options`

The new page should replace the current projection-focused screen in `apps/frontend/src/app/options/page.tsx`. The existing manual `options_income` projection can be retained temporarily under a collapsible "Legacy projection" section or moved to a settings/admin route.

### 9.1 Page layout

Top to bottom:

1. Header: "Options Income" with last sync status, source badge (`Flex authoritative`, `IB Gateway intraday estimate`), and refresh action.
2. KPI strip:
   - Total Account Equity / virtual options sub-account equity.
   - Open Contracts.
   - Days to Earliest Expiration.
   - Last Authoritative Sync.
3. Main chart and variance badge.
4. Efficiency gauges.
5. Trade lifecycle timeline and roll efficiency donut.
6. Recent roll/event table for auditability.

### 9.2 Components

#### `<NetCashFlowVsRealizedChart>`

Maps to the mockup's line+bar combo:

- Monthly bars: `net_cash_flow`.
- Solid line: cumulative `realized_pnl`.
- Optional second line: cumulative `net_cash_flow` if the chart needs direct variance visualization.
- Dotted line: tax estimate, if configured.
- Use `lightweight-charts`, consistent with `OptionsChart.tsx` and other chart components.
- Tooltip shows monthly cash flow, monthly realized P&L, cumulative cash flow, cumulative realized P&L, and gap.

#### `<VarianceGapBadge>`

Single prominent number:

```text
Variance Gap = Cumulative Cash Flow - Cumulative Realized P&L
```

Breakdown:

- Cash Flow: `+$2,700`.
- Realized P&L: `+$1,000`.
- Gap: `+$1,700`.

Visual behavior:

- Neutral styling if gap is within a user-configured threshold.
- Warning styling for large positive gaps because cash flow materially exceeds economic profit.
- Explain-on-hover: "Positive gap often means open risk or roll losses not visible in cash flow."

#### `<EfficiencyGauges>`

Two semicircle gauges:

1. Return on Capital at Risk.
2. Margin Utilization.

Gauge states:

- Loading: skeleton arc.
- Unknown denominator: "Needs capital-at-risk classification".
- Stale margin data: show timestamp and warning icon.

#### `<TradeLifecycleTimeline>`

Horizontal Gantt-style timeline:

- One row per `options_strategy_groups` item.
- Nodes for Initial Spread → Reposition Leg / Roll → Close / Expire / Assign.
- Color nodes by event result: positive, negative, neutral, unclassified.
- Click opens a details drawer showing legs, trades, cash flow, realized P&L, and roll heuristic explanation.

#### `<RollEfficiencyDonut>`

Donut chart:

- Positive roll percentage.
- Negative roll percentage.
- Neutral roll percentage.
- Center label: Roll Efficiency Score.
- Footer: count of classified roll events and neutral threshold.

#### KPI strip

- **Total Account Equity**: from IBKR account summary; label as "virtual options account" if filtered to specific accounts/underlyings.
- **Open Contracts**: sum absolute `options_positions.quantity_open` by leg/contract.
- **Days to Earliest Expiration**: min open `options_legs.expiry - today`.
- **Freshness**: latest successful Flex sync and latest IB Gateway sync.

### 9.3 Empty, loading, stale, and error states

- No Flex configured: show setup checklist with "Create IBKR Flex Query", "Add Query ID/Token to worker env", "Run Phase 0 validation".
- No trades found: show empty dashboard with a short explanation and keep refresh action enabled.
- Worker running: subscribe to `compute_jobs` / `options_sync_runs` realtime and show progress.
- Flex stale but IB Gateway fresh: show "Intraday estimate — realized P&L last authoritative as of {date}".
- IB Gateway offline: keep Flex dashboard visible; hide/mark margin utilization as stale.
- Roll classification pending: render trades but show "Roll detection pending" for timeline/donut.

---

## 10. Phased Rollout Plan

Each phase is a candidate GitHub issue.

### Phase 0 — Verify ingestion design

Goal: prove Flex Query returns the fields needed for cash flow, realized P&L, and option lifecycle events.

Deliverables:

- One-shot local script or worker dry-run that fetches a small Flex date range.
- Field mapping document from Flex sections to `options_*` DDL.
- Validate presence of trades, cash transactions, open/closed positions, option exercises/expirations.
- Compare a sample closed option trade against IBKR statements manually.

Acceptance criteria:

- At least one known options trade maps to `net_cash_flow` and `realized_pnl` correctly.
- A Flex sync can run without changing production tables in dry-run mode.

### Phase 1 — Schema + ingestion worker

Goal: persist raw normalized facts.

Deliverables:

- Supabase migration for `options_sync_runs`, `options_legs`, `options_trades`, and core policies.
- Python Flex fetch/parse service.
- `compute_jobs` handler `options_income_sync`.
- Idempotent upsert by source IDs.
- Realtime sync status.

Acceptance criteria:

- Backfill selected date range into Supabase.
- RLS verified for household reads.
- Worker can retry and produce useful errors.

Backfill flow:

- `scripts/backfill_options.py` accepts `--start YYYY-MM-DD --end YYYY-MM-DD` and `--year YYYY`, then splits the range into inclusive calendar-year chunks to stay within IBKR's typical 365-day Flex limit.
- Each chunk runs Flex ingestion, strategy grouping/roll detection, margin snapshot sync, and monthly metrics aggregation in order; after a multi-year write run, the CLI refreshes strategy grouping and monthly metrics once more for the full requested range so roll links and cumulative series can span year boundaries. Reruns are idempotent because source IDs and natural option-leg keys use existing upsert constraints.
- `--dry-run` executes the same chain and rolls back the chunk transaction so operators can inspect counts before writing.
- Synthetic fixtures cover 2021-2025 for smoke testing: 2021-2024 have one distinct trade per year for chunk verification, while the existing 2025 worked example remains unchanged for reconciliation. Real historical data requires IBKR Flex tokens/query IDs from issue #245.

### Phase 2 — Roll detection + StrategyGroup linkage + base metrics

Goal: turn trades into income-quality analytics.

Deliverables:

- `options_strategy_groups`, `options_positions`, `options_roll_events`, `options_dashboard_monthly_metrics`.
- FIFO fallback matcher; broker/Flex realized P&L preferred.
- Roll detection heuristic with stored confidence/status.
- Monthly metrics for cash flow, realized P&L, variance gap, and roll efficiency.

Acceptance criteria:

- Jony's example can be represented exactly.
- At least one real roll is detected and explainable.
- Re-running the worker is deterministic.

### Phase 3 — UI replacement of `/options`

Goal: ship the dashboard experience.

Deliverables:

- Replace projection-first UI with dashboard components.
- Add refresh action that queues `options_income_sync`.
- Add empty/loading/stale states and source freshness indicators.
- Keep or archive legacy `options_income` manual table flow.

Acceptance criteria:

- `/options` renders from `options_dashboard_monthly_metrics`.
- Chart and KPI values match worker result rows.
- UI clearly distinguishes cash flow from realized P&L.

### Phase 4 — Capital-at-risk + margin gauges

Goal: complete capital efficiency layer.

Deliverables:

- Strategy-type-specific Capital at Risk rules.
- Time-weighted Return on Capital at Risk.
- IB Gateway or Flex margin snapshot ingestion.
- Margin Utilization gauge.

Acceptance criteria:

- CSP and vertical spread risk calculations verified with known examples.
- Margin gauge shows stale/offline state when IB Gateway data is unavailable.
- Unknown/ungrouped strategies do not corrupt denominator calculations.

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Flex query misses needed sections | Cannot compute complete dashboard | Phase 0 validates exact report sections before schema work. |
| Roll heuristic misclassifies trades | User distrusts roll efficiency | Store detected links, expose explanation, add manual override later. |
| Realized P&L differs from user expectation | Financial accuracy issue | Prefer IBKR Flex `fifoPnlRealized`; document FIFO fallback and allow preference question. |
| IB Gateway offline | Margin/intraday stale | Treat Flex as authoritative; show freshness badges and stale margin state. |
| Large backfills are slow | Worker timeouts/perf | Batch by date range/account, idempotent upserts, write cooked monthly rows. |
| RLS gaps expose financial data | Security risk | Use `options_income` policy pattern; run advisors/security review during schema phase. |
| Browser aggregates too much data | Slow UI | UI reads cooked monthly metrics; raw trade table only for drill-down pagination. |

---

## 12. Resolved Decisions (from Jony, 2026-05-04)

1. **Roll detection window: same trading day.** Jony rarely makes intraday adjustments, so two trades on the same trading-day calendar date qualify as a roll candidate. The 15/60-minute heuristic is dropped in favor of the simpler same-day rule. Strike-distance and right-match guards from §5.2 still apply.
2. **Matching preference: IBKR FIFO is canonical.** Use `fifoPnlRealized` straight from the Flex Query Trades section as the realized P&L source of truth. We do **not** re-implement matching; we mirror IBKR's books for tax-prep alignment.
3. **Tax estimate: Israeli capital gains, flat 25%.** The dotted tax line in `<NetCashFlowVsRealizedChart>` is `max(0, cumulative_realized_pnl) × 0.25`. No US bracket logic in v1.
4. **`options_income` is replaced, not supplemented.** The new schema becomes the only source for the `/options` page. Migration plan: keep `options_income` rows readable until the new ingestion has produced cooked monthly metrics for the same range, then drop the page wiring (table can stay until Phase 3 is shipped, then be deprecated in a follow-up cleanup).
5. **Backfill scope: 2025-01-01 → today in Phase 1.** A separate follow-up issue tracks extending backfill to 2021-01-01 (Jony wants monthly/yearly history that far back). Backfill-to-2021 is **not** a Phase-1 blocker.
6. **Account scope: all configured IBKR accounts, opt-out per account.** Add a `compute_options_income BOOLEAN NOT NULL DEFAULT true` column to `trading_account_config` (or the equivalent per-account settings table). The worker only scans accounts with the flag enabled. Frontend exposes a per-account checkbox in account settings.
7. **Strategy grouping: read-only detected classifications in v1.** The roll detection heuristic runs unattended; users see the result but cannot edit links. Manual override / merge / split is a Phase 5 (post-v1) feature.
8. **Neutral roll threshold: ±$25 absolute (v1 default).** Configurable later. Jony skipped this question; `$25` is picked as a low-noise default consistent with typical 1-2 contract spread credits. Document the value in the dashboard tooltip.
9. **Capital-at-risk: max-loss net of premium received.** Confirmed. CSP capital at risk = `(strike × multiplier) − premium_received`. Vertical spread = `(width × multiplier) − net_credit`. Gross strike × multiplier is rejected as overstating risk.
10. **Margin utilization: account-wide.** Jony does not use margin for stock purchases, so account-level margin used / margin available is a clean signal of options collateral pressure. No virtual sub-account split needed.

### Follow-up issues these decisions imply

- Backfill ingestion to 2021-01-01 (separate issue, scheduled after Phase 1 GA).
- Manual roll override UI (Phase 5; not in v1 scope).
- Configurable neutral-roll threshold (Phase 5; v1 hardcodes ±$25).
- Multi-jurisdiction tax estimate (out of scope; Israel-only in v1).

---

## 13. Next Steps

1. Create a Phase 0 issue to validate Flex Query fields and produce a sample mapping from one real options sequence.
2. Decide the open questions above, especially roll window, matching preference, and backfill scope.
3. After Phase 0, implement schema migrations and worker ingestion in small PRs.
4. Build the `/options` replacement only after cooked monthly metrics exist, so Fenster can focus on UI fidelity instead of financial reconciliation logic.

## Appendix A: Flex Field → Schema Mapping

Phase 0 uses IBKR Flex XML as the source-of-truth probe format. Attribute availability can vary by account type and Flex UI version; if IBKR exposes an equivalent field with a slightly different name, keep the raw XML payload and normalize during Phase 1 ingestion.

### TradeConfirms → `options_trades`

| Flex XML attribute | Target column | Notes |
|---|---|---|
| `tradeID` | `options_trades.source_trade_id` | Primary broker trade identifier. |
| `transactionID` | `options_trades.source_transaction_id` | Used with `tradeID` for idempotency. |
| `ibExecID` | `options_trades.source_exec_id` | Optional execution-level uniqueness when available. |
| `accountId` | `options_trades.account_id` | Also links to account configuration. |
| `dateTime` | `options_trades.trade_time` | Prefer this over separate date/time fields. |
| `tradeDate` | `options_trades.trade_date` | Fallback when `dateTime` is absent. |
| `symbol` | `options_legs.option_symbol`; raw payload | IBKR option symbol can be retained for audit. |
| `underlyingSymbol` | `options_legs.underlying_symbol` | Required for grouping and roll detection. |
| `putCall` | `options_legs.right` | Normalize `P`/`PUT` to `put`, `C`/`CALL` to `call`. |
| `strike` | `options_legs.strike` | Persist as `numeric(18,6)`. |
| `expiry` | `options_legs.expiry` | Normalize `YYYYMMDD` to date. |
| `multiplier` | `options_legs.multiplier` | Usually `100` for US equity options. |
| `currency` | `options_trades.currency`; `options_legs.currency` | Default `USD` only when Flex omits it. |
| `quantity` | `options_trades.quantity` | Preserve sign from IBKR; side is still normalized separately. |
| `tradePrice` / `price` | `options_trades.price` | Prefer `tradePrice`; `price` is fallback in some exports. |
| `proceeds` | `options_trades.gross_amount` | Broker-reported gross amount before commissions/fees. |
| `commission` / `ibCommission` | `options_trades.commission` | Flex often emits `ibCommission`; map either name. |
| `taxes` / fees fields | `options_trades.fees` | Not always present in Trades; retain raw payload for reconciliation. |
| `netCash` | `options_trades.net_cash_flow` | Preferred cash-flow source. |
| `fifoPnlRealized` | `options_trades.realized_pnl` | Canonical realized P&L per resolved decision §12.2. |
| `buySell` | `options_trades.side` | Normalize `BUY`/`SELL`. |
| `openCloseIndicator` | `options_trades.event_type` | `O` → `open`, `C` → `close`; EAE can override lifecycle events. |
| all row attributes | `options_trades.raw_payload` | Preserve for audit and future field drift. |

### CashTransactions → `options_cash_events`

| Flex XML attribute | Target column | Notes |
|---|---|---|
| `transactionID` | `options_cash_events.source_transaction_id` | Primary idempotency key for cash rows. |
| `accountId` | `options_cash_events.account_id` | Required for household account scope. |
| `dateTime` | `options_cash_events.event_time` | Preferred timestamp when present. |
| `date` / `reportDate` | `options_cash_events.event_date` | Fallback date. |
| `type` | `options_cash_events.event_category`; raw payload | Normalize known option-related types; otherwise `other`. |
| `description` | `options_cash_events.description` | Useful for assignment/exercise explanations. |
| `amount` / `netCash` | `options_cash_events.amount` | Prefer `amount`; fallback to `netCash`. |
| `currency` | `options_cash_events.currency` | Default `USD` only when Flex omits it. |
| `tradeID` | `options_cash_events.raw_payload` | Flex may not emit this for every cash row; use only as a weak link. |
| all row attributes | `options_cash_events.raw_payload` | Preserve full source row. |

### OptionEAE → `options_trades` augmentation

| Flex XML attribute | Target column | Notes |
|---|---|---|
| `tradeID` | `options_trades.source_trade_id` | Use for lifecycle trade rows when supplied. |
| `transactionID` | `options_trades.source_transaction_id` | Use for idempotency and cash-event linkage. |
| `accountId` | `options_trades.account_id` | Required account scope. |
| `dateTime` / `reportDate` | `options_trades.trade_time`; `options_trades.trade_date` | Normalize lifecycle event date. |
| `symbol` | `options_legs.option_symbol`; raw payload | Same leg-resolution path as TradeConfirms. |
| `underlyingSymbol` | `options_legs.underlying_symbol` | Required for strategy grouping. |
| `putCall` | `options_legs.right` | Normalize to enum. |
| `strike` | `options_legs.strike` | Persist as `numeric(18,6)`. |
| `expiry` | `options_legs.expiry` | Normalize to date. |
| `multiplier` | `options_legs.multiplier` | Usually `100`. |
| `quantity` | `options_trades.quantity` | Lifecycle quantity; sign conventions should be verified against real XML. |
| `type` / `action` | `options_trades.event_type`; `raw_payload` flags | Map `Expiration` → `expire`, `Assignment` → `assign`, `Exercise` → `exercise`. |
| `proceeds` | `options_trades.gross_amount`; `net_cash_flow` fallback | Assignments may represent stock settlement, so tag specially. |
| `fifoPnlRealized` | `options_trades.realized_pnl` | Prefer Flex when present. |
| `currency` | `options_trades.currency` | Default `USD` only when Flex omits it. |
| all row attributes | `options_trades.raw_payload` | Preserve assignment/exercise/expiration flags. |

### OpenPositions → `options_positions`

| Flex XML attribute | Target column | Notes |
|---|---|---|
| `accountId` | `options_positions.account_id` | Required account scope. |
| `symbol` | `options_legs.option_symbol`; raw payload | Resolve or create leg. |
| `underlyingSymbol` | `options_legs.underlying_symbol` | Required leg attribute. |
| `putCall` | `options_legs.right` | Normalize to enum. |
| `strike` | `options_legs.strike` | Persist as `numeric(18,6)`. |
| `expiry` | `options_legs.expiry` | Normalize to date. |
| `multiplier` | `options_legs.multiplier` | Usually `100`. |
| `position` / `quantity` | `options_positions.quantity_open` | Prefer `position`; fallback to `quantity`. |
| `costBasis` | `options_positions.open_cash_flow`; raw payload | Flex cost basis is not always identical to original option cash flow; reconcile in Phase 1. |
| `costPrice` | `options_positions.average_open_price` | Fallback when cost basis must be reconstructed. |
| `markPrice` | `options_positions.raw_payload` | §6 table does not include mark price; propose later `mark_price numeric(18,6)` or keep in raw payload. |
| `fifoPnlUnrealized` | `options_positions.raw_payload` | §6 table intentionally omits unrealized P&L; keep raw for future MTM add-on. |
| margin fields if emitted | `options_positions.ib_margin_requirement` | Flex may not emit per-position margin; use account-level or IB Gateway fallback. |
| all row attributes | future raw payload column or sync-run artifact | §6 `options_positions` currently lacks `raw_payload`; Phase 1 should add it if auditability is required. |

### AccountInformation → `options_flex_sync_state` / sync metadata

The current §6 table is named `options_sync_runs`, not `options_flex_sync_state`. Phase 1 should either store account snapshots in `options_sync_runs.metadata` or add an `options_margin_snapshots` / `options_account_snapshots` table if historical margin charts are required.

| Flex XML attribute | Target column | Notes |
|---|---|---|
| `accountId` | `options_sync_runs.metadata.accountId` | Also identifies configured account. |
| `baseCurrency` / `currency` | `options_sync_runs.metadata.currency` | Prefer `baseCurrency` when present. |
| `marginRequirement` / `maintenanceMarginRequirement` | `options_sync_runs.metadata.marginRequirement` | Flex naming varies; IB Gateway may be fresher. |
| `buyingPower` | `options_sync_runs.metadata.buyingPower` | Used for margin utilization alternatives. |
| `availableFunds` | `options_sync_runs.metadata.availableFunds` | Alternative denominator per §7.6. |
| `netLiquidation` | `options_sync_runs.metadata.netLiquidation` | Needed for account-wide margin utilization. |
| all row attributes | `options_sync_runs.metadata.accountInformationRaw` | Preserve exact Flex names for Phase 1 schema decisions. |

### Known Flex gaps / alternatives

- The design prompt references `options_flex_sync_state`; §6 currently defines `options_sync_runs`. Use `options_sync_runs.metadata` in Phase 0/1 unless a dedicated account snapshot table is added.
- `options_positions.markPrice` and `options_positions.fifoPnlUnrealized` are not present in the §6 DDL. Keep them in raw payload or add explicit columns only if Phase 4 MTM/margin gauges need them.
- Flex may not emit per-position `marginRequirement`; prefer Account Information or IB Gateway account summary for account-wide margin utilization.
- CashTransactions may not reliably include `tradeID`; use `transactionID`, dates, descriptions, and raw payload for reconciliation rather than hard-linking every cash row to a trade.
