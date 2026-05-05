# Hockney R2 — IBKR Flex Query field mapping verification — 2026-05-05

## Findings

- **Parser location:** `apps/backend/app/services/options/flex_parser.py`
- **Probe CLI:** `apps/backend/scripts/flex_probe.py`
- **Synthetic fixtures:** `apps/backend/scripts/flex_synthetic.py`

### Fields verified correct

All business-critical options-income fields are correctly mapped:
`underlyingSymbol`, `strike`, `expiry`, `putCall`, `multiplier`,
`fifoPnlRealized`, `proceeds`, `netCash`, `commission`, `ibCommission`,
`buySell`, `openCloseIndicator`, `tradeID`, `transactionID`, `ibExecID`,
`conid`, `assetCategory` (OPT filter), `dateTime`, `tradeDate`,
`OptionEAE.transactionType` (Assignment/Exercise/Expiration).

The synthetic assignment cash event logic (cross-join of OptionEAE + OPT Trade + STK Trade)
is working correctly.

### Bug fixed

`parse_option_eae` was reading `type`/`action` but NOT `transactionType` when deriving
`event_type`. OptionEAE rows use `transactionType`, so assignments/exercises were
classified as `"adjustment"`. Fixed: `transactionType` is now the primary lookup
with `type`/`action` as fallbacks.

### Mismatches / gaps

| ID | Field | Priority | Status |
|----|-------|----------|--------|
| Gap #1 | `underlyingConid` not stored | Low | Non-blocking; defer to Phase 2 |
| Gap #2 | `notes` codes not parsed as typed field | Medium | Value already in `raw_payload`; surface in Phase 1 |
| Gap #3 | `levelOfDetail` not filtered | Medium | Document Flex query config requirement; add guard in Phase 1 |
| Gap #4 | `openDateTime` not used for `opened_at` | Low | `dateTime` proxy is acceptable for Phase 0 |

## Recommendation for Phase 1

1. **High:** Document/enforce that Flex queries must return `EXECUTION` level only, OR add
   `levelOfDetail == "ORDER"` filter in `parse_flex_files` to prevent double-counting.
2. **Medium:** Add `notes: str | None` to `FlexTradeConfirm` and parse the raw `notes`
   attribute in `parse_trade_confirm`. This surfaces A/C/Ex/Ep codes as a typed field.
3. **Medium:** Use `openDateTime` (with `dateTime` fallback) in `parse_open_position`
   for accurate `opened_at` timestamps.
4. **Low:** Add `underlyingConid` to `OptionLegKey` as an optional enrichment field.

Schema commit for `options_legs`, `options_trades`, `options_cash_events` can proceed.

## Coordination

- See **#265** for the assignment-pairing strategy (McManus). Gap #2 (`notes` codes)
  feeds directly into that work. The field is already preserved in `raw_payload` so
  McManus can reference `trade.raw_payload.get("notes")` without a parser change.
- Env vars for Flex queries are already scaffolded in `.env.example`.

## Artefacts

- `apps/backend/docs/ibkr-flex-options-mapping.md` — full field mapping table,
  identified gaps, sample assignment XML stub, Phase 1 recommendations
- `apps/backend/tests/services/options/test_flex_parser.py` — new
  `test_phase0_opt_fields_extracted_from_assignment_stub` validator
- `apps/backend/app/services/options/flex_parser.py` — bug fix for `parse_option_eae`
  `event_type` derivation (uses `transactionType` as primary key)
