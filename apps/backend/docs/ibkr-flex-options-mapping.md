# IBKR Flex Query — Options Income Field Mapping

**Phase 0 verification · Issue #245 · Author: Hockney (Backend Dev)**
**Date:** 2026-05-05
**Parser:** `apps/backend/app/services/options/flex_parser.py`

---

## 1. Parser Location

| Artefact | Path |
|---|---|
| Main parser | `apps/backend/app/services/options/flex_parser.py` |
| Probe CLI | `apps/backend/scripts/flex_probe.py` |
| Synthetic fixtures | `apps/backend/scripts/flex_synthetic.py` |
| Unit tests | `apps/backend/tests/services/options/test_flex_parser.py` |
| Env vars | `.env.example` (`IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID_*`) |

The parser supports five Flex sections: **TradeConfirms**, **Trades**, **CashTransactions**,
**OpenPositions**, and **OptionEAE**. `TradeConfirms` (activity-statement format) and `Trades`
(default format) are treated identically.

---

## 2. Field-by-Field Mapping

### 2a. TradeConfirms / Trades — OPT rows

`assetCategory == "OPT"` filter is applied by `_is_option_contract_row()`. Fallback check
also accepts rows that carry all three of `expiry`, `strike`, and `putCall` (handles variants
where IBKR omits the category tag).

| IBKR Flex attribute | Parser reads? | Internal field | Notes |
|---|---|---|---|
| `accountId` | ✅ `_required_any` | `account_id` | |
| `currency` | ✅ `_currency` | `currency` / `leg.currency` | |
| `assetCategory` | ✅ filter only | — | Used for OPT filter; not stored separately |
| `symbol` | ✅ | `leg.option_symbol` | Full OCC symbol e.g. `SPY  260117P00450000` |
| `underlyingSymbol` | ✅ (primary) | `leg.underlying_symbol` | Preferred over `symbol` |
| `conid` / `conId` | ✅ optional | `leg.source_conid` | Both casings tried |
| `underlyingConid` | ❌ **NOT READ** | — | See Gap #1 |
| `putCall` | ✅ | `leg.right` (`put`/`call`) | Normalised from P/C/put/call |
| `strike` | ✅ | `leg.strike` | `Decimal` |
| `expiry` | ✅ | `leg.expiry` | Accepts `YYYYMMDD` and `YYYY-MM-DD` |
| `multiplier` | ✅ | `leg.multiplier` | Defaults to 100 if absent |
| `tradeID` | ✅ (primary) | `source_trade_id` | Falls back to `transactionID` |
| `transactionID` | ✅ fallback | `source_transaction_id` | |
| `ibExecID` | ✅ | `source_exec_id` | |
| `dateTime` | ✅ | `trade_time` | Handles `YYYYMMDD;HHMMSS` format |
| `tradeDate` | ✅ | `trade_date` | Falls back to `dateTime` date part |
| `buySell` | ✅ | `side` (`buy`/`sell`) | |
| `openCloseIndicator` | ✅ | `event_type` (`open`/`close`/`adjustment`) | |
| `tradePrice` / `price` | ✅ first-of | `price` | |
| `proceeds` | ✅ | `gross_amount` | |
| `commission` / `ibCommission` | ✅ first-of | `commission` | |
| `taxes` / `fees` | ✅ first-of | `fees` | |
| `netCash` | ✅ | `net_cash_flow` | Falls back to `proceeds` |
| `fifoPnlRealized` | ✅ | `realized_pnl` | Primary P&L source (per design doc §10) |
| `mtmPnl` | ✅ (assignment only) | synthetic cash amount | Used in `_synthetic_cash_from_stock_row` |
| `closePrice` | ✅ (assignment fallback) | synthetic cash fallback | Used when `mtmPnl` absent |
| **`notes`** | ❌ **NOT READ** | — | **See Gap #2** — carries assignment/exercise/expiration codes |
| `levelOfDetail` | ❌ **NOT READ** | — | **See Gap #3** — deduplication risk |
| `settleDateTarget` | ❌ not read | — | Minor; not required for Phase 1 |
| `ibOrderID` | ❌ not read | — | Order-level grouping; deferred |
| `openDateTime` | ❌ not read (Trades) | — | Present in OpenPositions only |
| `description` | stored in `raw_payload` | — | Full attribute dict always persisted |

### 2b. OptionEAE rows

| IBKR Flex attribute | Parser reads? | Notes |
|---|---|---|
| `accountId` | ✅ | |
| `symbol` | ✅ | |
| `underlyingSymbol` | ✅ | |
| `transactionType` | ✅ primary | Values: `Assignment`, `Exercise`, `Expiration` |
| `type` / `action` | ✅ fallbacks | Older schema variants |
| `tradeID` | ✅ | Used to cross-reference option trade row |
| `transactionID` | ✅ fallback | |
| `quantity` | ✅ | |
| `tradePrice` / `price` | ✅ first-of | |
| `proceeds` | ✅ | |
| `netCash` | ✅ | |
| `fifoPnlRealized` | ✅ | |
| `buySell` | ✅ | |
| `dateTime` | ✅ | |
| `reportDate` | ✅ fallback | |
| `currency` | ✅ | |
| `underlyingConid` | ❌ **NOT READ** | Gap #1 |
| `multiplier` | ❌ not in `_leg_from_attrs` path | Defaults to 100; acceptable for Phase 0 |
| `putCall` | ❌ absent in EAE rows (IBKR omits it) | EAE rows don't carry `putCall`; must join to Trade row |

### 2c. CashTransactions

| IBKR Flex attribute | Parser reads? | Notes |
|---|---|---|
| `accountId` | ✅ | |
| `transactionID` | ✅ primary | Falls back to `tradeID` |
| `tradeID` | ✅ fallback | |
| `date` / `reportDate` / `dateTime` | ✅ first-of | |
| `type` | ✅ (category heuristic) | IBKR values: `Dividends`, `Other Fees`, `Trades`, `Broker Interest Paid`, `Withholding Tax` |
| `description` | ✅ | Used in category heuristic |
| `amount` | ✅ primary | |
| `netCash` | ✅ fallback | |
| `currency` | ✅ | |
| `assetCategory` | ❌ not filtered | All cash rows ingested (intentional) |
| `conid` | ❌ not read | |

> **Premium received** for short option trades does **not** appear as a separate
> `CashTransactions` row — it flows through the Trades section as `proceeds`/`netCash`
> and is captured there. Cash rows are only supplementary (commissions, interest, etc.).

### 2d. OpenPositions

| IBKR Flex attribute | Parser reads? | Notes |
|---|---|---|
| `accountId` | ✅ | |
| `assetCategory` | ✅ filter | OPT only |
| `symbol` | ✅ | |
| `underlyingSymbol` | ✅ | |
| `conid` / `conId` | ✅ | |
| `putCall` | ✅ | |
| `strike` | ✅ | |
| `expiry` | ✅ | |
| `multiplier` | ✅ | |
| `position` / `quantity` | ✅ first-of | |
| `costPrice` / `avgCost` / `costBasisPrice` | ✅ first-of | `average_open_price` |
| `costBasis` / `openCashFlow` / `costBasisMoney` | ✅ first-of | `open_cash_flow` |
| `marginRequirement` | ✅ optional | |
| `dateTime` | ✅ | Used for `opened_at` / `last_broker_sync_at` |
| `openDateTime` | ❌ **NOT READ** | **See Gap #4** — IBKR's canonical "when opened" timestamp |
| `currency` | ✅ | |
| `underlyingConid` | ❌ not read | Gap #1 |

---

## 3. Identified Gaps

### Gap #1 — `underlyingConid` not read (low priority)

IBKR emits `underlyingConid` alongside `underlyingSymbol`. For symbol-only matching the
current approach is sufficient. `underlyingConid` enables unambiguous conid-based joins
when the same underlying trades under different symbols (e.g., class change, ticker
rename). **Recommended for Phase 2** as an optional enrichment field.

### Gap #2 — `notes` field not parsed ⚠️ **Medium priority**

IBKR's `notes` attribute on Trade rows carries semicolon-separated action codes:

| Code | Meaning |
|---|---|
| `O` | Opening transaction |
| `C` | Closing transaction |
| `A` | Assigned |
| `Ex` | Exercised |
| `Ep` | Expired |
| `P` | Partial execution |
| `ML` | Part of a multi-leg order |
| `Ca` | Cancelled |

Example IBKR output: `notes="A;C"` on the option Trade row when a short put is assigned.

The parser currently derives open/close from `openCloseIndicator` (correct for normal
trades) and lifecycle type from `OptionEAE.transactionType` (correct for EAE events).
The `notes` attribute is an **additional, redundant confirmation** on the Trade row itself
and would allow detecting assignment/exercise directly from the Trades section without
requiring a cross-section join.

> **See #265 for the assignment-pairing strategy** (McManus). Phase 1 of that ticket
> should consume `notes` to confirm pairing. The current parser stores all raw attributes
> in `raw_payload`, so `notes` is **already accessible** without code changes — it just
> isn't surfaced as a typed field.

**Recommendation:** Add `notes: str | None` to `FlexTradeConfirm` in Phase 1 and parse
it in `parse_trade_confirm`. No blocking issue for Phase 0.

### Gap #3 — `levelOfDetail` not filtered ⚠️ **Medium priority**

When a Flex query is configured with both `EXECUTION` and `ORDER` level detail, IBKR emits
duplicate rows. `levelOfDetail` distinguishes them:

- `EXECUTION` — one row per fill (preferred for our ingestion)
- `ORDER` — one aggregate row per order

The parser does **not** filter by `levelOfDetail`. If a user's Flex query returns both
levels, trade rows will be double-counted. Mitigation options:

1. **Filter in parser**: skip rows where `levelOfDetail == "ORDER"` (Phase 1 fix).
2. **Configure query**: set Flex query to return `EXECUTION` level only (document in
   `docs/options-income-dashboard-design.md` Phase 0 deliverable checklist).

**Recommendation:** Document the Flex query configuration requirement now; add the parser
guard in Phase 1.

### Gap #4 — `openDateTime` not read in OpenPositions (low priority)

IBKR emits `openDateTime` as the canonical "when this position was opened" timestamp.
The parser uses `dateTime` (report/snapshot time) as a proxy for `opened_at`. For positions
opened on a prior day this will be slightly wrong (opened_at will reflect the report date,
not the actual open trade time).

**Recommendation:** Read `openDateTime` with fallback to `dateTime` in `parse_open_position`
(one-line fix for Phase 1).

---

## 4. Confirmed Correct Mappings

The following options-income-critical fields are **correctly mapped** in the current parser:

| Requirement | How satisfied |
|---|---|
| `assetCategory == "OPT"` filter | `_is_option_contract_row()` — exact match + fallback heuristic |
| Underlying symbol | `underlyingSymbol` → `symbol` fallback |
| Strike, expiry, put/call | Direct attribute reads; right normalised P/C → put/call |
| Multiplier | Read; defaults to 100 |
| `fifoPnlRealized` as P&L source | Explicit field; primary P&L source per design doc |
| Assignment lifecycle detection | `OptionEAE.transactionType` in `{Assignment, Exercise}` |
| Expiration detection | `_event_type_from_lifecycle` detects "expir" in type string |
| Synthetic assignment cash event | Built from EAE + option Trade + STK Trade cross-join |
| Premium received | `proceeds` / `netCash` from option Trade row |
| Account filtering | `accountId` filter applied at parse time |
| `conid` pairing | Optional; stored as `leg.source_conid` |
| Multi-year / multi-account | Handled by `parse_flex_files(paths, account_id=None)` |

---

## 5. Sample XML Stub — Short Put Assignment Scenario

This stub illustrates the three rows IBKR emits for a short put assignment (synthesised
from public IBKR Flex Query documentation):

```xml
<FlexQueryResponse queryName="Trades" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567"
                   fromDate="2026-01-17" toDate="2026-01-17"
                   period="Custom" whenGenerated="20260117;161500">

      <TradeConfirms>
        <!-- OPT leg: short put assigned at expiry -->
        <TradeConfirm
          accountId="U1234567"
          assetCategory="OPT"
          currency="USD"
          symbol="SPY  260117P00450000"
          underlyingSymbol="SPY"
          conid="123456789"
          underlyingConid="756733"
          putCall="P"
          strike="450"
          expiry="2026-01-17"
          multiplier="100"
          tradeID="8869640563"
          transactionID="88696405630"
          ibExecID="0001f4e8.00a1b2c3"
          dateTime="2026-01-17;090000"
          tradeDate="2026-01-17"
          buySell="BUY"
          openCloseIndicator="C"
          notes="A;C"
          quantity="1"
          tradePrice="0"
          proceeds="0"
          ibCommission="0"
          taxes="0"
          netCash="0"
          fifoPnlRealized="400"
          levelOfDetail="EXECUTION"
        />

        <!-- STK leg: 100 shares delivered at strike price -->
        <TradeConfirm
          accountId="U1234567"
          assetCategory="STK"
          currency="USD"
          symbol="SPY"
          underlyingSymbol="SPY"
          conid="756733"
          tradeID="8869640568"
          transactionID="88696405680"
          dateTime="2026-01-17;090000"
          tradeDate="2026-01-17"
          buySell="BUY"
          openCloseIndicator="O"
          notes="A"
          quantity="100"
          tradePrice="450"
          closePrice="442"
          proceeds="-45000"
          ibCommission="0"
          netCash="-45000"
          fifoPnlRealized="0"
          mtmPnl="-800"
          levelOfDetail="EXECUTION"
        />
      </TradeConfirms>

      <OptionEAE>
        <!-- EAE row: links OPT tradeID to lifecycle event -->
        <OptionEAE
          accountId="U1234567"
          currency="USD"
          symbol="SPY  260117P00450000"
          underlyingSymbol="SPY"
          conid="123456789"
          underlyingConid="756733"
          putCall="P"
          strike="450"
          expiry="2026-01-17"
          multiplier="100"
          transactionType="Assignment"
          tradeID="8869640563"
          quantity="1"
          tradePrice="0"
          proceeds="0"
          netCash="0"
          fifoPnlRealized="400"
          reportDate="2026-01-17"
          dateTime="2026-01-17;090000"
        />
      </OptionEAE>

    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
```

**What the parser produces from this stub:**

1. `parsed.trades[0]` — OPT `TradeConfirm`, `realized_pnl = 400`, `event_type = "close"`,
   `side = "buy"` (assignment buy-back).
2. `parsed.option_eae[0]` — EAE row as `FlexTradeConfirm`, `event_type = "assign"`.
3. `parsed.cash_transactions[0]` — synthetic assignment cash event,
   `amount = -800` (from `mtmPnl` on STK row), `event_category = "assignment_synthetic"`.

**Note on `notes="A;C"`:** The parser stores this in `raw_payload["notes"]` but does not
parse it into a typed field (Gap #2 above). Phase 1 should surface it.

---

## 6. Recommendations for Phase 1

| Priority | Action | Gap |
|---|---|---|
| **High** | Filter `levelOfDetail == "ORDER"` rows in parser, or document Flex query must be configured for EXECUTION only | Gap #3 |
| **Medium** | Add `notes: str \| None` to `FlexTradeConfirm`; parse raw `notes` attribute | Gap #2 |
| **Medium** | Use `openDateTime` (with `dateTime` fallback) for `FlexOpenPosition.opened_at` | Gap #4 |
| **Low** | Store `underlyingConid` in `OptionLegKey` as optional field | Gap #1 |
| **Low** | Add `settleDateTarget` to `FlexTradeConfirm` for settlement-date tracking | — |
| **Low** | Add `ibOrderID` for order-level grouping analytics | — |

**Coordination:** See **#265** for the assignment-pairing strategy (McManus). Gap #2
(`notes` codes) directly feeds into that work — the field is already preserved in
`raw_payload` so McManus can reference it without a parser change, but a typed field
would be cleaner.

---

## 8. Bug Fixed During Phase 0

**`parse_option_eae` ignored `transactionType` when deriving `event_type`.**

`parse_option_eae` called `_event_type_from_lifecycle(attrs.get("type") or attrs.get("action"))`.
The canonical OptionEAE field is `transactionType` (not `type` or `action`), so EAE rows with
`transactionType="Assignment"` were being classified as `"adjustment"` instead of `"assign"`.

**Fix (committed with this PR):** added `transactionType` as the primary lookup:

```python
# before
event_type = _event_type_from_lifecycle(attrs.get("type") or attrs.get("action"))

# after
event_type = _event_type_from_lifecycle(
    attrs.get("transactionType") or attrs.get("type") or attrs.get("action")
)
```

The `type`/`action` fallbacks are retained for schema variants. All 8 existing tests pass.


## 9. Phase 0 Verdict

**The parser is correct for core options-income ingestion.** All business-critical fields
(`underlyingSymbol`, `strike`, `expiry`, `putCall`, `multiplier`, `fifoPnlRealized`,
`proceeds`, `netCash`, `transactionType` for EAE) are correctly read. The assignment
synthetic cash event logic is sound and has test coverage.

The three gaps above are **not blockers** for Phase 1 schema definition:

- Gap #1 (`underlyingConid`) — symbol-based matching is sufficient
- Gap #2 (`notes`) — `raw_payload` preserves the value; typed field can wait
- Gap #3 (`levelOfDetail`) — addressable by Flex query configuration

Schema commit for `options_legs`, `options_trades`, `options_cash_events` can proceed.
