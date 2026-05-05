# Keaton R12 Decision Drop — PR Sweep (2026-05-05)

**Author:** Keaton (Lead/Architect)
**Round:** 12
**Date:** 2026-05-05

---

## Summary

Round 12 PR sweep: cleared 4 of 5 open PRs; 1 held for pattern violation. Filed 1 follow-up issue for deferred feature work.

---

## PRs Handled

### Group A — Decision Drops

| PR | Title | Scope check | Action |
|----|-------|-------------|--------|
| #312 | Hockney R11 decision drop (audit trail) | ✅ Only `inbox/hockney-r11-audit-trail-2026-05-05.md` | Squash-merged + branch deleted |
| #318 | Kujan R11 decision drop (worker resilience) | ✅ Only `inbox/kujan-r11-worker-resilience-2026-05-06.md` | Squash-merged + branch deleted |
| #316 | Keaton R11 decision drop | ⚠️ **SCOPE LEAK** — touches `.squad/decisions.md` directly, not inbox | Commented + held. Must be re-filed to inbox before merge. |

**Pattern reminder:** Decision drops must land in `.squad/decisions/inbox/<agent>-<slug>.md`. The Scribe consolidates into `decisions.md`. Direct edits to `decisions.md` in a PR are a scope violation (risk of clobbering concurrent Scribe commits).

---

### Group B — Feature PRs

#### PR #310 — Hockney — Household audit trail (#77) ✅ MERGED

**Review findings:**
- RLS: `SELECT` via `is_household_owner(household_id)` (owners-only, correct); no `INSERT` policy for auth/anon role + explicit `REVOKE` (service-role bypass only); `UPDATE`/`DELETE` both `USING (false)` — unconditionally blocked. Append-only at DB level. ✅
- Indexes: `(household_id, created_at DESC)`, `(user_id, created_at DESC)`, `(action, created_at DESC)` — all present. ✅
- FK: `ON DELETE CASCADE` for `household_id`; `ON DELETE SET NULL` for `actor_user_id` / `target_user_id` — audit rows survive user deletion. ✅
- 22/22 tests passing. ✅
- Helper `recordHouseholdEvent()` + 8 typed convenience wrappers — clean API for Fenster's #74 invite flow. ✅
- Deferred: `household_deleted` / `household_restored` — correctly held for soft-delete flow. Filed **#319** as follow-up (see below).

**Decision:** Merge approved. Squash-merged. Branch deleted.

#### PR #317 — Kujan — Worker Docker healthcheck/retry (#80) ✅ MERGED (was DRAFT)

**Action taken:** `gh pr ready 317` to flip from DRAFT → ready (blocker PR #303 had merged).

**Review findings:**
- Healthcheck CLI `python -m app.worker.healthcheck`: ✅
  - (a) Heartbeat freshness: checks `mtime` age vs configurable threshold (default 120s). ✅
  - (b) DB liveness: checks `DATABASE_URL` is _set_ — not a live socket probe. Note: acceptable for Phase B MVP; if live DB probe is later needed, add `SELECT 1` check in a follow-up.
- `with_db_retry()` wraps poll fn; `_DB_RETRY_ATTEMPTS=5`, exponential backoff 1→2→4→8→16s (truncated). ✅
- `MAX_ATTEMPTS` raised 3→5 in sync with `_DB_RETRY_ATTEMPTS`. ✅
- `next_retry_at` column on `compute_jobs` table. ✅
- Migration `20260506000001_compute_jobs_backoff.sql` idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`). ✅
- `_reclaim_stale_running_jobs()` resets stuck-running jobs after `_STALE_RUNNING_MINUTES = 10`.
  - ⚠️ **Flag for follow-up:** 10min may be too short for long-running pipeline jobs (see McManus's `pnl_daily` worker). Recommend making this configurable via `WORKER_STALE_RUNNING_MINUTES` env var. Iterative platform work — not a blocker.
- Restart policy `unless-stopped` on both `docker-compose.yml` and `docker-compose.backend.yml`. ✅
- CI: all required checks pass (secrets scan, migration lint, dry-run migrations, E2E smoke). ✅

**Decision:** Merge approved. Squash-merged. Branch deleted.

---

## Follow-up Issue Filed

**#319 — TJ-024-followup: Implement household soft-delete + restore audit hooks (`household_deleted`, `household_restored`)**

Filed to track the two deferred event types from PR #310. The `household_audit_action` enum already includes these values in the migration; only TypeScript helper wrappers and call sites are missing. Assigned `squad:hockney`. Coordinate with Fenster for the soft-delete trigger site.

---

## Operational Notes

- **PR #316 held:** Keaton's own R11 drop wrote directly to `decisions.md`. The pattern must be inbox-first. Scribe should audit any other direct-to-decisions PRs and redirect to inbox.
- **10-min reclaim timeout:** `_STALE_RUNNING_MINUTES = 10` in job_queue. Watch McManus's pipeline job durations in production; if P99 exceeds 10min, bump or make env-configurable.
- **Healthcheck DB probe gap:** Current check only validates `DATABASE_URL` presence. Consider adding a live `SELECT 1` probe for tighter liveness guarantees once Phase B workers are in prod.
