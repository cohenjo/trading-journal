# Skill: Leumi IRA XLS Import (Hebrew Financial File Parsing)

## Summary

Pattern for parsing Hebrew-encoded financial Excel exports (SpreadsheetML XML) from Israeli brokers and resolving multi-exchange ticker symbols.

## Key Insights

### 1 — SpreadsheetML vs binary XLS

Israeli brokers (Leumi, Mizrahi, etc.) often export `.xls` files that are actually **SpreadsheetML XML**, not binary BIFF8. Check with `file` or by inspecting the first bytes:
- `<?xml version=` → SpreadsheetML (parse as text/XML)
- `\xD0\xCF\x11\xE0` → Binary BIFF8 (needs SheetJS/xlrd)

SpreadsheetML can be parsed with pure regex or DOMParser — no binary library needed.

### 2 — TASE paper number → exchange heuristic

TASE (Tel-Aviv Stock Exchange) paper numbers encode the security type:
- **6-digit**: Israeli blue-chip stocks
- **7-digit**: Israeli ETFs, mutual-fund umbrella funds
- **8-digit starting with 5**: Israeli mutual funds (open-ended)
- **8-digit starting with 6**: **Foreign securities** listed on TASE — US stocks have format `(description) TICKER`, LSE stocks have `(description) TICKER LN`

### 3 — Currency conventions

| Exchange | Currency | Notes |
|----------|----------|-------|
| TASE | ILA (Israeli Agorot) | 1/100 ILS; all TASE prices are in agorot |
| US (NYSE/NASDAQ) | USD | |
| LSE | GBP | Some sources quote in GBX (pence) — verify per broker |

### 4 — Hebrew round-trip in tests

Vitest (jsdom) handles Hebrew strings correctly. Assert with exact Hebrew literals in test expectations, e.g.:
```ts
expect(leumi.raw_description).toBe('לאומי');
```

Use `readFileSync(path, 'utf-8')` for fixtures — Node reads UTF-8 correctly.

### 5 — Multi-format ingest dispatch pattern

```
file extension?
  .csv  → existing CSV parser → backend
  .xls/.xlsx → SpreadsheetML check → Leumi parser → convert to CSV → backend
```

Dispatch in the component (client-side) keeps the server action unchanged.

## Reusable Functions

- `deriveExchange(description, tasePaperId)` — pure, testable exchange classification
- `parseLeumiDate(raw)` — DD.MM.YY → YYYY-MM-DD
- `extractRowsFromSpreadsheetML(xmlText)` — regex-based row/cell extraction
- `holdingsToCsv(holdings)` — converts ParsedHolding[] to CSV + unmappable list

## Location

```
apps/frontend/src/lib/trading/leumi-xls-parser.ts
apps/frontend/src/lib/trading/leumi-xls-parser.test.ts
apps/frontend/src/lib/trading/__tests__/fixtures/leumi-ira-sample.xls  (redacted)
```

## Test Fixture Notes

- Create a **redacted** SpreadsheetML fixture: replace account number with `999-000000/00`, keep security identifiers and structure intact
- Include at least one holding of each type: TASE (Hebrew name), US (parenthesised ticker), LSE (ticker + LN suffix)
- Assert Hebrew string presence for encoding validation

## Edge Cases

- LSE tickers with trailing slash: `NG/ LN` → symbol `NG/` (normalize to `NG.L` at caller if needed)
- Dual-listed stocks: use a `TASE_TO_GLOBAL_MAP` keyed by paper number for manual overrides
- Rows with zero/negative quantity: skip
- Missing parenthesis on 8-digit-6 paper numbers: mark as `UNKNOWN` exchange
