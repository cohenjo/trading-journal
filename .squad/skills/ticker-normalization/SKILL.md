# Skill: Ticker Normalization Across Multi-Currency Broker Exports

## Summary

Reusable pattern for cleanly extracting canonical ticker symbols from broker
export files that may embed additional metadata (description, Hebrew name,
exchange suffix) in the same cell as the identifier.

**Established by:** Hockney (Backend Dev), 2026-05-11.

---

## Problem: Combined Identifier + Name Cells

Some broker exports (notably Leumi IRA SpreadsheetML) place both the security
identifier and the human-readable name in a **single cell**, separated by
whitespace. Example:

```
col 0 (מספר נייר): "1081843 מיטב השקעות"
```

If the parser uses the whole cell as the ticker/ID, it leaks the description
into the `symbol` field — breaking symbol lookup, DB deduplication, and UI
display.

**Rule:** Always extract **only the leading non-whitespace token** from the
identifier cell:

```typescript
const id = (rawCell?.trim() ?? '').split(/\s+/)[0];
```

This is safe for clean numeric cells AND contaminated combined cells.

---

## Pattern: Exchange + Symbol Derivation (Leumi TASE)

For TASE (Tel Aviv Stock Exchange) paper numbers, the `deriveExchange()`
function maps `tasePaperId → { symbol, exchange, currency }`:

| Paper number format         | Exchange | Symbol          | Currency |
|-----------------------------|----------|-----------------|----------|
| 8-digit starting with `6`  | US / LSE | Extracted from `(…) TICKER [LN]` | USD / GBP |
| All others                  | TASE     | The paper number itself | ILA      |

For the "6-prefix" foreign securities, the symbol is extracted from the **name
cell** (col 1), not from col 0. The pattern `\)\s+(.+)$` matches everything
after the last `)` in the name.

```typescript
// "(JPMORGAN EQUITY PREMIUM INCOME ETF) JEPI" → "JEPI"
const parenMatch = desc.match(/\)\s+(.+)$/);
const tickerPart = parenMatch?.[1].trim();
const lnMatch = tickerPart.match(/^(.+?)\s+LN$/);
// LN suffix → LSE; no suffix → US
```

---

## Currency Conventions

| Exchange | Price unit | DB currency | Notes |
|----------|-----------|-------------|-------|
| TASE     | ILA (agorot) | `ILA` | 1 ILS = 100 ILA |
| US       | USD | `USD` | |
| LSE      | GBP | `GBP` | |
| ILS-denominated values (market value, P&L) | ILS | Implicit in column name | Store as `market_value_local`, `unrealized_pnl` |

**Do not** store agorot prices as ILS — they differ by 100×.

---

## Fixture Fidelity Checklist

When creating a test fixture for a broker parser:

- [ ] Use the actual broker file (redacted), not a hand-crafted approximation
- [ ] Verify combined-cell format (id + name in same cell?)
- [ ] Verify all numeric columns are present (mark_price, market_value, unrealized_pnl, …)
- [ ] Preserve Hebrew strings verbatim for encoding regression tests
- [ ] Run LURVG with a real upload before closing the parser PR

---

## Files

- `apps/frontend/src/lib/trading/leumi-xls-parser.ts` — `deriveExchange()`, `parseLeumiIraXmlText()`
- `apps/frontend/src/lib/trading/leumi-xls-parser.test.ts` — ticker contamination regression suite
- Related: `.squad/skills/broker-import-validation/SKILL.md`
