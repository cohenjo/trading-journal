## 2026-05-12 — Round 8 Phase 2.5: Worker Redeploy Skill + Rebuild Script

**Task:** Codify the Round 8 root cause as an enforced protocol to prevent recurrence.

**Problem:** The Docker worker container was never rebuilt after PR #420 merged. A stale image (`33fd12cab77e`, built 2026-05-11 pre-PR-#420) fired the daily 06:59 UTC refresh and silently overwrote migration `20260512090000`'s corrections. This single miss caused Rounds 5–8 (7 rounds, 4 reactive PRs).

**Deliverables:**
1. `scripts/rebuild-worker.sh` — POSIX shell, phases A–F (pre-flight → stop/rm → build --no-cache → deploy → verify → summary). Flags: `--force`, `--prune`, `--no-verify`, `--dry-run`, `--help`.
2. `.copilot/skills/worker-redeploy/SKILL.md` — coordinator playbook; auto-triggers on `apps/backend/app/worker/**` PRs; includes manual fallback, verification checklist, history table.
3. `.squad/skills/worker-redeploy/SKILL.md` — pointer to canonical version.
4. `.squad/agents/keaton/charter.md` — Worker redeploy gate section added (mandatory before merge).
5. `apps/backend/README.md` — "Rebuilding the worker" section inserted under Local development.
6. `.squad/decisions/inbox/hockney-round8-redeploy-skill-2026-05-12.md` — decision record.

**PR:** squad/round8-meta-worker-redeploy-skill → main
**Confirmed working:** smoke test `--help` and `--dry-run` pass; canonical compose file `docker-compose.backend.yml`, service `backend`, container `trading_journal_backend_supabase`.

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

## 2026-05-12 — Round 8 Phase 2: Container rebuild + SQL fallback + issue filing

**PR #425** — `fix(currency): Round 8 Phase 2 — worker rebuild + market_value sync migration`

**Root cause confirmed:** Docker container was running pre-PR-#420 code (image `33fd12cab77e`, built 2026-05-11 before PR #420 merged). Daily refresh at 06:59 UTC on 2026-05-12 re-inflated GBP market_values and re-shrank GBP+ILA yields after migration `20260512090000` had corrected them.

**Actions taken:**
1. Rebuilt container `--no-cache` → new image `f524b85d7383` (picks up d853426)
2. Triggered `refresh_stock_positions()`: 297 refreshed, 17 skipped, 7 failed (delisted)
3. Verified post-refresh: BARC MV=£8,897 ✅ (was £926k), RIO yield=3.78% ✅, LUMI yield=4.56% ✅
4. Migration `20260512170000`: `market_value = market_value_local` for 7 no-Yahoo TASE mutual funds
5. Cross-account bleed (QQQI 0.48% → 14%): `ttmIsTrustworthy` guard already in `actions.ts` from prior round — no change needed
6. Filed issue **#423**: Keaton's architectural migration (ILA→ILS, GBp÷100 at DB layer)

**Tests:** 625 backend ✅, 88 frontend (dividends) ✅

**Learnings:**
- Always rebuild container immediately after merging worker code PRs. The `docker inspect --format='{{.Created}}'` check is a fast sanity check.
- `ttmIsTrustworthy` guard (MIN_TTM_PAYMENTS=3) is the right defense for cross-account payment bleed until `dividend_payments.account_id` is properly wired through.

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

## 2026-05-13 — Plan persistence + cashflow sprint (Round 9, Issues #440 + #441)

Backend recon (sonnet-4.6): root-caused NOT NULL without defaults on plans.created_at / updated_at; confirmed migration 20260430130000 silent-skip of DEFAULT due to ADD COLUMN IF NOT EXISTS footgun. PR #442: `ALTER COLUMN SET DEFAULT now()` ×2 + trigger extended to BEFORE INSERT OR UPDATE. Decision: migration idempotency footgun pattern documented in `.squad/skills/migration-idempotency-gotchas/SKILL.md`. Verified Vercel green post-merge, no worker redeploy needed.
