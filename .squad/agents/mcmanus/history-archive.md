
## Archive Entry — 2026-05-09 (mcmanus)

**Total entries:** ~220 lines
**Archived to make room for ongoing work.**
### 2026-04-30 — YOLO Direct-Apply Round: Baseline + Keaton Review

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)
**Work (Round 1):** Consolidated 22 Alembic migrations into single idempotent baseline migration (20260430115000_baseline_legacy_schema.sql) for fresh Supabase instances. Reconstructed missing trade table creation from d869bcf363dc logic. Fixed SQL reserved word quoting (`right` column). Applied baseline successfully to both DEV+PROD.

**Work (Round 2):** Addressed all 3 code review findings from Keaton on PR #90: added `tradingaccounttype` enum, filled missing column additions, ensured FK constraint coverage. Commit 5a8367e merged.

**Key Insight:** Alembic migrations cannot be replayed directly on fresh Supabase instances; baseline consolidation + idempotent CREATE TABLE IF NOT EXISTS pattern is the right approach for cloud deployment.
---

## Archive Entry — Session 2026-05-13

**Lines archived:** 176 of 441
**Reason:** History file exceeded 15KB threshold (37709 bytes)


## 2026-05-13 — PR squad/440-441-tests (draft) — PR #444

Implemented 22 scenarios as Playwright E2E + vitest integration code (issues #440 + #441).

**E2E tests (18):** A1–A5, A7–A10 in `plan-persistence.spec.ts` + `plan-rls.spec.ts`; B1–B5, B7–B12 in `cash-flow.spec.ts`. A6/B6 marked `test.fixme` (pending Fenster P1 income-stream wiring, Keaton Decision 1).

**Integration/unit tests (4 + 16):** `plan-rls-integration.test.ts` — A5 RLS unit proxy (4 tests) + A9 null-safety (3 tests). `currency.test.ts` — B7 ILA guard (4 new cases) + B8 GBp guard (4 new cases). All 57 unit tests pass now.

**Fixtures:** `e2e/fixtures/plan-fixtures.ts` — `seedPlan()`, `cleanupPlanData()`, canonical seed constants.

**test.fixme discipline:** A6/B6 have full seed code + TODO comments "Unfixme after PR-C lands". Updated `anticipatory-test-authoring` SKILL.md with Round 3 fixme best practices.

Tests intentionally red on main until PR-A (Hockney) + PR-B (Fenster P0) land. Will unfixme A6/B6 after PR-C.

---

**Requested by:** Jony Vesterman Cohen
**Work:** Created `20260430115000_baseline_legacy_schema.sql` migration establishing all 21 legacy public schema tables for trading journal. This migration consolidates the baseline schema from 22 Alembic migrations (8250ff809a39 through 4d9a58ecd93b), creating tables in their final form after all schema evolutions.

**Problem:** Supabase migrations 130000, 130100, 130200, 130300 were failing because they reference legacy tables (manualtrade, trade, execution, etc.) that don't exist on fresh Supabase instances. The Alembic migrations were designed for local development databases, not cloud deployments.

**Solution:** Single idempotent baseline migration (timestamped 115000 to run before 120000 household bootstrap) that creates all 21 legacy tables using CREATE TABLE IF NOT EXISTS. Uses NUMERIC(18,6) for all monetary fields (per Decision #2). Creates stub `trading_account_secrets` table so 130300 can drop it cleanly. Does NOT add household_id, owner_user_id, audit columns, or RLS — those come from 130xxx migrations.

**Tables created:** execution, manualtrade, trade, matchedtrade, dailysummary, optioncontract, historicaloptionbar, backtestrun, backtesttrade, ndx1m, dailybar, finance_snapshots, plans, insurance_policies, dividend_positions, dividend_accounts, dividend_ticker_data, trading_account_config, trading_account_summary, trading_positions, note, plus stub trading_account_secrets.

**Key insight:** Migration 335418ec68e3 was incomplete — only created manualtrade, not trade. Reconstructed trade table creation + transformation from d869bcf363dc downgrade() logic. Fixed SQL keyword issue by quoting `right` column in optioncontract.

**Applied:** Successfully applied to both DEV (zvbwgxdgxwgduhhzdwjj) and PROD (jaesiklybkbmzpgipvea). All 5 migrations (115000, 130000, 130100, 130200, 130300) now working. Both environments have 24 tables total (21 legacy + 3 household).

PR #90 opened and ready for review.

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

📌 **Team update (2026-05-09):** Shipped stacked income chart on /summary with Fenster (#338) — ensured `options_dashboard_monthly` view correctly projects cumulative cash flow. Hockney completed migration drift audit (#335). Kujan removed git hook + trimmed docker-compose (#336, #337). Redfoot fixed E2E Playwright hook placement (#334).

## Cumulative-vs-Per-Year Cash Flow Bug Fix (2026-05-09, Issue #341)

**Issue:** 2025 options income showed ~$373k in stacked bar chart instead of actual ~$96k. Root cause: `getOptionsYearlyCashFlow()` took MAX of `cash_flow_cumulative` per year, but that column is cumulative from inception (never resets), so each year's bar showed cumulative-through-that-year instead of just that year's delta.

**Solution (paired with Fenster):** Changed query to SUM `cash_flow_total` (monthly net cash flow) per year instead of MAX `cash_flow_cumulative`. This gives true per-year delta.

**Files modified:**
- `apps/frontend/src/app/options/actions.ts` — `getOptionsYearlyCashFlow()` function

**Before/After:**
- Before: `SELECT cash_flow_cumulative ... yearlyMap.set(year, MAX(cumulative))`
- After: `SELECT cash_flow_total ... yearlyMap.set(year, existing + monthly)`

**Verification:**
- Tests: 6/6 pass in `StackedIncomeBarChart.test.tsx`
- 2025 options value now renders correctly at ~$96k (was ~$373k)
- Sanity check: sum of per-year values should equal latest cumulative (verified visually in dev)

**Learning (The Cumulative Trap):** When a table has both cumulative and per-period columns (like `options_dashboard_monthly`), always confirm which you need:
1. **Cumulative-to-date value**: Use the cumulative column directly (e.g., "total P&L from inception to now")
2. **Per-period delta**: Either (a) SUM the per-period column (safer), or (b) difference consecutive cumulative values (brittle if data has gaps)

This is a common trap with financial time-series data. Our bug happened because we mistakenly treated an inception-cumulative column as if it reset annually. The aggregation logic (MAX per year) was correct for year-end snapshot queries but wrong for per-year income. Once diagnosed, the fix was straightforward: use the right column (`cash_flow_total` for monthly net) and the right aggregation (`SUM` for annual total).

**Financial data modeling principle:** Cumulative columns are for "total since start" queries; delta columns are for "per-period" queries. Keep these semantics distinct when designing aggregations. In retrospect, the function name `getOptionsYearlyCashFlow()` should have been a hint — "yearly" = per-year delta, not cumulative-as-of-EOY.

Fenster and I paired on this. The clear separation between data layer (mine) and UI layer (his) made it easy to spot the bug at the boundary and fix it quickly. The chart worked perfectly — the data contract was just wrong.

📌 **Team update (2026-05-09T18:26:00+03:00):** Fixed #341 stacked income chart cumulative bug. 2025 options now shows correct ~$96k (was ~$373k). Paired with Fenster on diagnosis + fix. (commit 1649369)

## Phase 2 Positions Source Investigation (2026-05-09, Issue #340)

**Mission:** Determine whether the existing IBKR Activity Flex query (`1496910`) already surfaces STK `<OpenPosition>` rows sufficient for an "Open Positions" view, or whether a new Flex query template is needed — gating Hockney's backend and Keaton's design.

### Findings

**Flex XML content (reports/activity/):**
- All 4 annual files (2022–2025, query ID `1496910`) contain a rich `<OpenPositions>` section with BOTH OPT and STK rows.
- STK row counts per file: 2022=63, 2023=45, 2024=51, 2025=54
- Available attributes per STK row: `accountId`, `conid`, `symbol`, `description`, `currency`, `subCategory` (COMMON/ETF/REIT/PREFERENCE), `position` (quantity), `markPrice`, `positionValue`, `costBasisPrice`, `costBasisMoney`, `fifoPnlUnrealized`, `putCall` (always empty "" for STK), `multiplier` (always 1), `underlyingSymbol`, `openDateTime` (always empty for STK — no per-lot open date available)
- BOND and CASH asset categories also appear in OpenPositions (32 BOND, 8 CASH in 2025 file)

**Parser behavior (flex_parser.py, lines 198–200):**
- `OpenPositions` section IS parsed, but **only** rows passing `_is_option_contract_row()` are kept.
- STK/BOND/CASH positions are silently dropped. This is a 5-line change to add an STK branch.
- `FlexOpenPosition` model captures: `account_id`, `leg`, `as_of_date`, `opened_at`, `quantity_open`, `average_open_price` (mapped from `costBasisPrice`), `open_cash_flow` (mapped from `costBasisMoney`), `ib_margin_requirement`, `last_broker_sync_at`, `raw_payload`.
- Missing from current model for STK: `markPrice`, `positionValue`, `fifoPnlUnrealized`, `symbol`, `conid`, `sub_category`, `currency` (all in `raw_payload` but not projected fields).

**Flex query configuration:**
