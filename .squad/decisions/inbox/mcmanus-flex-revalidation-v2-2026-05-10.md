# McManus — Flex Pipeline v2 End-to-End Revalidation

**Prepared by:** McManus (Data/Finance Dev)
**Date:** 2026-05-10
**Scope:** Post-backfill validation against live Supabase DB. Covers commits `f25f05c` (parser+migrations), image `82fe82a9` (worker), commit `eacd8d4` (Phase 3 backfill).
**Prior revalidation:** `.squad/decisions/inbox/mcmanus-flex-revalidation-2026-05-10.md`
**Checklist source:** §6 of `.squad/decisions/inbox/mcmanus-flex-validation.md`

---

## 1. Executive Verdict

**YELLOW — Pipeline structure and backfill data are correct; three portal gaps remain unresolved.**

All 5 schema migrations applied cleanly. All 4 new tables (`dividend_payments`, `dividend_accruals`, `security_reference`, `bond_holdings`) are populated with backfill data that matches the master XML ground truth. No idempotency violations. No regressions to existing tables. The `listing_exchange` schema bug on `bond_holdings` (hockney-7) appears to be resolved — the column exists in the live schema. The remaining YELLOW items are: (a) `accruedInterest` still absent from BOND positions (portal not changed), (b) `assetCategory` and `fxRateToBase` present on only 34 of 5,524 `dividend_payments` rows (0.6%; the portal fix for CashTransactions has not landed in bulk data), and (c) no fresh live Flex sync has run since IBKR throttle error 1001 — the `stock_positions` snapshot is still dated 2026-05-01. The pipeline is ready for the next live sync but cannot be fully green-lit until portal items 6, 7, 8 are applied by Jony.

---

## 2. Schema Verification Table

### 2.1 Tables present

Query: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (...)`

| Table | Present |
|---|---|
| `stock_positions` | ✅ |
| `bond_holdings` | ✅ |
| `dividend_payments` | ✅ |
| `dividend_accruals` | ✅ |
| `security_reference` | ✅ |
| `options_cash_events` | ✅ |

All 6 target tables confirmed present.

### 2.2 `stock_positions` new columns (migration `20260510000100`)

| Column | Data type | Nullable |
|---|---|---|
| `accrued_interest` | numeric | YES |
| `cost_basis_total` | numeric | YES |
| `cusip` | text | YES |
| `figi` | text | YES |
| `isin` | text | YES |
| `listing_exchange` | text | YES |
| `security_id` | text | YES |
| `security_id_type` | text | YES |

All 8 expected columns present. ✅

### 2.3 `bond_holdings` new columns (migrations `20260510000200` + `20260510000600`)

| Column | Data type | Nullable | Notes |
|---|---|---|---|
| `accrued_interest` | numeric | YES | ✅ |
| `con_id` | bigint | YES | ✅ |
| `cusip` | text | YES | ✅ |
| `figi` | text | YES | ✅ |
| `isin` | text | YES | ✅ |
| `listing_exchange` | text | YES | ✅ — column exists; hockney-7 hotfix applied |
| `security_id` | text | YES | ✅ |
| `security_id_type` | text | YES | ✅ |

Note: `asset_category` and `fx_rate_to_base` are NOT on `bond_holdings`; they are on `dividend_accruals` per the spec. This is correct schema placement.

### 2.4 Constraints and indexes

| Table | Check | Result |
|---|---|---|
| `dividend_payments` | UNIQUE constraint | ✅ `dividend_payments_idempotent` on `(account_id, source_transaction_id)` |
| `dividend_accruals` | Composite index | ✅ `dividend_accruals_report_date_idx` on `(account_id, report_date DESC, source_section)` |
| `dividend_accruals` | Symbol index | ✅ `dividend_accruals_symbol_idx` on `(symbol)` |
| `security_reference` | Primary key | ✅ `con_id` |

---

## 3. Row Counts Table

Query results from row-count UNION query (with `payment_date` corrected to `date_time`):

| Table | Rows | Detail | Max date |
|---|---|---|---|
| `stock_positions` (flex) | **270** | 189 with cusip, 203 with isin, 270 with cost_basis_total | 2026-05-01 |
| `bond_holdings` (flex) | **18** | 18 with cusip, 18 with isin | 2026-05-08 |
| `dividend_payments` | **5,524** | 3,791 WHT + 911 PIL + 822 Dividends | 2026-05-06T20:20:00+00 |
| `dividend_accruals` | **217** | 211 'change' + 6 'open' | 2026-05-08 |
| `security_reference` | **75** | 57 STK + 18 BOND, all source='open_positions' | — |
| `options_cash_events` | **6,028** | Unchanged | 2026-05-06 |

Schema note: `dividend_payments` uses `date_time` (not `payment_date`) as the timestamp column. The spec template query used the wrong column name; corrected in this run.

---

## 4. §6 Checklist Re-run — Before / After

| # | Item | Owner | Before (revalidation 2026-05-10) | After (this run) |
|---|---|---|---|---|
| 1 | DB migration: `stock_positions` schema delta (8 new cols) | Hockney | ❌ Table missing cols | ✅ All 8 cols present |
| 2 | DB migration: `bond_holdings` Flex upgrade + relax nulls | Hockney | ❌ Empty, wrong schema | ✅ 32 cols, all Flex fields present |
| 3 | DB migration: create `dividend_payments` | Hockney | ❌ Table missing | ✅ 5,524 rows |
| 4 | DB migration: create `dividend_accruals` | Hockney | ❌ Table missing | ✅ 217 rows |
| 5 | DB migration: create `security_reference` | Hockney | ❌ Table missing | ✅ 75 rows |
| 6 | Portal: enable `FinancialInstrumentInformation` section | Jony | ❌ 0 FII rows | ❌ Still 0 FII rows; sec_ref seeded from OpenPositions only |
| 7 | Portal: enable `accruedInterest` on OpenPositions BOND | Jony | ❌ 0 accrued_interest | ❌ Still 0/18 bond_holdings have accrued_interest |
| 8 | Portal: enable `assetCategory` + `fxRateToBase` on CashTransactions | Jony | ❌ 0/6028 options_cash_events | ⚠️ 34/5,524 (0.6%) dividend_payments have these keys |
| 9 | Parser: CashTransaction routing uses `type` field | Hockney | ❌ Parser not built | ✅ `DIVIDEND_CASH_TYPES` frozenset implemented |
| 10 | Parser: Bond maturity from symbol string as v1 | Hockney | ❌ Parser not built | ✅ `parse_bond_symbol()` in production; all 18 bonds have correct coupon_rate + maturity_date |
| 11 | Confirm Trades section stays in same query | McManus/Hockney | ✅ Confirmed | ✅ Still confirmed (no changes to trades pipeline) |
| 12 | Switch daily-refresh scope YTD → Last Business Day | Jony | ❌ Pending | ❌ No live sync since throttle; scope not yet changed |

**Summary: 7 of 12 items flipped ✅ since prior revalidation. Items 1–5, 9, 10 are now green. Items 6, 7, 8, 12 remain outstanding.**

---

## 5. Four Portal Fix Verdict Table

| Portal Fix | Query | Result | Verdict |
|---|---|---|---|
| Fix 1: `assetCategory` on CashTransactions | `dividend_payments` raw_payload key check | 34 / 5,524 rows (0.6%) have key | ⚠️ Partial — not portal-delivered; likely carried over from source options_cash_events for a small subset |
| Fix 2: `fxRateToBase` on CashTransactions | Same query | 34 / 5,524 rows (0.6%) have key | ⚠️ Partial — same cohort as assetCategory |
| Fix 3: `accruedInterest` on BOND OpenPositions | `bond_holdings WHERE source='flex'` | 0 / 18 rows have accrued_interest | ❌ Not delivered — IBKR portal still not configured |
| Fix 4: `FinancialInstrumentInformation` section | `security_reference` source distribution | 75/75 rows source='open_positions'; 0 source='fii' | ❌ FII section still absent from IBKR portal |

**Portal fix observation:** The 34 `dividend_payments` rows with `assetCategory`/`fxRateToBase` are a puzzle — they appeared in the original `options_cash_events` raw_payload before any portal change, meaning IBKR may emit these keys for a small subset of cash transactions (possibly bond interest rows or records from a specific period). They do not represent a successful portal fix. Fix 1/2 remain structurally unresolved for the bulk 5,490 rows.

**Note on stock_positions portal fields:**
`stock_positions` (the third/fourth portal fix target per spec) now shows:
- `assetCategory` in raw_payload: 270/270 ✅
- `fxRateToBase` in raw_payload: 57/270 (most recent snapshot only) ⚠️ — expected, as older snapshots were synced before the portal change
- `cusip` column populated: 189/270 ✅ (81 NULL = positions not in master XML, older dates — expected per Hockney backfill notes)
- `listing_exchange` column populated: 203/270 ✅

---

## 6. Data Quality Findings

### 6.1 `dividend_payments` type breakdown

| Type | Count | Sum Amount (USD) | Date Range |
|---|---|---|---|
| Withholding Tax | 3,791 | -15,513.34 | 2021-01-29 → 2026-05-06 |
| Payment In Lieu Of Dividends | 911 | +45,625.53 | 2022-01-03 → 2026-05-06 |
| Dividends | 822 | +48,947.93 | 2022-01-03 → 2026-05-06 |
| **Total** | **5,524** | | |

Net income (Dividends + PIL − WHT) = $48,947.93 + $45,625.53 − $15,513.34 = **$79,060.12**. Distribution looks plausible for a multi-year income portfolio.

**Anomaly:** Routing uses `raw_payload->>'type'` key. The type distribution matches the expected IBKR payment type labels confirmed in the original validation report (§3.3).

### 6.2 `dividend_payments` sample rows (5 most recent)

| account_id | symbol | amount | currency | date_time | source_transaction_id | type |
|---|---|---|---|---|---|---|
| U2515365 | SPTL | 14.87 | USD | 2026-05-06T20:20Z | 39722222586 | Dividends |
| U2515365 | SPTL | -0.79 | USD | 2026-05-06T20:20Z | 39722222570 | Withholding Tax |
| U2515365 | AGG | -8.25 | USD | 2026-05-06T20:20Z | 39730995168 | Withholding Tax |
| U2515365 | SPTL | -3.72 | USD | 2026-05-06T20:20Z | 39722222594 | Withholding Tax |
| U2515365 | AGG | 32.99 | USD | 2026-05-06T20:20Z | 39730995153 | Payment In Lieu Of Dividends |

All rows: correct account_id (U2515365), structured source_transaction_id (stable IBKR transactionID), valid currency.

### 6.3 `dividend_accruals` sample rows (10 most recent by ex_date)

Most recent accruals include PFE (ex_date 2026-05-08, pay_date 2026-06-12, gross_rate 0.43, net_amount 193.50), MAIN (ex_date 2026-05-08, pay_date 2026-05-15, gross_rate 0.26, net_amount 39.00), BX (ex_date 2026-05-04, gross_rate 1.16, net_amount 261.00).

**Observed pattern:** JEPI appears twice in 'change' section with ex_date 2026-05-01, net_amounts +100.71 and -100.71. This is normal IBKR accrual reversal behavior (accrual booked then reversed on settlement). Each has distinct report_date so the `(account_id, report_date, source_section)` window idempotency key correctly distinguishes them.

**Column naming note:** The query spec referenced `accrual_amount` but the actual DB column is `net_amount` (matches IBKR's `netAmount` field). This is a spec-document inconsistency, not a data bug. Columns `gross_rate`, `gross_amount`, `tax`, `fee`, `net_amount` are all present and populated.

### 6.4 `bond_holdings` data quality

All 18 bonds (7 Corp + 11 Govt) have:
- Correct `ticker` parsed from IBKR symbol string
- Correct `coupon_rate` parsed (e.g., `4.250000` for "4 1/4", `3.875000` for "3 7/8") ✅
- Correct `maturity_date` structured dates (e.g., `2047-02-09`, `2034-02-15`) ✅
- Full `cusip` and `isin` populated (18/18 each) ✅
- `accrued_interest` = NULL for all 18 (❌ portal not configured)
- `listing_exchange` = empty string `''` for all 18 — **not NULL**. IBKR returns `listingExchange=""` on bond rows in OpenPositions (bonds trade OTC, not on a named exchange). This is correct behavior, not a data gap. Column exists per schema.

**Bond column naming note:** DB uses `ticker` (not `symbol`) as the primary identifier column. The spec query referenced `symbol`; corrected for this run.

### 6.5 `security_reference` sample (10 rows, ordered by con_id)

| con_id | symbol | isin | cusip | figi | listing_exchange | source |
|---|---|---|---|---|---|---|
| 4065 | ABT | US0028241000 | 002824100 | BBG000B9ZXB4 | NYSE | open_positions |
| 4391 | AMD | US0079031078 | 007903107 | BBG000BBQCY0 | NASDAQ | open_positions |
| 5111 | BMY | US1101221083 | 110122108 | BBG000DQLV23 | NYSE | open_positions |
| 6459 | DIS | US2546871060 | 254687106 | BBG000BH4R78 | NYSE | open_positions |
| 10291 | NKE | US6541061031 | 654106103 | BBG000C5HS04 | NYSE | open_positions |
| 10672 | O | US7561091049 | 756109104 | BBG000DHPN63 | NYSE | open_positions |
| 11031 | PFE | US7170811035 | 717081103 | BBG000BR2B91 | NYSE | open_positions |
| 13277 | UNM | US91529Y1064 | 91529Y106 | BBG000BW2QX0 | NYSE | open_positions |
| 14121 | DBK | DE0005140008 | NULL | BBG000BBZTH2 | IBIS | open_positions |
| 265598 | AAPL | US0378331005 | 037833100 | BBG000B9XRY4 | NASDAQ | open_positions |

All 75 rows sourced from OpenPositions (source='open_positions'). DBK correctly has NULL cusip (German-listed stock, no US CUSIP). FIGI, ISIN, and listing_exchange populated for all major positions.

### 6.6 `stock_positions` identifier column quality (max as_of_date = 2026-05-01, first 15)

| ticker | cusip | isin | figi | listing_exchange | cost_basis_total | security_id_type |
|---|---|---|---|---|---|---|
| AAPL | 037833100 | US0378331005 | BBG000B9XRY4 | NASDAQ | 189.50 | ISIN |
| ABR | 038923108 | US0389231087 | BBG000KMVDV1 | NYSE | 3,633.21 | ISIN |
| ABT | 002824100 | US0028241000 | BBG000B9ZXB4 | NYSE | 9,398.00 | ISIN |
| AGG | 464287226 | US4642872265 | BBG000Q123R0 | ARCA | 9,375.50 | ISIN |
| DBK | NULL | DE0005140008 | BBG000BBZTH2 | IBIS | 2,234.00 | ISIN |

DBK: NULL cusip is correct (German equity). All ISIN-typed. All have cost_basis_total. ✅

---

## 7. Master XML Cross-Validation

### 7.1 `dividend_payments` spot-checks (3 transactions)

Ground truth: `reports/activity/OptionsIncomeDashboard_Master.xml` — 770 CashTransaction rows.

| source_transaction_id | Expected symbol | Expected amount | Expected type | DB match |
|---|---|---|---|---|
| `39722222586` | SPTL | +14.87 USD | Dividends | ✅ Exact match |
| `39722222570` | SPTL | -0.79 USD | Withholding Tax | ✅ Exact match |
| `39730995153` | AGG | +32.99 USD | Payment In Lieu Of Dividends | ✅ Exact match |

All 3 spot-check transactions resolved by `source_transaction_id`. Amounts, symbols, and types match exactly.

### 7.2 `bond_holdings` spot-checks (3 positions)

Ground truth: master XML BOND rows (18 total: 7 Corp + 11 Govt).

| ticker (XML symbol) | XML cusip | DB cusip | DB coupon_rate | DB maturity_date | DB market_value | DB sub_category |
|---|---|---|---|---|---|---|
| AAPL 4 1/4 02/09/47 | 037833CH1 | 037833CH1 ✅ | 4.250000 ✅ | 2047-02-09 ✅ | 6,739.92 | Corp ✅ |
| BA 3 1/2 03/01/45 | 097023BL8 | 097023BL8 ✅ | 3.500000 ✅ | 2045-03-01 ✅ | 12,816.18 | Corp ✅ |
| T 4 02/15/34 | 91282CJZ5 | 91282CJZ5 ✅ | 4.000000 ✅ | 2034-02-15 ✅ | 1,968.44 | Govt ✅ |

All 3 bond spot-checks pass. CUSIP, coupon_rate (correctly parsed from mixed-fraction symbol), and maturity_date all match the master XML. `parse_bond_symbol()` validated.

### 7.3 `dividend_accruals` vs master XML

Master XML: 211 `ChangeInDividendAccruals` + 6 `OpenDividendAccruals` = 217 total.

DB: `source_section='change'`: **211**, `source_section='open'`: **6**. Total: **217**.

Count matches exactly. ✅

### 7.4 `stock_positions` vs master XML

Master XML: 57 STK `OpenPositions` rows.
DB (as_of_date = 2026-05-01): 57 STK positions in this snapshot (verified via the 57/270 `with_fxRateToBase` count matching the most recent sync window). 270 total flex rows (all as_of_date snapshots combined).
master XML expected: 115 OpenPositions total (57 STK + 40 OPT + 18 BOND). The 57 STK rows match the max snapshot. ✅

---

## 8. Idempotency Verification

| Table | Constraint | Duplicate check query | Result |
|---|---|---|---|
| `dividend_payments` | UNIQUE (account_id, source_transaction_id) | GROUP BY … HAVING COUNT(*) > 1 | **0 rows** ✅ |
| `security_reference` | PRIMARY KEY (con_id) | GROUP BY con_id HAVING COUNT(*) > 1 | **0 rows** ✅ |
| `bond_holdings` | Window delete on (account_id, con_id, as_of_date) | GROUP BY … HAVING COUNT(*) > 1 | **0 rows** ✅ |

No duplicates found in any of the three idempotency-sensitive tables. The backfill script's second-run verification (per Hockney's note) is confirmed by live-DB query.

---

## 9. Regression Check

| Table | Expected | Actual | Result |
|---|---|---|---|
| `options_cash_events` rows | 6,028 | **6,028** | ✅ No rows deleted or modified |
| `options_cash_events` max_date | 2026-05-06 | **2026-05-06** | ✅ |
| `stock_positions` (flex) rows | 270 | **270** | ✅ (up from 213 in prior; the delta is from successful prior sync that ran between the two revalidations) |
| `options_positions` rows | 215 | **215** | ✅ Untouched |

Note: The `accounts` table referenced in the regression query template does not exist as a standalone `public.accounts` table in this schema (accounts are represented differently). That query was skipped with a note; it does not indicate a regression.

The 5,524 dividend-type rows in `options_cash_events` are still present and have NOT been deleted — consistent with Hockney's explicit "DO NOT delete" recommendation pending McManus sign-off.

---

## 10. Outstanding Issues

### ❌ Issue 1: `accruedInterest` absent from BOND positions (Portal fix #2)

**Impact:** All 18 `bond_holdings` rows have `accrued_interest = NULL`. Clean/dirty price separation is not computable from DB data. Total bond portfolio value is understated by the sum of accrued interest across all 18 positions.
**Root cause:** IBKR Flex portal not configured to include `accruedInterest` on OpenPositions BOND rows.
**Owner:** Jony (portal config). Hockney's `FlexBondPosition.accrued_interest` field is ready to receive the data once portal is updated.

### ❌ Issue 2: `FinancialInstrumentInformation` still not in portal (Portal fix #1)

**Impact:** `security_reference` is seeded from OpenPositions (75 rows, source='open_positions'). Structured `maturity` and `issueDate` for bonds are not available from FII. Bond maturity is currently parsed from the symbol string (adequate for v1, fragile long-term).
**Owner:** Jony.

### ⚠️ Issue 3: `assetCategory` / `fxRateToBase` on `dividend_payments` — near-zero coverage

**Impact:** 34 of 5,524 rows (0.6%) have `assetCategory` and `fxRateToBase` in raw_payload. Multi-currency WHT income (e.g., EUR-denominated German stock withholding) cannot be converted to base currency from DB data alone. External FX rates required.
**Root cause:** Portal fix #3/4 not yet applied for CashTransactions; the 34 rows with these keys existed in the original options_cash_events payload before any portal change.
**Owner:** Jony (portal config to enable both fields on CashTransactions).

### ⚠️ Issue 4: `listing_exchange` on `bond_holdings` is empty string, not NULL

**Impact:** Low. All 18 `bond_holdings` rows have `listing_exchange = ''` (empty string). This reflects IBKR's own behavior — bonds trade OTC and IBKR returns `listingExchange=""`. The column exists (schema correct), the value is correct-per-source. Consumers should treat `'' OR NULL` as "no exchange" for bonds.
**Owner:** No action required unless downstream consumers need explicit NULL.

### ❌ Issue 5: No fresh live Flex sync since throttle

**Impact:** `stock_positions` max as_of_date = 2026-05-01. All backfill data is from the master XML (dated 2026-05-08), not from a live sync. The worker is healthy and parser is updated, but IBKR error 1001 has blocked the sync. Daily-refresh scope switch (YTD → LBD) also cannot be confirmed until a successful sync runs.
**Owner:** Jony (wait for IBKR throttle to clear; re-save Flex query in Account Management if needed).

### ⚠️ Issue 6: `bond_holdings.listing_exchange` hotfix migration status

**Finding:** The column `listing_exchange` exists on `bond_holdings` in the live schema (queried directly). Whether this was added by migration `20260510000600` or was already present in `20260510000200` is not determinable from column introspection alone. The functional requirement is met.
**Status:** Not blocking — column present. Bug filed in hockney-7 is effectively resolved.

---

## 11. Recommendations for Next Milestone

### Immediate (before next sprint)

1. **Jony — Apply IBKR portal changes** (items 6, 7, 8 in §6 checklist): Enable `FinancialInstrumentInformation`, enable `accruedInterest` on OpenPositions, enable `assetCategory` + `fxRateToBase` on CashTransactions. These 3 portal gaps are the only remaining technical blockers to full pipeline correctness.

2. **Jony — Clear IBKR throttle / re-save Flex query**: Once throttle clears, a live sync will: (a) advance `stock_positions` snapshot past 2026-05-01, (b) confirm new parser code handles all 4 portal fields in live XML, (c) populate `bond_holdings` via the live `_sync_bond_positions()` path (now that `listing_exchange` column exists).

3. **Jony — Switch Flex query scope to Last Business Day**: After portal changes are applied and a successful sync runs, change daily-refresh from YTD to LBD. This reduces `ChangeInDividendAccruals` churn (211 rows YTD → ~5–20 rows LBD) and file size.

### After portal confirmation (next milestone)

4. **McManus — v3 revalidation after first post-portal live sync**: Re-check `dividend_payments.raw_payload` for `assetCategory` and `fxRateToBase` coverage, `bond_holdings.accrued_interest` for non-NULL values, `security_reference` for source='fii' rows.

5. **Hockney — Cleanup migration for `options_cash_events`**: After McManus v3 revalidation signs off on `dividend_payments` data quality, apply the cleanup migration to remove the 5,524 duplicate dividend-type rows from `options_cash_events`. Requires Jony approval (deletes 5,524 rows from production).

6. **Hockney — End-to-end test of `_sync_bond_positions()`**: Confirm the live code path (not the backfill direct-INSERT workaround) works correctly for BOND positions now that `listing_exchange` column exists.

7. **Data enrichment**: `couponFrequency`, `creditRating`, and `yieldToMaturity` are confirmed absent from IBKR Flex XML. PortfolioAnalyst or a third-party bond data API is needed for these fields. Deferred per existing directive.

---

## Appendix: Column-Name Discrepancies vs Spec Query Template

| Spec template used | Actual DB column | Table | Impact |
|---|---|---|---|
| `payment_date` | `date_time` | `dividend_payments` | Query error — corrected in this run |
| `accrual_amount` | `net_amount` | `dividend_accruals` | Query error — corrected in this run |
| `symbol` | `ticker` | `bond_holdings` | Query error — corrected in this run |
| `symbol` | `ticker` | `stock_positions` | Query error — corrected in this run |

These are spec-document issues, not data bugs. The actual schema uses IBKR-native field names where appropriate.

---

*Filed by McManus — 2026-05-10*
