# Mcmanus — Active History

> **Last summarized:** 2026-05-13 (removed 176 older entries to archive)
> **Current size:** 21810 bytes

---

- Query ID `1496910` is used by the live daily sync.
- `flex_probe.py` defines 5 query ENV keys: `trades`, `option_eae`, `cash`, `positions`, `account_info`. The `IBKR_FLEX_QUERY_ID_POSITIONS` key exists but is currently unused in the options pipeline (options_sync.py uses the activity XML which has all sections bundled).
- The `OpenPositions` section in existing XMLs is confirmed present — **no new Flex query template needed**.

**DB schema — current state:**
- `options_positions`: OPT-specific. Has FK `leg_id → options_legs` (options-specific concept). Not reusable for STK.
- `dividend_positions`: Manual roster `{id, account, ticker, shares}` with index on `account`. No market data, no `conid`, no `currency`. Used for dividend income enrichment via yfinance. NOT synced from Flex XML.
- `trading_positions`: Live-API-sourced `{symbol, amount, sec_type, avg_cost, con_id, timestamp, account_config_id, household_id}`. Populated from trading_service.py (IBKR/Schwab live API), not from Flex XML. Lacks `markPrice`, `positionValue`, `unrealized_pnl`, `cost_basis_total`.
- **No `stock_positions` table from Flex XML exists yet.** A new table is needed.

**Dividend pipeline coupling:**
- `dividend_positions` (manual roster) → `dividend_service.py` enriches via yfinance → computes `annual_income = shares × dividend_rate`. Summary page reads this projected annual income.
- `dividend_estimations` (just shipped in migration 20260509151900): user-entered year-level income overrides `{household_id, year, amount}`. Summary page's `buildYearlyIncomeData()` uses estimations for past years where user has overridden the projection.
- These two tables are **separate concerns**: `dividend_positions` drives the yfinance projection; `dividend_estimations` overrides the chart per year.
- Neither table interacts with Flex XML — they're fully manual/user-entered.

### Recommendation: Option A — Existing XML is sufficient

The STK `<OpenPosition>` data is fully present in every annual Flex XML file. No new IBKR query template needed. Implementation path:
1. **Parser** (5 lines): Add STK branch alongside OPT branch in `parse_flex_files()` at line 198. Capture a `FlexStockPosition` model with STK-relevant fields (symbol, conid, quantity, costBasisPrice, costBasisMoney, markPrice, positionValue, fifoPnlUnrealized, currency, subCategory, putCall guard).
2. **DB migration**: New `stock_positions` table with `(id, household_id, account_id, as_of_date, symbol, conid, description, sub_category, currency, quantity, cost_basis_price, cost_basis_total, mark_price, market_value, unrealized_pnl, raw_payload, last_broker_sync_at, created_at, updated_at)`. Unique key: `(household_id, account_id, as_of_date, symbol, conid)`. Delete-then-insert scoped by `as_of_date` (same pattern as options_positions).
3. **Handler** (Hockney): New `_sync_stock_positions()` function in options_sync.py or a dedicated handler.
4. **No IBKR Account Management changes** needed.

### Key insight

`openDateTime` is always empty for STK positions in the XML — IBKR does not provide per-lot open dates in the Activity Flex OpenPositions section. The positions view will show aggregate quantity and average cost basis but not open-date-per-lot. This is acceptable for an "Open Positions" dashboard view but rules out per-lot holding period calculations from this data source alone.

📌 **Team update (2026-05-09T20:53:00+03:00):** Phase 2 positions source investigation complete. Verdict: **Option A** — existing Activity Flex XML (query 1496910) already contains STK `<OpenPosition>` rows with all needed fields. Parser at flex_parser.py:198–200 silently drops STK rows — 5-line fix. Need new `stock_positions` table (no IBKR changes). Unblocks Hockney + Keaton.

## 2026-05-09 — Flex query redesign for #340 follow-up

Jony reported deployed `/trading/accounts` data had duplicate rows and wrong quantities when trades were used as source. I wrote `.squad/decisions/inbox/mcmanus-flex-query-spec.md` recommending one revised Activity Flex query with OpenPositions, FinancialInstrumentInformation, CashTransactions, ChangeInDividendAccruals, OpenDividendAccruals, and CorporateActions. Verified prod has `stock_positions`, `bond_holdings`, `dividend_ticker_data`, and `dividend_estimations`, but not `dividend_payments` or `dividend_accruals`. Key lesson: Option A was right on source direction but too narrow on field coverage and UI reconciliation.

---

📌 **Team update (2026-05-09):** Flex spec submitted; awaiting Jony portal config. Phase 2 reflection (§9 of spec) contains lessons for future broker-data work. Recommend archiving Phase 2 section for reference when planning dividend accrual and bond analytics enrichment. — Scribe

## 2026-05-09T23:53:57+03:00 — Flex Query Validation against OptionsIncomeDashboard_Master.xml

**File:** `reports/activity/OptionsIncomeDashboard_Master.xml` — YTD 2026-01-01→2026-05-08, account U2515365.

**Full report:** `.squad/decisions/inbox/mcmanus-flex-validation.md`

### Section findings (contradicts / refines IBKR docs):

1. **`FinancialInstrumentInformation` is ABSENT.** Not enabled by Jony in the portal. However — key discovery — IBKR already includes most FII fields **directly in `OpenPositions` rows**: `listingExchange`, `securityID`, `securityIDType`, `cusip`, `isin`, `figi`, `issuer` are all on every STK and BOND row. The spec assumed FII was the only source for identifiers; that was wrong. FII is still needed for structured `maturity` and `issueDate` on bonds.

2. **`CashTransactions` is missing `assetCategory` and `fxRateToBase`.** Both are absent from all 770 rows. Parser must route by `type` field instead of `assetCategory` (workable — `type` is fully populated and semantically distinct). `fxRateToBase` absence means multi-currency income (e.g., EUR-denominated WHT) cannot be converted to base currency from the XML; external FX rates needed. NOTE: `ChangeInDividendAccruals` and `OpenDividendAccruals` DO carry both fields correctly — the gap is CT-specific.

3. **BOND `expiry` is present but empty for all 18 bonds.** Maturity date only available via symbol-string parsing (e.g., "AAPL 4 1/4 02/09/47" → maturity=2047-02-09, coupon=4.25%). Fragile but workable for v1. FII section (when enabled) will provide structured `maturity`.

4. **BOND `accruedInterest` is entirely absent** (attribute not emitted). Must be enabled in portal. This is the most impactful bond field gap.

5. **`levelOfDetail` attribute is not emitted by IBKR at all** (not "SUMMARY", just absent). Confirmed Summary-level by empty `openDateTime` on all rows.

6. **Bond mix confirmed: 7 Corp (AAPL, AMZN×2, BA, BCRED, META, NFLX) + 11 Govt (US Treasuries).** No munis.

7. **`ChangeInDividendAccruals` is richer than spec expected:** carries `fxRateToBase`, `assetCategory`, full identifier set, `fromAcct`, `toAcct`, `underlyingConid`. All 211/211 key fields non-empty.

8. **`CorporateActions` is present but empty** (0 events in YTD window). Section tag exists — not missing.

9. **Trades section confirmed:** OPT=330, STK=45, BOND=6, CASH=2. Existing options pipeline unaffected.

### Spec §8 open questions resolved:
- **Q1 (trades sync):** Trades present — existing sync unaffected.
- **Q2 (bond mix):** 7 Corp + 11 Govt Treasuries. No munis.
- **Q3 (foreign WHT):** Answered NO by Jony's tax directive. WHT stored verbatim (585 rows in CT).
- **Q4 (tax-lot dates):** Summary-level confirmed — first-buy dates unavailable.
- **Q5 (PortfolioAnalyst for bonds):** Yes, needed for `creditRating`, `yieldToMaturity`. Symbol-string parsing covers coupon + maturity for v1.

### Portal changes Jony must make:
1. Enable `FinancialInstrumentInformation` section
2. Enable `accruedInterest` on OpenPositions
3. Enable `assetCategory` + `fxRateToBase` on CashTransactions
4. Switch daily scope: YTD → Last Business Day after portal changes done

### What's ready to ingest now (before portal fixes):
- STK positions (all fields present) ✅
- ChangeInDividendAccruals + OpenDividendAccruals (all fields present) ✅

📌 **Team update (2026-05-09T23:53:57+03:00):** Validated OptionsIncomeDashboard_Master.xml against spec. Stocks + dividend accruals ready to ingest. 4 portal fixes needed (FII section, accruedInterest, assetCategory+fxRateToBase on CashTransactions, LBD scope). Key discovery: OpenPositions already carries FII identifier fields inline — FII section is needed only for structured bond maturity/issueDate.

---
