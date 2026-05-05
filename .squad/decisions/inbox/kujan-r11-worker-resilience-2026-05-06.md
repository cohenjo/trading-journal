# Kujan R11 — Worker Resilience: Healthcheck, Restart, and Backoff (TJ-027 / #80)

**Date:** 2026-05-06
**Author:** Kujan (DevOps/Platform)
**Issue:** #80 (Wave 3 — hosting-migration-sequencing)
**Blocks:** #82 (alerting & monitoring)
**Branch:** squad/80-worker-docker-healthcheck

---

## Decision: CLI-based Docker healthcheck (not HTTP)

The compute worker is a polling process — it has no HTTP server and no port binding.
We therefore use `python -m app.worker.healthcheck` as the `HEALTHCHECK CMD` rather than
a `curl` probe. This is the correct choice for any non-HTTP daemon.

The healthcheck checks:
1. Heartbeat file freshness (`WORKER_HEARTBEAT_FILE`, default `/app/worker_heartbeat`)
   — the runtime writes the file every 30 s, and the probe fails if it is > 120 s stale.
2. `DATABASE_URL` is set in the environment.

Rationale: checking the heartbeat proves the main loop is running. A DB ping on every
healthcheck would add unnecessary load and false negatives on transient network blips.
The `_CHECK_DB=true` env var enables a live DB ping if needed.

---

## Decision: MAX_ATTEMPTS raised to 5

The previous hard limit was 3 attempts. Issue #80 specifies a 5-attempt retry budget.
The backoff schedule (1 s / 2 s / 4 s / 8 s → permanent fail) gives jobs a reasonable
window to recover from transient Supabase connectivity or handler errors without
spinning the queue indefinitely.

The `compute_jobs.attempts` CHECK constraint is updated via migration
`20260506000001_compute_jobs_backoff.sql`.

---

## Decision: Exponential backoff via `next_retry_at` column

Rather than sleeping in the worker process (which would block the APScheduler thread),
we persist the earliest retry time in the `compute_jobs.next_retry_at` column.
The claim query filters `next_retry_at IS NULL OR next_retry_at <= now()`.
This is idempotent — multiple worker instances respect the backoff without coordination.

The `backoff_interval_sql(next_attempts)` helper in `app/worker/retry.py` returns a
Postgres interval string (`'1 seconds'`, `'2 seconds'`, etc.) that is embedded directly
in the UPDATE SQL via an f-string (not a parameter, since SQLAlchemy doesn't support
dynamic interval expressions as bind values).

---

## Decision: Stuck-job recovery at poll start

`_reclaim_stale_running_jobs()` runs at the top of every `poll_once()` call.
Any job in `running` state for more than 10 minutes is reset to `pending` with
`next_retry_at = now()` (immediate retry). This handles:
- Abrupt container crashes mid-job
- SIGKILL before the job could record failure
- Network partition between worker and DB during the commit

The 10-minute threshold is conservative — real jobs should complete in < 2 minutes.

---

## Follow-ups

- **#82** — alerting when jobs hit permanent failure or the queue depth spikes
- **#79** — production orchestrator (Nomad / ECS) may supersede the compose-based restart policy
- Consider adding `HEALTHCHECK_STALE_SECONDS` tuning guidance to the ops runbook once
  production patterns are established.
