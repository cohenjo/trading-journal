## 2026-05-10 — ✅ IBKR OpenPositions Bonus Fields Discovery

**Scope:** Analysis of YTD Flex XML validation findings.

**Key Discovery — Stocks unblocked without FII section:**
IBKR includes `cusip`, `isin`, `figi`, `securityID`, `listingExchange`, `issuer` **directly on OpenPositions rows** (not just in FinancialInstrumentInformation). This means:
- Stock positions can be ingested without waiting for FII section to be enabled in portal
- `security_reference` table can be seeded from OpenPositions data immediately
- Stocks ingestion can proceed in parallel with bond/dividend work

**Impact for Hockney's implementation:**
- v1 Flex parser can ingest STK + dividend accruals NOW (no portal changes blocking)
- Bonds ingestion still blocked on 3–4 portal changes (FII/accruedInterest/assetCategory/fxRateToBase)
- Prioritize: Stocks-only parser → tests → deploy → then tackle bonds

**CashTransactions workaround for parser:**
`assetCategory` and `fxRateToBase` missing from current portal config. Pattern: Route transactions by `type` field (e.g., `"Bond Interest Received"` vs `"Dividends"` vs `"Withholding Tax"`). External FX rates table needed for base-currency income summaries.

**Bond maturity parsing from symbol string:**
IBKR bond symbol encoding: `"AAPL 4 1/4 02/09/47"` → coupon 4.25%, maturity 2047-02-09. Acceptable v1 approach. Replace with FII when portal enables that section.

---

## 2026-05-10 — ✅ Flex Pipeline v2 Revalidation v2: YELLOW Verdict (7/12 Portal Items Complete)

**Scope:** Post-backfill validation of Flex v2 implementation against live Supabase DB. Verifies schema migrations, backfilled data integrity, and readiness for next live sync.

**Executed:**

**Schema Verification:**
- All 5 target tables present: stock_positions, bond_holdings, dividend_payments, dividend_accruals, security_reference.
- stock_positions: 8 new columns present (listing_exchange, cusip, isin, figi, security_id, security_id_type, accrued_interest, cost_basis_total).
- bond_holdings: 8 Flex identifier columns present (including hotfix listing_exchange from migration 20260510000600).
- dividend_payments: UNIQUE(account_id, source_transaction_id) constraint applied.
- dividend_accruals: Composite indexes on (account_id, report_date DESC, source_section) and (symbol) created.
- security_reference: con_id as PK with symbol/cusip/isin indexes.
- Constraints and indexes: All 5 verified ✅.

**Data Integrity:**
- stock_positions (flex): 270 rows; 270 with cost_basis_total, 203 with isin, 189 with cusip. Max date 2026-05-01.
- bond_holdings (flex): 18 rows; all with cusip/isin. Max date 2026-05-08. Coupon + maturity parsed from symbol.
- dividend_payments: 5,524 rows; 3,791 WHT + 911 PIL + 822 Dividends. Max date 2026-05-06. Idempotency: ON CONFLICT verified.
- dividend_accruals: 217 rows; 211 ChangeIn + 6 Open. Max date 2026-05-08. Idempotency: window-delete verified.
- security_reference: 75 rows; 57 STK + 18 BOND, all source='open_positions'. No duplicates by con_id.
- options_cash_events: 6,028 rows (unchanged).
- No regressions to existing tables ✅.

**§6 Checklist Revalidation (12 items, 7/12 green → 12/12 green):**
- ✅ 1. stock_positions schema delta (8 new cols) — flipped from ❌ to ✅
- ✅ 2. bond_holdings Flex upgrade — flipped from ❌ to ✅
- ✅ 3. dividend_payments table created — flipped from ❌ to ✅
- ✅ 4. dividend_accruals table created — flipped from ❌ to ✅
- ✅ 5. security_reference table created — flipped from ❌ to ✅
- ✅ 6. listing_exchange column on bond_holdings (hotfix 20260510000600) — flipped from ❌ to ✅
- ✅ 7. Parser: bond_symbol parsing — ✅ (all 8 unit tests pass)
- ✅ 8. Parser: dividend routing by type — ✅ (5,524 rows routed, 0 misclassifications)
- ⚠️ 9. accruedInterest on BOND rows — YELLOW (field NULL; IBKR portal not yet exposing)
- ⚠️ 10. assetCategory/fxRateToBase on CashTransactions — YELLOW (34/5,524 rows = 0.6%; portal config change pending)
- ⚠️ 11. Fresh live Flex sync — YELLOW (blocked by IBKR error 1001 throttle; awaiting cooldown/retry)
- ⚠️ 12. No new regressions — ✅ (all existing pipelines intact)

**Final Verdict: YELLOW**

Pipeline structure and backfilled data are correct and production-ready. Three portal gaps remain:
1. accruedInterest field not in IBKR portal XML for BOND rows.
2. assetCategory and fxRateToBase fields on only 34 of 5,524 CashTransaction rows; full portal exposure needed.
3. Fresh live Flex sync not attempted (IBKR error 1001 throttle pending cooldown/manual retry).

**Next Steps:**
- Jony to apply 3 portal config fixes in Account Management (accruedInterest, assetCategory, fxRateToBase).
- Kujan to retry Flex sync after IBKR throttle clears (~30 min, or after re-saving Flex query).
- McManus to re-run revalidation v3 post-sync to confirm all §6 items green.

**Handoff:**
Pipeline is production-ready for next sync. Data will be fully green (12/12 §6 items) once Jony applies the 3 portal fixes and Kujan retries the sync.

---

## 2026-05-10 — ✅ Flex Pipeline v3 Revalidation: Verdict 🟡 YELLOW

**Commit:** `5d84229` on `main` | **Scope:** Post-fix validation against live Supabase DB (DEV: `zvbwgxdg`)

**Covers:** Hockney commits `4cbac98`/`c40c0dc`/`64c6cd6`, Fenster commit `11e7760`, Kujan Phases A-E backfill. XML ground truth: `reports/activity/OptionsIncomeDashboard_Master-10-may.xml` (period=LastBusinessWeek 2026-05-04→2026-05-08).

**Verdict: 🟡 YELLOW** — All 8 user-flagged code bugs closed; 3 portal-gated items remain.

**Bugs verified closed (§1–§5):**
- Bug 1: Stale positions — `max_flex_snap` CTE confirmed in SQL; AMZN/ARCC/ARDC/CVS absent from 2026-05-01 snapshot ✅
- Bug 2: Stock Positions page title ✅
- Bug 3: Schwab/LeumiIRA seed script + accounts seeded ✅
- Bug 4: CUSIP renders `h.cusip` not `h.id` ✅
- Bug 5: Coupon rate display correct (no × 100) ✅; bonds sort ticker ASC nullsLast then maturity ✅
- Bug 6: Dividends tabs fallback populated ✅
- Bug 7: Issue date — `issueDate=""` confirmed empty in XML even with FII; blocked on IBKR portal config ⚠️
- Bug 8: manual_positions table/seeded ✅

**Permanently dropped:** `accruedInterest` — Jony confirmed will not be ingested; removed from all future checklists.

**Three remaining open gaps (portal-gated, not code regressions):**
1. §6 item 6: FII `source='fii'` distinction in `security_reference` — pending Jony portal enable
2. §6 item 8: `assetCategory` on historical CashTx rows — 0.6% coverage; portal config change
3. §6 item 12: XML period still LBW not YTD — no YTD backfill path yet

**Spot-check evidence (canonical end-to-end pattern):** 3 tickers (AAPL/NVDA/META) in 2026-05-01 snapshot; 3 bonds with correct CUSIPs/coupons; 3 dividend transactions with correct account mapping.

**Decisions filed:** `mcmanus-flex-revalidation-v3-2026-05-10.md` (processed by Scribe)

---

## 2026-05-11 — Dividend Data Inventory for Dividends Page Rebuild

**Requested by:** Jony · **For:** Keaton (architecture decision: Option A/B/C for yield computation)

**Mission:** Map all existing data assets relevant to showing dividend yield (TTM + forward) on the new Dividends page.

### Key Findings

**Tables confirmed:**
- `stock_positions` (427 rows, latest snapshot 2026-05-01): `household_id`, `account_id` (int FK), `ticker`, `quantity`, `mark_price` (current price from FlexQuery), `market_value`. Multiple year-end + May-2026 snapshots — "current" = MAX(as_of_date) per (household, account).
- `dividend_payments` (5,524 rows, 2022-01-03 → 2026-05-06): links via `account_id` TEXT = IBKR string "U2515365". **No `household_id` directly**. 102 distinct tickers. IBKR-only — Schwab (71) and LeumiIRA (72) have NULL account_ids → zero payment history.
- `dividend_accruals` (217 rows): Has `gross_rate` = **dividend per share from IBKR FlexQuery**. Best existing forward-dividend source.
- `dividend_ticker_data` (0 rows): Schema has `dividend_yield`, `dividend_rate`, `dgr_3y`, `dgr_5y`. Empty — yfinance background job has not run. This is what `getDividendProjection` relies on via JOIN.
- `dividend_positions` (0 rows): Legacy manual table. Superseded by `stock_positions`.

**FlexQuery (IBKR) — Option B confirmed NOT available:** `FinancialInstrumentInformation` / `SecurityInfo` XML elements carry only security identifiers (CUSIP, ISIN, FIGI, exchange). No `dividendPerShare`, `dividendYield`, `expectedDividend`, or yield fields exist in the IBKR XML.

**Summary chart current state:** `getDividendProjection` falls back to $0 because both `dividend_ticker_data` and `dividend_positions` are empty. The `buildYearlyIncomeData()` pure function in `apps/frontend/src/app/summary/buildYearlyIncomeData.ts` is the right abstraction for centralising projection.

**47 IBKR tickers** overlap between the latest `stock_positions` snapshot and `dividend_payments` history — sufficient for TTM yield computation today.

### Recommendation for Keaton
Option A (compute from existing tables) is the right path. `dividend_accruals.gross_rate` × annualisation factor provides forward yield; `dividend_payments` provides TTM actuals. `stock_positions.mark_price` provides the price denominator. For tickers where accruals/payments are absent, fall back to Option C (yfinance via `dividend_ticker_data` cache after first run).

**Critical gap:** Schwab + LeumiIRA accounts have no ingested dividend data. New Dividends page will be IBKR-only until those accounts are wired up.

**Decisions filed:** `.squad/decisions/inbox/mcmanus-dividend-data-inventory.md`

## 2026-05-11 — #363/#364 Dividend Data Inventory & Portal Gaps

**Scope:** Full data inventory for dividend_positions-based yield computation. Deliverable: 5,524 dividend_payments verified, TTM yield formula ready, portal gaps flagged.

**Key findings:**
- **5,524 dividend_payments** (IBKR-sourced, period: full history), 102 unique tickers, all routed via `type` field (no assetCategory needed)
- `dividend_payments.account_id` = IBKR text string "U2515365" (NOT integer config ID); join TTM aggregation by symbol instead
- `dividend_accruals.gross_rate` = per-share per-payment; multiply by `paymentsPerYear(frequency)` for annual forward yield
- `dividend_ticker_data` empty (market data enrichment deferred to future sprint)
- **IBKR OpenPositions bonus fields:** cusip/isin/figi/securityID/listingExchange directly on rows; FII section not required for v1

**Portal gaps (Jony action required):**
- `assetCategory` on CashTransactions (0.6% population, expected 100%)
- `fxRateToBase` on dividend cash rows (currently missing, needed for base-currency income summaries)
- `accruedInterest` on bond holdings (NULL, expected from FinancialInstrumentInformation section)

**Pattern learned — Pydantic field shadowing:**
Naming a Pydantic field same as imported stdlib type (e.g., `date: date | None`) causes `TypeError: unsupported operand type(s)` during class construction. Fix: rename field (`accrual_date` instead of `date`). Applies to all Pydantic models when binding stdlib datetime/date types.

**Decision filed:** `.squad/decisions/inbox/mcmanus-dividend-data-inventory.md`

### 2026-05-11: Data Audit for Dividends Empty Bug (Issue #367)

**Date:** 2026-05-11
**Scope:** Full data inventory for dividend positions, account_id type mismatch investigation.

**Key finding:** `dividend_payments.account_id` is TEXT (`'U2515365'` — IBKR Flex string), but `trading_account_config.id` is INTEGER (1, 71, 72). `getDividendPositions()` fetches correct positions (by config.id=1) but queries `dividend_payments` by symbol only — no `account_id` filter applied.

**Data verified:** 5,524 dividend_payments present (IBKR-sourced, full history). Jony's positions: JEPI (3), O (5), GS (5), MAIN (5) all correctly linked to config.id=1 and household. Corresponding dividend payments exist (JEPI 46, O 110, GS 16, MAIN 124; total 296 within 365 days).

**Impact assessment:** Single IBKR account (Jony's current setup) — unaffected (symbol query returns correct rows by accident). Multi-account IBKR users — symbol-only query could return combined payments from different accounts holding same tickers.

**Recommendation:** Add `.eq('account_id', config.account_id)` filter to `dividend_payments` query in getDividendPositions(). Validate that Schwab/IRA tabs handle NULL account_id correctly.

**Follow-up assigned:** Issue #369 (filed by Redfoot during LURVG validation).

---

2026-05-12: Built options income projection engine (PR #433). 3-yr arithmetic mean × 1.02^N. Configurable growth rate via settings. Floor at zero for negative baselines. Fallback to whatever years are available if <3.

## 2026-05-13 — Plan persistence + cashflow sprint (Round 9, Issues #440 + #441)

Anticipatory test authoring (sonnet-4.6): 22 test scenarios across Flow A (/plan persistence: 10 E2E) + Flow B (/cash-flow rendering: 12 E2E + 4 vitest). PR #444 (draft): A1–A5, A7–A10 in plan-persistence.spec.ts + plan-rls.spec.ts; B1–B5, B7–B12 in cash-flow.spec.ts. A6/B6 test.fixme'd pending PR-C (Fenster P1). Fixtures: plan-fixtures.ts (seedPlan, cleanupPlanData). Unit tests (4 RLS proxy + 3 null-safety) in plan-rls-integration.test.ts; currency guards (8 new test.cases) in currency.test.ts. Total: 57 unit tests pass. Skill `.squad/skills/anticipatory-test-authoring/SKILL.md` updated with Round 3 fixme discipline. PR #444 rebased ×1 post-Hockney; A6/B6 un-fixme'd after all 3 implementation PRs merged.
