---
name: broker-data-worker-pattern
description: >
  Pattern for building background workers that pull market data from external
  sources (Yahoo Finance, IBKR, etc.) and upsert into a PostgreSQL table.
  Covers exchange detection, fault isolation, DB patterns, and APScheduler integration.
tags: [backend, worker, yfinance, apscheduler, tase, lse, market-data]
---

# Broker Data Worker Pattern

## Overview

Pattern for writing a background job in `apps/backend/app/worker/` that:
- Fetches prices from Yahoo Finance (or other sources)
- Resolves broker-native tickers to Yahoo tickers
- Upserts results into a Postgres table
- Integrates with the existing APScheduler/runtime framework

## Key conventions

### 1. Side-effect module import pattern (matches existing workers)

```python
# In your_worker.py — append to JOB_SCHEDULES at import time
from app.worker.registry import JOB_SCHEDULES, JobSchedule

if not any(s.job_id == MY_JOB_ID for s in JOB_SCHEDULES):
    JOB_SCHEDULES.append(JobSchedule(
        job_id=MY_JOB_ID,
        kind="cron",
        cron_expr=os.getenv("MY_CRON", "0 22 * * MON-FRI"),
        handler=_run_job,
    ))
```

```python
# In runtime.py — add the import
from app.worker import your_worker as _your_worker  # noqa: F401
```

### 2. Exchange → Yahoo ticker resolution

Exchange detection priority:
1. `listing_exchange` if not NULL → direct mapping
2. Currency fallback when `listing_exchange` is NULL (Leumi IRA import pattern)

```python
_EXCHANGE_SUFFIX = {"IBIS": ".DE", "SBF": ".PA", "LSE": ".L", "AEB": ".AS"}
_USD_EXCHANGES = {"NYSE", "NASDAQ", "ARCA", "PINK", "BATS"}

def resolve_yahoo_ticker(ticker, currency, listing_exchange, tase_map=None):
    exch = (listing_exchange or "").upper()
    curr = (currency or "USD").upper()
    if exch in _EXCHANGE_SUFFIX: return ticker + _EXCHANGE_SUFFIX[exch]
    if exch in _USD_EXCHANGES: return ticker
    if exch == "":
        if curr == "USD": return ticker
        if curr == "GBP": return ticker.rstrip("/").strip() + ".L"
        if curr in ("ILA", "ILS"):
            return (tase_map or {}).get(ticker.strip()) or None  # WARN + skip if missing
    return None  # unknown → log WARN, skip
```

### 3. TASE override map

Store in DB table `tase_yahoo_map(tase_paper PK, yahoo_ticker, notes, added_at)`.
Load once at job start: `session.execute(text("SELECT tase_paper, yahoo_ticker FROM tase_yahoo_map")).all()`.
Allows ops to add new mappings without code changes.

### 4. Raw SQL with SQLAlchemy text()

Use `session.execute(text(...), params_dict)`, NOT `session.exec(text(...), params_dict)`.
Use `CAST(:id AS UUID)` NOT `:id::uuid` — the `::` conflicts with SQLAlchemy's `:`-param syntax.

```python
session.execute(
    text("UPDATE tbl SET col = :val WHERE id = CAST(:id AS UUID)"),
    {"val": str(value), "id": str(row_id)},
)
```

### 5. Fault isolation

Every row's upsert must be independent:
```python
try:
    _upsert_position(session, ...)
    session.commit()
    successes += 1
except Exception:  # noqa: BLE001
    session.rollback()
    failures += 1
    logger.exception("DB upsert failed for %s", ticker)
```

The job entry point must swallow all exceptions:
```python
def _run_job():
    try:
        refresh_all()
    except Exception:  # noqa: BLE001
        logger.exception("Job raised unexpected exception")
```

### 6. yfinance call

```python
import yfinance as yf
ticker = yf.Ticker(yahoo_ticker)
hist = ticker.history(period="5d")
price = Decimal(str(float(hist["Close"].dropna().iloc[-1])))
div_yield = ticker.info.get("trailingAnnualDividendYield")
```

Add 200ms sleep between calls. Retry x3 with exponential backoff on HTTP 429.

### 7. TASE price normalization note

Yahoo Finance returns TASE prices in ILA (agorot = 1/100 ILS), which is the native TASE exchange unit. When storing Yahoo-fetched TASE prices, document whether you're storing agorot (ILA) or shekels (ILS) and be consistent with the `currency` column.

## CLI entrypoint

Always provide a `--run-once` CLI:
```python
# python -m app.worker.your_worker_cli --run-once
from app.worker.your_worker import refresh_all
result = refresh_all()
print(result)
```

## References

- `apps/backend/app/worker/yahoo_refresh.py` — full implementation
- `apps/backend/app/worker/ndx_daily_sync.py` — canonical side-effect registration pattern
- `apps/backend/app/worker/registry.py` — JOB_SCHEDULES, JobSchedule dataclass
- `apps/backend/app/worker/scheduler.py` — APScheduler singleton + register helpers
