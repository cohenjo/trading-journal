# Decision: IBKR Flex Backfill Resilience — Monthly Chunks, Better Polling, Checkpoint/Resume

**Author:** Hockney (Backend Dev)
**Date:** 2026-05-06
**Branch:** `squad/options-flex-backfill-resilience`
**Status:** Committed locally; push blocked (jocohe_microsoft = read-only on this repo)

---

## Context

Yossi ran `backfill_options.py --start 2024-06-01 --end 2024-12-31 --account U2515365` and hit two failures:
1. `GetStatement` timed out after 24 polls (120 s total) — IBKR needs 3-10 min for fat statements
2. Immediate retry returned persistent 1001 — the previous half-baked statement was still running on IBKR's side

---

## Decisions Made

### 1. Default chunk: 1 month (was 1 calendar year)

IBKR FLEX is happiest with ≤31-day windows for trade-heavy accounts. Monthly chunks keep
requests small enough that statement generation completes within the poll budget.
Flag: `--chunk-months N` (1 = monthly, 3 = quarterly, 12 = yearly legacy behaviour).

### 2. Poll budget: 60 × 10 s = 10 min (was 24 × 5 s = 2 min)

IBKR can take 3-8 minutes to generate a full-year statement. 10 min gives a safe margin
even for the largest monthly chunks on a trades-heavy account.

### 3. 1001 backoff: 60 s start + ±20% jitter, cap 600 s (was 15 s flat, cap 480 s)

After a half-baked statement times out, IBKR's backend typically needs 60-120 s to abort
the pending job. Starting retry backoff at 60 s avoids re-tripping immediately.
Jitter prevents thundering-herd if multiple query IDs fire in parallel.

### 4. Inter-chunk sleep: 45 s (configurable via `--chunk-sleep`)

Prevents consecutive `SendRequest` calls from being throttled when iterating through
months. Safe minimum; increase to 60 s if 1001s appear between chunks.

### 5. Checkpoint/resume: `.flex_backfill_state.json`

Keyed by `{account_id}:{start}:{end}` per chunk. Written after each successful DB commit.
On re-run, already-committed chunks are skipped — safe to re-run after any failure
without re-fetching or double-writing. Override with `--no-resume`.

---

## Files Changed

| File | Change |
|---|---|
| `apps/backend/scripts/backfill_options.py` | Monthly chunking, resume, inter-chunk sleep, new CLI flags |
| `apps/backend/scripts/flex_probe.py` | Better poll defaults, 60 s 1001 backoff + jitter |
| `apps/backend/app/worker/handlers/options_sync.py` | Thread poll_seconds/max_polls from caller |
| `apps/backend/tests/test_backfill_options.py` | 10 new tests, 3 updated |
| `apps/backend/tests/test_flex_send_request.py` | Updated 2 tests for new backoff defaults + jitter mock |

---

## References

- IBKR Flex Web Service Guide (error codes: 1001 = throttle/pending, 1019 = generating)
- IBKR documented 365-day max window; practical limit for trades-heavy accounts is ≤31 days

---

## Tonight's Command (for Yossi)

**Wait ≥10 minutes after the last 1001 before running.**

```bash
cd apps/backend
python scripts/backfill_options.py \
  --live \
  --start 2024-06-01 --end 2024-12-31 \
  --account U2515365 \
  --chunk-months 1 \
  --chunk-sleep 60 \
  --poll-seconds 10 --max-polls 60
```

If it fails mid-run, re-run the same command — completed months are checkpointed and skipped.
