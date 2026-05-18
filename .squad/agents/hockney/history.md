## 2026-05-19 — Flex Query Worker Diagnostic

**Task:** Read-only diagnostic of IBKR Flex Query worker for Jony's 5 questions.

**Learnings:**

- **Two completely separate sync paths, two separate "last synced" fields.** The Accounts page reads `trading_account_config.last_synced` (written only by live IB Gateway path). The Options page reads `options_flex_sync_state.last_sync_at` (written by Flex XML path). These are decoupled — one can be stale while the other is fresh. The Accounts page will ALWAYS show "Never" while IB Gateway is offline, regardless of Flex health.

- **Orphaned E2E test rows in production are silent P0s.** An E2E test account config (`E2E_TRADING_*`) was left in `trading_account_config` with a `household_id` that no longer exists in `households`. `_load_accounts()` has no join guard against orphaned households. This caused 7 consecutive silent nightly failures (May 13–19) before being discovered. Always clean up E2E test data in teardown, and add a join guard in `_load_accounts()`.

- **APScheduler logs errors but raises no alerts.** 7 nights of P0 failures, zero team notification. The nightly-backup workflow has a GitHub-issue alert pattern we should copy for the Flex sync. Log monitoring ≠ alerting.

- **Flex API fetch succeeds even when DB write fails.** IBKR Flex token and query IDs are valid and the live API responds correctly each night. The failure is entirely in the local DB write step. So the Flex integration with IBKR itself is healthy — only our DB has the orphaned row problem.

- **`IBKR_FLEX_TOKEN` absent from `docker-compose.backend.yml` env block.** It's passed via `.env` auto-read. New developers missing this will get synthetic data silently. Should be documented in `.env.example` and optionally validated at worker startup.

- **Container started May 13 per `docker ps` output.** The `docker ps` "X days ago" field is a reliable way to date the current container's birth. Cross-reference with `git log` to identify what code the container is running.

**Report:** `.squad/decisions/inbox/hockney-flex-query-diagnosis-2026-05-19.md`
**Bugs found:** 2 bugs (P0 FK violation, P1 misleading "Never"), 2 smells (no alerting, missing env doc)

---


📌 Team update (2026-05-19): Strict-lockout 5-round P0 fix protocol shipped Flex sync fixes in ~2.5h (diagnostic → implement → parallel review → merge → deploy). 88 orphan trading_account_config rows discovered; cascade gap suggests future audit needed. IB Gateway is desktop app, not Docker-managed. Decided by Scribe during cross-agent orchestration.
