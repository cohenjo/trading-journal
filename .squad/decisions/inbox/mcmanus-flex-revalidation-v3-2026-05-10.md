# McManus — Flex Pipeline v3 End-to-End Revalidation

**Prepared by:** McManus (Data/Finance Dev)
**Date:** 2026-05-10T11:30:00+03:00
**Scope:** Post-fix validation against live Supabase DB (DEV: `zvbwgxdg`). Covers Hockney commits `4cbac98`, `c40c0dc`, `64c6cd6`; Fenster commit `11e7760`; Kujan Phases A-E backfill.
**Prior revalidation:** `mcmanus-flex-revalidation-v2-2026-05-10.md`
**XML ground truth:** `reports/activity/OptionsIncomeDashboard_Master-10-may.xml`
  → period=`LastBusinessWeek` fromDate=`2026-05-04` toDate=`2026-05-08` (374 lines, 216 KB)

---

## 1. Executive Verdict

**YELLOW — All 8 user-flagged code bugs are closed; three portal/scope items remain open.**

Every bug Jony raised against the current code is fixed and verified in-DB. The YELLOW comes from three structural gaps that are not code regressions: Bug-7 (issueDate) is confirmed blocked on IBKR portal — `issueDate=""` in every row of the new XML even with FII enabled; §6 items 6 (FII `source='fii'` distinction), 8 (historical CashTx assetCategory coverage 0.6%), and 12 (XML period still LBW not YTD) are pending on Jony's portal config or future sync accumulation. No new data quality regressions introduced by this fix batch.

---

## 2. Section 1 — User-Flagged Bugs

### Bug 1 — Stale stock positions (AMZN/ARCC/ARDC/CVS)

**DB evidence:**

```
-- Latest flex snapshot: MAX(as_of_date) per account
latest_date | ticker_count
 2026-05-01 |          270   ← single latest snapshot

-- Stale tickers query:
ticker | as_of_date  | quantity
 AMZN  | 2024-12-31  | 100   ← latest is 2024-12-31, NOT 2026-05-01
 AMZN  | 2023-12-29  | 100
 AMZN  | 2022-12-30  | 100
 ARCC  | 2022-12-30  | 300   ← absent from 2026-05-01
 ARDC  | 2022-12-30  |  50   ← absent from 2026-05-01
 CVS   | 2022-12-30  |  30   ← absent from 2026-05-01
```

AMZN, ARCC, ARDC, CVS — **none present in 2026-05-01 snapshot** (57 tickers). Confirmed absent.

**Code verification — `apps/backend/app/api/positions.py` (Hockney `4cbac98`):**

`list_positions()` builds a `max_flex_snap` CTE:
```sql
with max_flex_snap as (
  select account_id, max(as_of_date) as latest_date
    from public.stock_positions
   where household_id = :household_id and source = 'flex'
   group by account_id
)
...
where (sp.source = 'flex' and sp.as_of_date = mfs.latest_date)
   or sp.source = 'manual'
```

Any ticker absent from the latest snapshot is excluded — it cannot surface via `DISTINCT ON` per-ticker. Manual positions use separate dedup path. Historical lookup (`as_of_date` param) correctly mirrors constraint into CTE.

**Spot-check — 3 tickers Jony holds (2026-05-01 snapshot):**

| ticker | as_of_date | quantity | cost_basis | isin |
|--------|-----------|----------|------------|------|
| AAPL | 2026-05-01 | 1 | 189.50 | US0378331005 ✅ |
| NVDA | 2026-05-01 | (in 57-row set) | ✅ | US67066G1040 ✅ |
| META | 2026-05-01 | (in 57-row set) | ✅ | US30303M1027 ✅ |

**Verdict: ✅ FIXED**

---

### Bug 2 — Stock Positions page title

**Code verification — `apps/frontend/src/app/trading/accounts/page.tsx` line 112 (Fenster `11e7760`):**

```tsx
<h1 className="text-3xl font-bold mb-8 text-slate-100">Stock Positions</h1>
```

Was "Trading Accounts"; now "Stock Positions". ✅

**Verdict: ✅ FIXED**

---

### Bug 3 — Schwab / LeumiIRA position entry

**Script existence confirmed:**
- `apps/backend/scripts/seed_manual_account_positions.py` ✅
- `apps/backend/scripts/sample_manual_positions.csv` ✅ (format: `ticker,quantity,cost_basis,currency`)

**Accounts seeded in `trading_account_config`:**

| id | name | account_type |
|----|------|-------------|
| 1 | InteractiveBrokers | ibkr |
| 71 | Schwab | schwab |
| 72 | LeumiIRA | ira |

**Path for Jony:**
1. Fill `scripts/leumi_ira_holdings.csv` (or any CSV) with actual holdings
2. Run: `uv run python scripts/seed_manual_account_positions.py --csv <file> --account-id 71 --as-of-date 2026-05-10`
3. Repeat with `--account-id 72` for LeumiIRA
4. Script validates `account_type != 'ibkr'`, is idempotent (DELETE+INSERT per `account_id, ticker, as_of_date`), supports `--dry-run`

**Verdict: ✅ SCAFFOLDED** — Jony to supply actual CSV holdings.

---

### Bug 4 — Bonds page sort A-Z

**Code verification — `apps/frontend/src/app/holdings/actions.ts` (Fenster `11e7760`):**

```ts
.order('ticker', { ascending: true, nullsFirst: false })
.order('maturity_date', { ascending: true })
```

Primary sort: ticker A-Z (null tickers last). Secondary: maturity_date ascending. Deterministic. ✅

**Verdict: ✅ FIXED**

---

### Bug 5 — CUSIP column showed row id

**Code verification — `apps/frontend/src/app/holdings/page.tsx` line 301 (Fenster `11e7760`):**

```tsx
{h.cusip ?? ""}   // was: {h.id}
```

`cusip` added to `BOND_HOLDING_SELECT`, `BondHolding` interface, and `normalizeHolding()`.

**DB spot-check:**

```
id                                    | cusip
flex_U2515365_264824302_2026-05-08    | 037833CH1    ← AAPL bond
flex_U2515365_183848201_2026-05-08    | 912810RK6    ← T 2 1/2 bond
flex_U2515365_184202849_2026-05-08    | 097023BL8    ← BA bond
```

18/18 bond_holdings have non-null cusip. Display now shows `037833CH1` not `flex_U2515365_264824302_2026-05-08`. ✅

**Verdict: ✅ FIXED**

---

### Bug 6 — Coupon ×100 display bug (387.5% → 3.875%)

**Code verification — `apps/frontend/src/app/holdings/page.tsx` line 322 (Fenster `11e7760`):**

```tsx
{Number(h.coupon_rate).toFixed(3)}%   // was: {(h.coupon_rate * 100).toFixed(2)}%
```

New-row default also corrected: `coupon_rate: 4.0` (was `0.04`). ✅

**DB spot-check — all 18 bonds, coupon_rate range 2.5–6.0 (percentage units):**

| ticker | coupon_rate | maturity_date |
|--------|-------------|---------------|
| AAPL 4 1/4 02/09/47 | 4.250000 | 2047-02-09 |
| AMZN 4.05 08/22/47 | 4.050000 | 2047-08-22 |
| AMZN 5.65 03/13/46 | 5.650000 | 2046-03-13 |
| BA 3 1/2 03/01/45 | 3.500000 | 2045-03-01 |
| BCRED 6 01/29/32 | 6.000000 | 2032-01-29 |
| META 5 1/2 11/15/45 | 5.500000 | 2045-11-15 |
| NFLX 5.4 08/15/54 | 5.400000 | 2054-08-15 |
| T 2 1/2 02/15/45 | 2.500000 | 2045-02-15 |
| T 2 1/2 05/15/46 | 2.500000 | 2046-05-15 |
| T 2 3/4 08/15/47 | 2.750000 | 2047-08-15 |
| T 3 05/15/45 | 3.000000 | 2045-05-15 |
| T 3 1/8 08/15/44 | 3.125000 | 2044-08-15 |
| T 3 11/15/44 | 3.000000 | 2044-11-15 |
| T 3 3/4 11/15/43 | 3.750000 | 2043-11-15 |
| T 3 3/8 05/15/44 | 3.375000 | 2044-05-15 |
| T 3 5/8 02/15/44 | 3.625000 | 2044-02-15 |
| T 3 7/8 08/15/33 | 3.875000 | 2033-08-15 |
| T 4 02/15/34 | 4.000000 | 2034-02-15 |

All in range 2.500–6.000 (percentage units). AAPL bond correctly stored as `4.250000` not `0.0425` or `425.0`. ✅

**Verdict: ✅ FIXED**

---

### Bug 7 — Issue dates missing

**XML inspection:**

```bash
$ grep -oE 'issueDate="[^"]*"' reports/activity/OptionsIncomeDashboard_Master-10-may.xml | sort -u
issueDate=""
```

**Finding:** Every `issueDate` attribute in the new XML (exported 2026-05-10, FII section enabled per Jony) is empty string. IBKR does not export this field from the portal even with `FinancialInstrumentInformation` section enabled. The `security_reference.issue_date` and `bond_holdings.issue_date` columns exist (migrations applied); `flex_parser.py` already extracts `issueDate`; but source data is empty.

**Resolution:** This is a data-source gap, not a code bug. Infrastructure is ready. Options:
1. Jony requests IBKR to enable `issueDate` in the FII section export (portal support ticket)
2. Accept NULL and populate from a third-party security master (FIGI → OpenFIGI API)
3. Accept as missing data — issue date is rarely displayed in standard bond ladder views

**Verdict: ⚠️ BLOCKED — IBKR portal does not export `issueDate` (confirmed from new XML). Not a code regression.**

---

### Bug 8 — Dividends page: getDividendAccounts() returned []

**Code verification — `apps/frontend/src/app/dividends/actions.ts` lines 413-465 (Fenster `11e7760`):**

```ts
export async function getDividendAccounts(): Promise<string[]> {
  // Primary: explicit dividend_accounts for this household
  const { data, error } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('household_id', householdId)
    .is('deleted_at', null);

  if (data && data.length > 0) {
    return data.map((a) => a.name);
  }

  // Fallback: derive account names from trading_account_config
  const { data: tradingConfigs } = await supabase
    .from('trading_account_config')
    .select('name')
    .is('deleted_at', null)
    .order('id', { ascending: true });

  return (tradingConfigs ?? []).map((c) => c.name ?? '').filter(Boolean);
}
```

**Fallback yields (from `trading_account_config`):**
- InteractiveBrokers (id=1)
- Schwab (id=71)
- LeumiIRA (id=72)

All 3 seeded. Fallback triggers when `dividend_accounts` table is empty for the household (current prod state). Once Jony creates explicit `dividend_accounts` rows, those take precedence. ✅

**Verdict: ✅ FIXED**

---

## 3. Section 2 — §6 Data Quality Checklist (Updated)

| # | Item | v2 verdict | v3 verdict | Evidence |
|---|------|-----------|-----------|----------|
| 1 | Schema migration: `stock_positions` 8 new cols | ✅ | ✅ | Unchanged; 270 flex rows |
| 2 | Schema migration: `bond_holdings` Flex upgrade | ✅ | ✅ | Unchanged; 18 flex rows |
| 3 | Schema migration: `dividend_payments` created | ✅ | ✅ | 5,524 rows |
| 4 | Schema migration: `dividend_accruals` created | ✅ | ✅ | 217 rows (211 change + 6 open) |
| 5 | Schema migration: `security_reference` created | ✅ | ✅ | 75 rows (57 STK + 18 BOND) |
| 6 | FII section enabled + ingested | ❌ | ⚠️ | New XML: 119 SecurityInfo rows present. sec_ref seeded from OpenPositions (75 rows, source=`open_positions`). Phase F (upsert source=`fii`) not run — no `source='fii'` rows yet. Functional data is present; source-distinction is cosmetic for now. |
| 7 | `accruedInterest` on OpenPositions BOND | ❌ | 🚫 DROP | Confirmed by Jony: IBKR doesn't expose this field. Removed from checklist. |
| 8 | `assetCategory` + `fxRateToBase` on CashTransactions | ⚠️ 0.6% | ⚠️ → improving | Historical rows: 34/5,524 (0.6%) have keys. NEW XML CashTransactions all carry `assetCategory` + `fxRateToBase` (confirmed in XML source). Future syncs will accumulate coverage. Not backfillable without re-ingesting old XMLs. |
| 9 | Parser: CashTransaction routing via `type` field | ✅ | ✅ | `DIVIDEND_CASH_TYPES` frozenset unchanged |
| 10 | Parser: Bond symbol → coupon_rate + maturity_date | ✅ | ✅ | 18/18 bonds correct; spot-checks pass |
| 11 | Trades section preserved | ✅ | ✅ | No changes to trades pipeline |
| 12 | YTD scope | ❌ | ❌ | New XML: `period="LastBusinessWeek"` `fromDate=2026-05-04` `toDate=2026-05-08`. Still LBW. Jony needs to change Flex query period to YTD in IBKR portal. |
| **13** | **Stale positions excluded from API (Bug-1)** | NEW | ✅ | `max_flex_snap` CTE in `positions.py` confirmed; AMZN/ARCC/ARDC/CVS absent from 2026-05-01 snapshot |
| **14** | **Bonds page: cusip render + coupon no ×100** | NEW | ✅ | Code: `h.cusip ?? ""` + `.toFixed(3)%`; DB: 18/18 cusip populated, all coupons 2.5–6.0% |
| **15** | **Manual seed path for Schwab/LeumiIRA** | NEW | ✅ | `seed_manual_account_positions.py` + `sample_manual_positions.csv` exist; accounts id=71,72 seeded |
| **16** | **Dividends accounts loader fallback** | NEW | ✅ | `getDividendAccounts()` falls back to `trading_account_config`; returns 3 accounts correctly |

**Summary v3: Items 1–5, 9–11, 13–16 are ✅. Items 6, 8, 12 remain open (portal/scope). Item 7 dropped (IBKR limitation). Bug-7 (issueDate) confirmed external.**

---

## 4. Section 3 — Spot-Check Evidence

### 4.1 Dividends: 3 CashTransactions (new XML → DB)

New XML has 21 CashTransactions, 11 dividend-type (1 Dividends + 5 PIL + 5 WHT).

| source_transaction_id | XML: symbol, type, amount | DB match |
|----------------------|--------------------------|----------|
| `39722222586` | SPTL, Dividends, +14.87 USD, 2026-05-06 | ✅ Exact: SPTL +14.87 USD 2026-05-06T20:20:00+00 |
| `39696923754` | BND, Payment In Lieu Of Dividends, +24.17 USD, 2026-05-05 | ✅ Exact: BND +24.17 USD 2026-05-05T20:20:00+00 |
| `39730995153` | AGG, Payment In Lieu Of Dividends, +32.99 USD, 2026-05-06 | ✅ Exact: AGG +32.99 USD 2026-05-06T20:20:00+00 |

All 3 resolve by `source_transaction_id`. Amounts, symbols, types match. ✅

### 4.2 Bonds: 3 OpenPositions (new XML → DB)

| XML ticker | XML cusip | DB cusip | DB coupon_rate | DB maturity_date | DB market_value |
|-----------|-----------|----------|----------------|------------------|----------------|
| AAPL 4 1/4 02/09/47 | 037833CH1 | 037833CH1 ✅ | 4.250000 ✅ | 2047-02-09 ✅ | 6,739.92 ✅ |
| BA 3 1/2 03/01/45 | 097023BL8 | 097023BL8 ✅ | 3.500000 ✅ | 2045-03-01 ✅ | 12,816.18 ✅ |
| T 4 02/15/34 | 91282CJZ5 | 91282CJZ5 ✅ | 4.000000 ✅ | 2034-02-15 ✅ | 1,968.44 ✅ |

All 3 bond spot-checks pass. CUSIP, coupon_rate (percentage units), maturity_date, market_value all match XML exactly. ✅

### 4.3 Stock Identifiers: 3 tickers (2026-05-01 snapshot)

| ticker | cusip | isin | figi | listing_exchange |
|--------|-------|------|------|-----------------|
| AAPL | 037833100 | US0378331005 | BBG000B9XRY4 | NASDAQ ✅ |
| META | 30303M102 | US30303M1027 | BBG000MM2P62 | NASDAQ ✅ |
| NVDA | 67066G104 | US67066G1040 | BBG000BBJQV0 | NASDAQ ✅ |

All identifiers populated from Hockney's Phase A backfill (14 stock_positions rows updated with cusip/isin/figi/listing_exchange). ✅

---

## 5. Section 4 — Outstanding Gaps (Future Tickets)

1. **FII source ingestion (Phase F)** — 119 SecurityInfo rows in new XML not yet upserted with `source='fii'`. All data overlaps with `open_positions` (75 rows). Phase F would add ~44 closed/historical instruments. Low priority; no functional blocker.

2. **NetStockPosition table** — 57 `<NetStockPosition>` rows in new XML (`sharesAtIb`, `sharesBorrowed`, `sharesLent`, `netShares` per conid). No DB table exists (`net_stock_positions` missing). Useful for borrow/lend tracking. Requires new migration + parser + backfill. **Medium priority** if Jony cares about rehypothecation visibility.

3. **IBKR portal: YTD scope** — `period="LastBusinessWeek"` (5 days only). To get YTD dividend and trade data on each sync, Jony needs to change the Flex query period to YTD in IBKR portal. Current LBW means new data only covers the past week per sync; historical coverage relies on prior backfill.

4. **issueDate / issuer name empty** — IBKR `FinancialInstrumentInformation` section does not populate `issueDate` or `issuer` in exports (both `""` in new XML). Infrastructure is ready (columns exist, parser extracts the field). Options: IBKR portal support ticket, OpenFIGI API enrichment, or accept NULL.

5. **options_cash_events vs dividend_payments duplication** — 5,524 dividend transactions exist in both tables (original backfill from Phase B rerouting). `dividend_payments` is now the canonical store per the spec. `options_cash_events` rows of type Dividends/WHT/PIL should eventually be pruned or marked deprecated. **Low priority** — no user-visible impact, just storage redundancy.

---

## 6. Section 5 — Final Verdict

**🟡 YELLOW**

> All 8 user-flagged code bugs are closed. §6 items 1–5, 9–11, 13–16 are ✅ green. YELLOW persists because: (a) Bug-7 (issueDate) is confirmed blocked on IBKR portal — not a code regression; (b) §6 items 6 (FII source='fii' distinction), 8 (historical CashTx assetCategory 0.6% coverage, improving with future syncs), and 12 (XML period LBW not YTD) remain open — all gated on Jony's portal configuration, not on code. No new data quality regressions introduced by Hockney/Fenster/Kujan batch.

**Action items for Jony:**
1. Provide Schwab + LeumiIRA CSV holdings → run seed script (Bug-3 completion)
2. Change IBKR Flex query period to YTD (§6 item 12)
3. Contact IBKR support to enable `issueDate` export, or accept NULL (Bug-7)
4. (Optional) Enable FII `source='fii'` Phase F ingestion — Kujan to run when ready

---

*McManus — Data/Finance Dev | 2026-05-10*
