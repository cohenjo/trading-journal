## 2026-05-11 — #408 & #409 Summary + Estimations Source Fix

**Issues:** #408 (/summary shows ~$80k instead of ~$9,200) and #409 (estimations disconnected from live holdings)

### Diagnosis

**#408:** `/summary/page.tsx` called `getDividendProjection()` (legacy FastAPI `/api/dividends/projection`)
after `getDividendDashboard()`. If the legacy endpoint returned `total_annual > 0`, it overrode the
correct ~$9,200 from `getDividendSummary()` with a stale ~$80k figure.

**#409:** `/dividends/estimations/page.tsx` projected forward from `lastHistorical.amount`
(user's last manually-entered year). No connection to live holdings — 2026 projected from old
baseline rather than current ~$9,200.

### Fix (PR #412, SHA 4250f88)

- `/summary/page.tsx`: Removed `getDividendDashboard()` + `getDividendProjection()`. Replaced with
  direct `getDividendSummary()` call. Removed `settings.mainCurrency` dep (unused after refactor).
- `/dividends/estimations/page.tsx`: Fetch `getDividendSummary()` alongside estimations on mount.
  Store `liveAnnualTotal`. In projection loop, anchor current year to live total unless user has
  manually entered it. Added info banner: "Current year anchor (from /dividends): $X,XXX · based on
  current holdings." Historical user-backfilled years preserved untouched.
- 627/627 tests pass. No new lint errors.

**Before:** /summary 2026 dividends ~$80,000; estimations 2026 grew from old baseline.
**After:** /summary 2026 dividends ~$9,200 (matches /dividends); estimations 2026 anchored to live total.

---

## 2026-05-11 — #406 Dividends Accuracy Fix

**Issue:** #406 — /dividends shows only ~3 Schwab positions (~$430/yr) instead of ~21 (~$9,200/yr)

### Diagnosis

`getDividendPositions()` filtered with `if (!hasTTM && !hasAccrual) continue` — only positions
with IBKR Flex payment history (`dividend_payments`) or `dividend_accruals` were shown. Schwab
CSV imports write to `stock_positions` only; 18 of 21 yielding Schwab positions were silently
dropped. Three tickers (ABR, BXMT, JPC) slipped through because IBKR also held them.

DB diagnostic: account 71 (Schwab) had 21 positions with `dividend_yield > 0` in `stock_positions`
but 0 TTM payments. Additionally found `dividend_yield` is stored in mixed format:
values > 1 are percentages (Yahoo Finance format); values ≤ 1 are decimal fractions.

### Fix (PR #411, SHA 34bf9f7)

- Added third parallel query: `stock_positions.dividend_yield` for the account.
- Expanded filter: `!hasTTM && !hasAccrual && !hasYield` (yield-only positions now qualify).
- Yield-only forward estimate: `mark_price × normalised_yield × quantity`; `source = 'csv'`.
- Normalisation at read-time: `raw > 1 ? raw / 100 : raw` (handles both storage formats).
- `DividendPositionsTable`: amber **est.** badge on Fwd Annual$ for `source='csv'` rows.
- +2 regression tests (percentage + decimal yield paths). 627/627 pass.

**Before:** 3 rows, ~$430/yr. **After:** 21 rows + est. badges; ~$9,200/yr once full.

---

## 2026-05-11 — #372 & #376 Batch Frontend Fixes

**Issues:** #372 (label htmlFor accessibility), #376 (LadderPage coupon test alignment)

### #372 — Label htmlFor accessibility on TradingAccountSettings

**Problem:** PR #371 LURVG found that `getByLabel('Account Type')` timed out in Playwright tests because the form label had no `htmlFor` attribute, preventing screen readers and test tools from associating the label with its form control.

**Fix:** Added `htmlFor`/`id` pairs to all 9 form labels in `TradingAccountSettings.tsx`:
- `account-name`, `account-type`, `linked-account` (always shown)
- `host`, `port`, `client-id` (IBKR-specific)
- `app-key`, `app-secret`, `account-hash` (Schwab/LeumiIRA)

**Impact:** Improves accessibility compliance and enables reliable Playwright label-based queries.

### #376 — LadderPage coupon test alignment

**Problem:** PR #373 introduced `displayCouponRate()` utility with default `decimals: 3`. Production renders 3-decimal coupons (e.g., "4.250%"), but the LadderPage test expected 2 decimals ("4.25%"), causing test failure (518/519 → 519/519).

**Fix:** Updated test expectation in `LadderPage.test.tsx` line 142: `"4.25%"` → `"4.250%"` to match production behavior.

**Rationale:** No need to modify `displayCouponRate` defaults (used elsewhere correctly); test alignment is the right fix.

**Tests:** All 519 tests pass ✅

**Commit:** `2ee7637` on `squad/372-376-fenster-batch` → PR #378.

---

## 2026-05-12 — #358 Extract displayCouponRate() utility


**Issue:** #358 "Bonds: extract displayCouponRate() utility to remove Bug-2 footgun"

**Root cause addressed:** Bug-2 (sprint #356) occurred because `coupon_rate` flows through two conventions: PERCENTAGE units in `bond_holdings` (DB-native, 4.25 = 4.25%) vs DECIMAL units in the `Bond` type used by Ladder components (normalised by `/100` in `actions.ts`). Inline `* 100` and `.toFixed(2)` calls were scattered across three files, making it easy to re-introduce the footgun.

**Fix:** Extracted `apps/frontend/src/lib/bonds/coupon-rate.ts`:
- `displayCouponRate(raw, { kind?, decimals? })` — formats coupon rate for display. Kind `'percentage'` (default, 3dp) or `'decimal'` (multiplies by 100 internally). Returns "—" for null/undefined/NaN/Infinity.
- `parseCouponRate(raw)` — parses unknown input to number | null; empty string → null.

**Call sites replaced:**
- `apps/frontend/src/app/holdings/page.tsx` (line 322): `{Number(h.coupon_rate).toFixed(3)}%` → `{displayCouponRate(h.coupon_rate)}`
- `apps/frontend/src/app/ladder/page.tsx` (line 258): `{(bond.coupon_rate * 100).toFixed(2)}%` → `{displayCouponRate(bond.coupon_rate, { kind: 'decimal' })}`
- `apps/frontend/src/components/Ladder/RungDetails.tsx` (line 220): same decimal-kind swap

**Tests:** 28 new unit tests in `src/lib/bonds/__tests__/coupon-rate.test.ts`. All 519 tests pass.

**Build:** ✅ Next.js build succeeds.

**Commit:** `9ea88a8` on `squad/358-coupon-rate-utility` → PR #373.

---



**Issue:** `/trading/accounts` showed duplicate rows for the same ticker — e.g. `ABR` appeared 4× with stale 2022/2023/2024 quantities. Root cause: `getStockPositions()` in `actions.ts` fetched **all** `stock_positions` rows ordered by ticker with no latest-snapshot filter. Flex imports store year-end snapshots (2022/2023/2024/2025) as separate rows, so 55 tickers × avg 3.4 snapshots ≈ 213 raw rows were rendered verbatim.

**Bypass-API antipattern identified:** The page server action queries Supabase directly instead of calling Hockney's FastAPI endpoint `GET /api/accounts/positions` (which already applies `DISTINCT ON`). This creates a dual query path that can silently diverge. Decision: fix the frontend data layer now (Option A), flag Option B (switch to API) as future consolidation work.

**Fix applied (Option A — TS-side dedupe):**
- Added `dedupeLatestSnapshot()` helper in `actions.ts`: iterates rows and keeps the entry with the **latest `as_of_date`** per `(account_id, ticker)` composite key, then re-sorts alphabetically by ticker.
- Applied at the end of `getStockPositions()` before returning — covers both `flex` and `manual` (Schwab/LeumiIRA) sources defensively.

**Before/after row count:** before ≈ 213 rows rendered → after: 55 unique rows (matches Hockney's API output).

**Multi-part verification applied:**
- 5 new unit tests in `actions.test.ts` (Vitest): ABR×4 dedup, total-count uniqueness, DBK passthrough, manual source dedup, alphabetical sort. All 377 tests green.
- Tests would FAIL on `main` before this fix.

**Commit:** `7e6bcfe` on `origin/main`.

**Pattern established — dedup key:**
```ts
const key = `${row.account_id}:${row.ticker}`;
if (!existing || row.as_of_date > existing.as_of_date) map.set(key, row);
```

**Future work:** Option B (route page through `GET /api/accounts/positions`) would eliminate the dual-path entirely — recommended when API consolidation is on the roadmap.

---
