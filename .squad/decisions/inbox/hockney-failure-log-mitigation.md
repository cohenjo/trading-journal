# Persistent Failure Log for Backfill Script

**Date:** 2026-05-06
**Author:** Hockney (Backend Dev)
**Status:** Shipped (commit 50d71ee)

## Context

Phase A added `--continue-on-error` to the options backfill script with a transient stderr summary of failed chunks. McManus's data-integrity review flagged this as a gap: once the terminal session closes, the operator loses visibility into which chunks failed.

## Decision

Added `.flex_backfill_failures.json` as a persistent failure log alongside the existing `.flex_backfill_state.json` checkpoint file. Key design choices:

1. **Separate concerns:** State file = success log, failures file = failure log
2. **Overwrite behavior:** Each run produces a fresh failure list (last run's failures)
3. **Lifecycle:** Write on failure, delete on success (file existence = "last run had failures" signal)
4. **Gating:** Only write when `--continue-on-error` is set AND at least one chunk failed; skip on dry-run

## Schema

```json
{
  "account_key": "U2515365",
  "run_started_at": "2026-05-06T16:37:12Z",
  "run_finished_at": "2026-05-06T17:42:08Z",
  "command_args": ["--start", "2024-06-01", "--end", "2024-12-31"],
  "failed_chunks": [
    {
      "chunk_key": "2024-09-01:2024-09-30",
      "window_start": "2024-09-01",
      "window_end": "2024-09-30",
      "error_type": "FlexProbeError",
      "error_message": "SendRequest failed...",
      "failed_at": "2026-05-06T17:08:42Z"
    }
  ]
}
```

Timestamps use ISO 8601 UTC (YYYY-MM-DDTHH:MM:SSZ format).

## Operational Impact

Stderr summary now includes:
- File path reference
- Retry guidance (resume contract)
- Inspection command (`cat .flex_backfill_failures.json | jq .`)

This enables future automation (cron jobs, monitoring scripts) to detect and act on gaps without parsing logs.

## Non-Goals

- Not extending the checkpoint file format (keep concerns separated)
- Not adding a DB-side ingestion audit table (McManus suggested; out of scope for Phase A)
- Not changing existing stderr format (only extended with file pointer)
