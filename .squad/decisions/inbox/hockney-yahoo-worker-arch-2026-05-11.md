# Yahoo Finance Worker Architecture — 2026-05-11

**By:** Hockney (Backend Dev) via Copilot CLI
**Issue:** #395
**Date:** 2026-05-11

## Decisions

### 1. Scheduler: APScheduler (already present)
APScheduler was already a project dependency and used for all existing scheduled jobs (bonds_scanner, NDX sync, flex options sync). No new framework introduced. The yahoo_refresh module follows the `ndx_daily_sync` pattern: register with `JOB_SCHEDULES` via side-effect import, runtime.py imports it.

### 2. TASE override mapping: DB table `tase_yahoo_map`
Chose DB table over Python dict so ops can add overrides without code changes. Table schema: `tase_paper TEXT PK, yahoo_ticker TEXT NOT NULL, notes TEXT`. Seeded 11 known Israeli securities (LUMI.TA, MZTF.TA, POLI.TA, FTIN.TA, DSCT.TA, HARL.TA, MGDL.TA, PHOE.TA, ALHE.TA, AZRG.TA, JBNK.TA). Unknown TASE paper numbers log `WARN [no-yahoo-resolution]` and skip — worker never crashes on a single bad ticker.

### 3. ILS normalization for TASE prices
Yahoo Finance returns TASE stock prices in ILA (agorot = 1/100 ILS), which is the native TASE unit. However, per Jony's directive (see `.squad/decisions/inbox/copilot-directive-2026-05-11-1941.md`), when the worker updates TASE positions from Yahoo it sets `currency = 'ILS'` and stores the Yahoo price verbatim as `mark_price`. This means TASE `mark_price` values in the DB are now in agorot, labelled as ILS — consistent with how Yahoo reports them. **Redfoot should validate** that `mark_price` values for TASE positions look sane after one full run.

### 4. Exchange detection strategy (fallback by currency when listing_exchange is NULL)
Leumi IRA imports don't populate `listing_exchange`. Fallback:
- `currency = GBP` → LSE (append `.L`), remove trailing Bloomberg slash (`NG/` → `NG.L`)
- `currency in (ILA, ILS)` → TASE lookup in tase_yahoo_map
- `currency = USD` with no exchange → NYSE/NASDAQ verbatim
- `currency = EUR` with no exchange → `WARN [no-yahoo-resolution]` and skip (ambiguous: could be Xetra, Paris, Amsterdam)

### 5. Rate limiting & fault isolation
- 200ms sleep between every Yahoo call (constant)
- 3-attempt retry with exponential backoff on HTTP 429
- Each position's DB upsert is independent: `session.rollback()` per failure
- Worker never re-raises exceptions out of the scheduler job function

### 6. CLI `--run-once` entrypoint
`python -m app.worker.yahoo_refresh_cli --run-once` allows ad-hoc refreshes and CI/CD integration testing without waiting for cron.
