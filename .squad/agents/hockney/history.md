## 2026-05-12 — Dividend accuracy + Leumi IRA + chore-PR triage sprint

**Sprint by:** Jony Vesterman Cohen

### Issues opened

#406 (dividend accuracy), #407 (Leumi IRA 100× unit), #408 (income summary), #409 (estimations).

### PR #410 — Yahoo worker TASE market_value fix (`691b36d`)

`yahoo_refresh.py`: TASE `market_value` now divided by 100 at compute time (ILA agorot → ILS). `mark_price` unchanged (stays in native ILA). DB self-corrects on next daily 22:00 UTC run. +2 tests in `TestTaseCurrencyNormalization`; 621 backend tests pass. Issue #407 partially addressed.

### PR #413 — dividend_yield canonical decimal storage (`d1538a7`)

Migration `20260511230000`: converted 53 percentage-format `dividend_yield` rows (`/100`). Worker now normalises at write-time (`if raw_float > 1: raw_float /= 100`). Fenster's read-time heuristic from PR #411 removed. Post-migration: 0 rows >1; 281 rows in [0,1].

**Decision:** Canonical format is decimal fraction `[0,1]`. Yahoo `trailingAnnualDividendYield` preferred; `dividendYield` fallback guarded at write time.

### PR #414 — Leumi XLS parser ILA tag + ILS market_value (`ff77079`)

Leumi parser tags TASE rows `currency='ILA'`; computes `market_value` in ILS (÷100) at parse time. Two migrations (`20260512000000`, `20260512000001`) re-tag and correct existing Path A rows. Account 72 TASE total: **1,181,114 ILS** (target 1.23M–1.34M). Issue #407 closed.

### Worker contract finalised

- `mark_price`: native broker/Yahoo unit (ILA for TASE, GBp for LSE — GBp NOT yet fixed)
- `market_value` / `market_value_local`: converted to settlement currency (ILS for TASE) at both worker and parser time
- `dividend_yield`: canonical decimal fraction `[0,1]` at all write paths

### Worker verification

`docker exec trading_journal_backend_supabase uv run python -m app.worker.yahoo_refresh_cli` — 297/321 refreshed, 17 skipped, 7 failed (delisted). ✅

### 2026-05-12 23:30 — PR #417 (XFLT yield enforcement + worker rebuild + CHECK constraint)

Container rebuild root-causes the regression: `trading_journal_backend_supabase` was running pre-PR-#413 stale code; stale worker overwrote migrated `0.1406` back to `14.06` on every daily run. Fix: rebuild with `--no-cache` (image SHA `33fd12cab77e`), patch 3 XFLT DB rows, run post-rebuild refresh (297 refreshed; XFLT = `0.140600` ✅). CHECK constraint `chk_dividend_yield_decimal` (`dividend_yield BETWEEN 0 AND 1`) added via migration `20260512010000_enforce_dividend_yield_decimal.sql` to prevent silent recurrence. 622/622 backend tests passing.

## 2026-05-12 09:50 — PR #420 (non-US yield + LSE pence) — Round 5

**Issue:** #415 (follow-up). User reported dividend yields + IRA market values 100× off for non-US positions.

**Root cause:** Yahoo's `dividendYield` / `trailingAnnualDividendYield` scale differently per currency: GBp/ILA return `rate_major / price_subunit` (100× too small). Worker's `> 1: /100` guard only caught US percentage format.

**Fix:**
1. Worker yield extraction split per currency: GBp/ILA use deterministic `dividendRate × 100 / previousClose` ratio (unit-free); USD unchanged.
2. LSE pence normalisation: `currency='GBP'` + `yahoo_ticker LIKE '%.L'` → `market_value /= 100` at worker write-time.
3. Migration `20260512090000`: Correct 8 LSE market_values; null 15 GBP+ILA yields < 0.001.
4. Outlier 1150283 (49% yield) → NULL.

**Verification (account 72 post-fix):** ILA 18 positions ₪1,181,114 total (₪14,281 divs), GBP 8 positions £52,878 total (£2,020 divs), USD 4 positions $67,607 total ($5,594 divs). Grand total ≈$465k USD ✓ (user expected ~$460k). Sample yields all plausible: BARC 2.07%, LGEN 8.75%, MNG 6.94%, RIO 3.89%, LUMI 4.42%, POLI 3.73%, MTAV 1.77%.

**Tests:** 45 pass (+8 new). 0 rows with dividend_yield > 1.

**Learnings:**
- **Never trust a single upstream yield field across regions.** Compute deterministically from rate/price when both available.
- **Currency labels ≠ unit contracts.** LSE GBP = mark_price in pence, market_value in pounds. TASE ILA = mark_price in agorot, market_value in shekels. Enforce at write-time layer.
- **CHECK constraints as defense-in-depth.** `dividend_yield BETWEEN 0 AND 1` prevents silent corruption by stale worker on next run.
- **Deterministic ratio over upstream aggregate.** `rate × 100 / price` is unit-free and survives currency/unit conversions. Upstream `trailingAnnualDividendYield` carries hidden assumptions.

## 2026-05-11 — PR #401 (Idempotent supabase_realtime Publication)

**Issue:** #397 — Migration CI/shadow DB compatibility

**Problem:** Migration `20260509180919_add_stock_positions.sql` used bare `ALTER PUBLICATION supabase_realtime ...` which fails with `ERROR: publication "supabase_realtime" does not exist` on fresh Postgres (shadow DB in CI). The publication is auto-created only on real Supabase projects at initialization.

**Fix:** Wrapped bare statement in DO block with exception handlers:
```sql
do $$
begin
  alter publication supabase_realtime add table public.stock_positions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
```

**Key learning:** All migrations referencing `supabase_realtime` MUST use the DO block pattern. This pattern is already used in other migrations (`20260503161310`, `20260503162842`, etc.); made it universal.

**Worker status:** Round 5 yield + Round 5 LSE/100 fixes now shipping correctly in production DB. UI surfaces (frontend display-layer fixes) are catching up (Round 7 dividend display).
