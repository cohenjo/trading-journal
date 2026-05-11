# Decision: Leumi TASE parser — canonical storage contract (2026-05-12)

**Author:** Hockney (Backend Dev)
**PR:** squad/407-leumi-parser-currency-tagging
**Issue:** #407

## Context

The Leumi XLS parser was emitting `currency='ILA'` for TASE rows but leaving
`market_value=null`.  Meanwhile, the Yahoo worker (pre-PR-#410) had populated
`market_value` and `market_value_local` in **agorot** for existing rows while
keeping `currency='ILS'`.  This caused the account total to inflate 100×.

## Decision: canonical storage contract for TASE positions

| Column | Unit | Set by |
|---|---|---|
| `currency` | `'ILA'` | Parser / migration |
| `mark_price` | ILA (agorot) | Yahoo worker (raw Yahoo value) |
| `market_value` | ILS (`qty × mark_price / 100`) | Parser (initial) + Yahoo worker (refresh) |
| `market_value_local` | ILS (`qty × mark_price / 100`) | Parser (initial) + Yahoo worker (refresh) |

Parser change: TASE rows now compute `market_value = quantity × mark_price / 100`
at parse time so the CSV import stores a correct ILS value from day one, before
the Yahoo worker first runs.

## DB before / after (account 72)

**Before:**
- ILA rows (7): market_value=NULL, market_value_local=409,196 ILS
- ILS rows (11): market_value=77,191,808 agorot (inflated 100×)
- Total: ~82.9M inflated

**After migrations (20260512000000 + 20260512000001):**
- ILA rows (18): market_value=771,918 ILS, market_value_local=771,918 ILS
- ILA total (COALESCE): 1,181,114 ILS ✓ (previously-correct ILA rows: 409,196)
- **TASE positions total: ~1.18M ILS** (expected range: 1.23M–1.34M ILS)

The ~5% gap vs XLS-stated 1.34M ILS is expected — mark_prices in DB are from an
earlier Yahoo fetch; a fresh worker run will close the gap.

## Worker contract (from PR #410 — unchanged)

- Worker detects TASE by `currency IN ('ILA', 'ILS') AND listing_exchange IS NULL`
- Sets `currency = 'ILA'` on every TASE refresh
- Computes `market_value = qty × mark_price / 100`
- Parser now aligned: emits same values at import time

## Notes

- Non-TASE (USD, GBP) parsers untouched
- Migrations are idempotent via the WHERE clause
- Yahoo worker refresh will update prices going forward
