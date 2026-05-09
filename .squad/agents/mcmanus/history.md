# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Mcmanus (Data/Finance Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

## 2026-05-06 — Options Lifecycle & Roll Classification Spec

**Requested by:** Jony Vesterman Cohen
**Work:** Authored canonical spec for options position lifecycle states and roll classification rules, filed at `.squad/decisions/inbox/mcmanus-lifecycle-roll-spec.md`.

**Root cause of "all positions show open" bug:** `_status()` in `strategy_grouper.py` checks whether every open leg has a corresponding close trade in the group. In a `roll_chain`, both the original open AND the rolled-to open are in `opens`; the rolled-to leg is still live, so `all(has_close)` fails → always returns `"open"`. Fix: compute net quantity per contract key and return `"open"` only if net quantity > 0.

**Root cause of empty donut:** `classify_roll()` in `roll_detector.py` uses `realized_pnl` (FIFO accounting P&L) not `net_cash_flow` (cash collected from the roll pair). These differ — `realized_pnl` reflects cost basis math, not roll credit/debit. The spec mandates using `net_cash_flow` of the (close + open) pair for roll classification.

**Key domain decisions in spec:**
- "rolled" is NOT a lifecycle state; it is a property (group has roll_events). State is still open/closed/assigned/expired/exercised.
- Roll categories for donut: `positive/negative/neutral` (maps to credit > $25 / debit < -$25 / within ±$25) based on `net_cash_flow` of pair, not realized P&L.
- Secondary roll tags (strike_improvement, extension_only, defensive_roll) go into `options_roll_events.metadata` — no schema change.
- `StrategyStatus` Literal needs `"exercised"` and `"mixed"` added to match FE types.

## 2026-04-30 — TJ-006: Schema layering and initial tables

**Requested by:** Jony Vesterman Cohen (Ralph YOLO mode)
**Work:** Created four migration files establishing the raw/compute/cooked schema namespaces and skeleton tables. Raw (4 tables): broker_trade_events, market_data_quotes, dividend_announcements, broker_statements. Compute (3 tables): pnl_runs, daily_pnl_intermediates, position_snapshots. Cooked (3 tables + 3 views): dashboard_summary, position_history, daily_performance, each with RLS and _live views for freshness.
**Finding:** PostgreSQL 15 rejects `now()` in `GENERATED ALWAYS AS STORED` columns (STABLE ≠ IMMUTABLE). Used companion `_live` views instead; documented trade-off in migration header.
**Finding:** `public.users` not yet in any migration — `raw.broker_statements.uploaded_by` references `auth.users(id)` directly until a future public.users migration lands.


**Requested by:** Jony Vesterman Cohen (YOLO mode)
**Work:** Classified all 24 existing DB tables into household / owner-private / global-reference / system-infra buckets. Produced `docs/design-hosting/data/table-ownership.md` and decision draft.
**Finding:** `trading_account_config` is the only split-ownership table — it mixes household metadata with owner-private broker secrets; must be resolved before TJ-005 RLS migration can proceed.
**Finding:** `owner` string fields in `FinanceItem`, `PlanItem`, `InsurancePolicy`, `DividendPosition` are display-only — NOT auth boundaries; confirmed explicitly to prevent future RLS confusion.
**Finding:** `backtesttrade` inherits visibility from `backtestrun` via JOIN, so it needs no direct `owner_user_id` FK.

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Created `app/services/analysis/` package for Company Analysis page financial models (DCF, Scorecard, Valuation Multiples, Technical Indicators, Options Analytics). All functions are pure, testable, and use `decimal.Decimal` for monetary precision per team decision. 48 tests passing in `tests/test_analysis.py`.
- Existing codebase uses Pydantic `BaseModel` for input/output schemas and plain functions or static methods on service classes — followed this pattern for the analysis modules.
- numpy is available and used for Bollinger Bands std-dev; scipy available but not needed for current indicators.
- Technical indicators (EMA, RSI, MACD, Bollinger) operate on plain `List[float]` to keep them decoupled from pandas/yfinance — the API layer can convert as needed.

📌 **Team update (2026-05-06T18:32:23Z):** Session lifetime bug pattern discovered in Flex backfill: SQLAlchemy Sessions must not be held open across slow external API calls (IBKR Flex can take 0-25 min during retry storms). Postgres pooler timeout closes idle connections after ~10 min. **Pattern applies broadly to any IBKR/Flex/external-API integration.** Architectural fix: Decouple fetch from Session lifetime (fetch API data first outside Session, then open Session only for DB operations). See decisions.md for details. — flagged by Hockney

## 2026-04-30 — Data architecture section for Supabase households

**Requested by:** Jony Vesterman Cohen
**Work:** Drafted `docs/design-hosting/sections/06-data-architecture.md` and `docs/design-hosting/diagrams/06-data-model.excalidraw`.

**Summary:** Surveyed the existing SQLModel schema and documented that major finance/trading tables lack a real `user_id`/tenant FK today. Proposed Supabase `auth.users` mapping, `households`, `household_members`, per-table household/private/global scoping, a single-user backfill path, and raw/compute/cooked schemas for local-heavy jobs with UI-readable cooked tables.

**Decision draft:** `.squad/decisions/inbox/mcmanus-data-architecture.md`.

📌 Team update (2026-04-30T15:00:37Z): Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md

## 2026-04-30 — Phase 1 migration consolidation (PR #85)

Resolved all 4 user-pending decisions on PR #85 by rewriting Hockney's sketch migrations into final form.

**Decision #1 (hard-delete):** Added `20260430130500_relax_delete_policies.sql` — dropped `USING (false)` DELETE policies on `households` and `household_members`; replaced with `is_household_owner()` policies.
**Decision #2 (enum):** Confirmed `household_role` canonical. Fixed 3 occurrences of `household_member_role` in `docs/design-hosting/sections/06-data-architecture.md`.
**Decision #3 (secrets):** Rewrote `20260430130300` — dropped broker credential columns from `trading_account_config`, added `household_id`, enabled household-scoped RLS.
**Decision #4 (user_profile):** Rewrote `20260430130400` — destructive DROP of `public.user` + CREATE `public.user_profile` with auth.users trigger (SECURITY DEFINER), RLS, backfill. Added `20260430130600` (FK audit no-op).
Closed GH #56 (TJ-003). PR #85 comment posted at https://github.com/cohenjo/trading-journal/pull/85#issuecomment-4355234613.

## 2026-04-30 — Baseline legacy schema migration (PR #90, TJ-005 followup)

**Requested by:** Jony Vesterman Cohen
**Work:** Created `20260430115000_baseline_legacy_schema.sql` migration establishing all 21 legacy public schema tables for trading journal. This migration consolidates the baseline schema from 22 Alembic migrations (8250ff809a39 through 4d9a58ecd93b), creating tables in their final form after all schema evolutions.

**Problem:** Supabase migrations 130000, 130100, 130200, 130300 were failing because they reference legacy tables (manualtrade, trade, execution, etc.) that don't exist on fresh Supabase instances. The Alembic migrations were designed for local development databases, not cloud deployments.

**Solution:** Single idempotent baseline migration (timestamped 115000 to run before 120000 household bootstrap) that creates all 21 legacy tables using CREATE TABLE IF NOT EXISTS. Uses NUMERIC(18,6) for all monetary fields (per Decision #2). Creates stub `trading_account_secrets` table so 130300 can drop it cleanly. Does NOT add household_id, owner_user_id, audit columns, or RLS — those come from 130xxx migrations.

**Tables created:** execution, manualtrade, trade, matchedtrade, dailysummary, optioncontract, historicaloptionbar, backtestrun, backtesttrade, ndx1m, dailybar, finance_snapshots, plans, insurance_policies, dividend_positions, dividend_accounts, dividend_ticker_data, trading_account_config, trading_account_summary, trading_positions, note, plus stub trading_account_secrets.

**Key insight:** Migration 335418ec68e3 was incomplete — only created manualtrade, not trade. Reconstructed trade table creation + transformation from d869bcf363dc downgrade() logic. Fixed SQL keyword issue by quoting `right` column in optioncontract.

**Applied:** Successfully applied to both DEV (zvbwgxdgxwgduhhzdwjj) and PROD (jaesiklybkbmzpgipvea). All 5 migrations (115000, 130000, 130100, 130200, 130300) now working. Both environments have 24 tables total (21 legacy + 3 household).

PR #90 opened and ready for review.

### 2026-04-30 — YOLO Direct-Apply Round: Baseline + Keaton Review

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)
**Work (Round 1):** Consolidated 22 Alembic migrations into single idempotent baseline migration (20260430115000_baseline_legacy_schema.sql) for fresh Supabase instances. Reconstructed missing trade table creation from d869bcf363dc logic. Fixed SQL reserved word quoting (`right` column). Applied baseline successfully to both DEV+PROD.

**Work (Round 2):** Addressed all 3 code review findings from Keaton on PR #90: added `tradingaccounttype` enum, filled missing column additions, ensured FK constraint coverage. Commit 5a8367e merged.

**Key Insight:** Alembic migrations cannot be replayed directly on fresh Supabase instances; baseline consolidation + idempotent CREATE TABLE IF NOT EXISTS pattern is the right approach for cloud deployment.

📌 Team update (2026-05-06): FLEX backfill chunking pattern (monthly chunks) + checkpoint resume now in backfill_options.py — useful precedent for #65 (Postgres backfill) and multi-chunk import work — decided by Hockney

## 2026-05-06 — Data Integrity Review: `--continue-on-error` for Flex Backfill

**Requested by:** Jony Vesterman Cohen (via Coordinator)
**Context:** Reviewed Hockney's planned `--continue-on-error` flag for options backfill script. Flag allows multi-chunk backfills to skip failed chunks (e.g., IBKR 1001 throttle) and continue, leaving failed chunks UNMARKED for future retry.

**Learnings — Data Integrity Patterns:**

1. **Idempotency is critical for backfill resilience.** All DB writes in `options_sync.py` use `ON CONFLICT DO UPDATE` (trades, cash, legs) or scoped DELETE-then-INSERT (positions scoped to `as_of_date`, not window). This makes windowed re-runs SAFE — no duplicates, no cascading corruption. Pattern: `ON CONFLICT (natural_key) DO UPDATE SET col = excluded.col, updated_at = now()`.

2. **Delete-and-insert requires careful scoping.** The `options_positions` write (lines 264-278) deletes by `as_of_date` (the snapshot date in the Flex XML), NOT by the window's `from_date`/`to_date`. This ensures a re-run of 2024-09 only touches 2024-09 snapshots — it won't nuke 2024-08 or 2024-10 positions. Anti-pattern: `DELETE WHERE date >= :from_date AND date <= :to_date` would be UNSAFE (re-run nukes boundary rows).

3. **Cumulative metrics require full-range recomputation after gap-fill.** The metrics handler (`options_metrics.py:78-93`) deletes ALL rows in the requested window BEFORE reinserting. If a backfill skips 2024-09, then later fills it, you MUST re-run metrics for the ENTIRE range (2024-06 to 2024-12) to recompute cumulative columns (`cash_flow_cumulative`, `variance_gap_cumulative`). Partial re-runs fix the gap month but don't propagate corrections forward.

4. **Audit trail for failed operations is essential.** Proposed `.flex_backfill_failures.json` log file (machine-readable, persistent) to track skipped chunks with timestamp and error message. This enables programmatic retry scripts and gap detection queries. Pattern: `{"account_id": [{"chunk": "start:end", "failed_at": "ISO8601", "error": "truncated message"}]}`.

5. **Stateful vs. stateless operations have different gap-tolerance.** Strategy grouping (`options_grouping.py`) is stateful but deterministic — a missing month leaves a hole but doesn't corrupt adjacent groups. Metrics are stateful AND cumulative — missing data BREAKS downstream cumulatives. Margin sync is stateless (snapshot) — gaps are irrelevant. Pattern: Classify operations by state dependency when designing skip-on-failure behavior.

6. **Daily sync must fail loud; backfill can skip-and-log.** The scheduled daily sync (`run_scheduled_flex_options_sync`) calls `run_flex_options_sync` directly without `--continue-on-error` — exceptions propagate up, rolling back the transaction. This is CORRECT: daily windows are tiny, and silent skips would lose today's trades. Backfill can tolerate skips because gaps are detectable and retriable. Pattern: Match error-handling strategy to window size and business impact.

**Decision:** Hockney's `--continue-on-error` is SAFE to ship IF these mitigations are added:
- Persistent failure log (`.flex_backfill_failures.json`).
- End-of-run WARNING with explicit retry + full-metrics-recompute instructions.
- Documented operational checklist (5 steps: detect, retry, recompute, validate, cleanup).

**Citations:** `.squad/decisions/inbox/mcmanus-continue-on-error-data-integrity.md`

📌 Team update (2026-05-06): Data-integrity review for --continue-on-error completed. Findings: ⚠️ Safe-with-mitigations. Gaps create visible holes in metrics but no cascading corruption. Full review documented in decisions.md.

📌 Team update (2026-05-07): Lifecycle/roll canonical spec merged to `.squad/decisions.md` and is now the authoritative guide for Hockney's backend implementation. Spec identified two critical bugs in current code; fixes are gated on Hockney's availability.

## Stacked Income Projection (2026-05-09)

**Issue:** Jony requested yearly income stacking chart showing options/dividends/bonds with future projections. Existing implementation used current-year options P&L instead of cumulative cash flow.

**Solution:** Paired with Fenster to design data model and aggregation logic for yearly income projection across three sources.

### Data source analysis

1. **Options:** `options_dashboard_monthly.cash_flow_cumulative` — monthly cumulative cash flow
   - Aggregation: Take max cumulative per year (last month's value)
   - Projection: Conservative — 0 for future (no assumption about future positions)
   - Rationale: Cumulative cash flow = total premium collected, the metric Jony specified

2. **Dividends:** `dividend_dashboard.annual_income` (run-rate from current holdings)
   - Aggregation: Current annual income from holdings
   - Projection: Compound growth = `amount * (1 + growth_rate + yield_rate * reinvest_rate)^years`
   - Rationale: Models reinvestment + yield growth

3. **Bonds:** `ladder_bonds` → scheduled coupon + maturity payments
   - Aggregation: Sum by year from `getLadderIncome()`
   - Projection: Deterministic — scheduled payments are known
   - Rationale: Bond ladder has fixed payment schedule

### Projection assumptions (transparent to user)

- **Options:** 0 for future years (conservative — doesn't assume new positions)
- **Dividends:** Uses settings.dividendGrowthRate + settings.dividendYieldRate + settings.dividendReinvestRate
- **Bonds:** Scheduled payments only (no assumption about new purchases)
- **Visual distinction:** Projected years shown with 40% opacity

### Implementation: getOptionsYearlyCashFlow()

Query: `options_dashboard_monthly.select('period_start, cash_flow_cumulative')` → group by year → max cumulative

### Data quality considerations

- **Decimal precision:** Cash flow stored as `numeric(18,6)` in DB, converted to number (safe for display)
- **Missing data:** Returns empty array if no household, 0 if no data for a year
- **Year boundaries:** Uses `period_start` year (not `period_end`) for grouping
- **Aggregation:** Takes max cumulative per year = last available month's cumulative value

### Files modified

- `apps/frontend/src/app/options/actions.ts`: +getOptionsYearlyCashFlow()
- `apps/frontend/src/app/summary/page.tsx`: Data aggregation logic for 3 sources + projection model

### Test coverage

- Frontend: 6 tests in `StackedIncomeBarChart.test.tsx` verify stacking math and projection styling
- Backend: Action returns correct shape, no new tests needed (uses existing RLS)

## Learnings

**Per-year aggregation from monthly data:** When aggregating cumulative metrics by year, take the last (max) value for each year, not the sum. Cumulative = running total, so year-end value represents full-year total.

**Projection transparency:** Always document assumptions in UI ("Options show actual cumulative cash flow for past years, 0 for future (conservative)"). Financial projections require user trust — be explicit about what's known vs. assumed.

**Paired work with Fenster:** Data design first (McManus), then chart implementation (Fenster). Clear contracts (YearlyIncomeData type) enabled parallel work. Fenster handled all UI/visualization, I focused on correctness of aggregation and projection logic.

**Conservative vs. optimistic:** For options income, 0 projection is better than extrapolating current year's pace. Options positions are time-bound — can't assume new positions will be opened. Dividends/bonds are more predictable (holdings + scheduled payments).
