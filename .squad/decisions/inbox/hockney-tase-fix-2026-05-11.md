# Decision: TASE Price Units and tase_yahoo_map Canonical Source
**From:** Hockney (Backend Dev)
**Date:** 2026-05-11
**Branch:** squad/yahoo-finance-worker-issue-395 (PR #400)

---

## Decision 1: TASE mark_price canonical unit is ILA (agorot)

**Context:** Yahoo Finance reports TASE prices with `info.currency == 'ILA'` (Israeli
agorot, 1/100 ILS). The Leumi XLS broker importer also stores TASE positions in agorot.
The original worker code incorrectly set `currency = 'ILS'` after writing Yahoo's ILA price.

**Decision:** All TASE `stock_positions` rows use **ILA** as the canonical currency unit.
`mark_price` is always in agorot. The `currency` column stores `'ILA'`. No conversion
(×100 or ÷100) is applied — Yahoo's raw value is stored directly.

**Evidence:**
```
LUMI.TA | info.currency: ILA | price: 7550.0   (Bank Leumi, 75.50 ILS)
POLI.TA | info.currency: ILA | price: 8051.0   (Bank Hapoalim)
MTAV.TA | info.currency: ILA | price: 15270.0  (Meitav Investments)
```
Bizportal confirms the same values in agorot (ש"ח = shekels, but displayed as agorot numbers).

---

## Decision 2: tase_yahoo_map must be verified against Bizportal per paper_id

**Context:** The original seed data in migration `a1b2c3d4e5f6` had completely wrong
paper_id → company assignments. All 11 entries were incorrect (the company names in the
notes did not match the actual companies with those paper IDs in `stock_positions`).

**Decision:** Before adding any TASE paper → Yahoo ticker mapping, verify the paper_id
against https://www.bizportal.co.il/capitalmarket/quote/shares/<paper_id>. The company
name shown on that page is authoritative.

**Corrected map (7 entries, 4 deleted):**

| tase_paper | Hebrew description | Company (EN)          | Yahoo ticker | Source         |
|------------|--------------------|-----------------------|--------------|----------------|
| 604611     | לאומי              | Bank Leumi            | LUMI.TA      | Bizportal ✅   |
| 662577     | פועלים             | Bank Hapoalim         | POLI.TA      | Bizportal ✅   |
| 1081843    | מיטב השקעות        | Meitav Investments    | MTAV.TA      | Bizportal + yf |
| 224014     | כלל עסקי ביטוח     | Clal Business Ins.    | CLIS.TA      | Bizportal + yf |
| 394015     | רציו יהש           | Ratio Energies        | RATI.TA      | Bizportal + yf |
| 475020     | ניו-מד אנרג יהש    | NewMed Energy         | NWMD.TA      | Bizportal + yf |
| 1098920    | ריט 1              | REIT 1                | RIT1.TA      | yf ✅          |

**Deleted:** 1145911 (Kasam ETF), 1146067 (Kasam ETF), 1150283 (MTF ETF), 1159169 (iShares ETF)
— these are index-tracking funds with no confirmed individual Yahoo ticker.

---

## Implication for future work

- Always use `ILA` for TASE positions in this system.
- When adding new TASE paper IDs to the map, verify via Bizportal first.
- ETF/index fund paper IDs should NOT be in `tase_yahoo_map` unless a Yahoo ticker
  is confirmed. They will be skipped gracefully with `WARN [no-yahoo-resolution]`.
