## Learnings

### 2026-05-01 — Phase 3 Execution Plan: Frontend↔Supabase Direct
### 2026-05-06 — Flex Backfill Failure: Strategy & Recommendations

**Requested by:** Jony Vesterman Cohen
**Work:** Diagnosed root cause of 2024 backfill failure (1001 throttle, 5-retry exhaustion, DB connection rollback) and produced 3-tier strategy from cheapest fix to deepest re-architecture.

**Context:**
Backfilling 2024-06-01→2024-12-31 in monthly chunks (60s inter-chunk sleep, 10s poll, 60 max polls). First chunk hit IBKR Flex error 1001 on SendRequest. Exponential backoff (57s, 136s, 254s, 572s) exhausted 5 retries in 1019s. Script died with fatal exception; Postgres connection rolled back due to dead SSL socket after prolonged wait.

**Root Causes Identified:**
1. **IBKR throttling:** 1001 = "Statement could not be generated at this time" — fired immediately on SendRequest, not during GetStatement polling. Suggests query_id rate limit or backend queue health issue.
2. **Retry budget too small:** 5 retries × exponential backoff (60→600s cap) only gives ~1019s total budget. IBKR 1001 can persist 30+ minutes when backend is unhealthy.
3. **No chunk-level resilience:** One failing chunk kills the entire multi-month run. No checkpoint/resume across script restarts.
4. **DB connection timeout:** Supabase pooler connections idle-timeout after 10 minutes. 17-minute retry loop → dead SSL socket → transaction rollback.
5. **Query design unknown:** No visibility into whether the monthly query is too complex/large for IBKR's Flex backend.

**Key File Paths:**
- `apps/backend/scripts/backfill_options.py` (orchestrator, lines 254-263: call to run_flex_options_sync)
- `apps/backend/scripts/flex_probe.py` (lines 213-278: send_flex_request with 1001 retry, lines 72-125: transport retries)
- `apps/backend/app/worker/handlers/options_sync.py` (lines 182-212: _select_flex_source, fetch_live_xml call)
- ENV knobs: `FLEX_APP_MAX_RETRIES` (default 5), `FLEX_APP_INITIAL_BACKOFF` (default 60s)

**Strategy Options Produced:**
See `.squad/decisions/inbox/keaton-flex-backfill-strategy.md` for full 3-tier analysis.

**Recommendation:** **Option 2 (Tuned Retry + 2-Phase Polling)** — increase retry budget to 10 attempts, extend backoff cap to 15 minutes, split SendRequest (1001 handling) from GetStatement (1019 polling), add DB keepalive pings during long waits, implement chunk-level checkpoint/resume. Estimated effort: 3-4 hours. Solves 80% of cases without full async rewrite.

**Open Questions for Team:**
- What is the IBKR-documented Flex date-range limit? (365 days suspected, needs verification)
- Does the option_eae query have a complexity issue? (check IBKR query designer for warnings)
- Should we expose a "resume from chunk X" CLI flag for manual intervention?

**Decision file:** `.squad/decisions/inbox/keaton-flex-backfill-strategy.md`

📌 **Team update (2026-05-05T18:32:37Z):** E2E testing strategy and TJ-019/TJ-020 frontend Supabase-only compute architecture decisions merged into shared decisions. Reskill pass extracted e2e-walkthrough-patterns skill from walkthrough assertions pattern. — Scribe (wind-down)

📌 Team update (2026-05-06): Transport retry pattern for external HTTP APIs — two-tier strategy (short backoff for network hiccups, long backoff for app throttle). Useful for any external API integration. See decisions.md entry from 2026-05-06. — decided by Hockney

📌 **Team update (2026-05-06T11:35:28Z):** Two-tier API retry pattern extracted as reusable skill in `.squad/skills/two-tier-api-retry/SKILL.md`. Implements transport-tier short backoff (5s–80s for TCP/TLS) + application-tier long backoff (60s–600s for backend throttle). First applied to IBKR Flex 1001 error. Available for adoption by other teams. — Hockney

📌 Team update (2026-05-06): Architectural review gate for Flex backfill resilience PRs active. Phase A, failure log, --xml-dir, and test coverage awaiting review before main merge. ~12–15 commits staged.

📌 **Stock Positions Design for #340 (2026-05-09T18:19:36+03:00):**
- Scoped design for multi-account stock positions across IB (Flex STK), Schwab, IRA (manual).
- Key finding: Flex parser already handles `OpenPositions` section but filters to OPT only (line 199). STK rows silently dropped. Fix: add `elif assetCategory == "STK"` branch.
- Existing `dividend_positions` table lacks cost basis, currency, and account FK. New `stock_positions` table designed to unify all sources with `source` discriminator ('flex' | 'manual').
- `trading_account_config.account_type` already supports non-IBKR values — no schema change needed for account registration.
- `price_cache` table exists but is unpopulated. `dividend_ticker_data` (yfinance) is the viable pricing source for Phase 1.
- Migration must land after Hockney's drift reconciliation (#335). Timestamp ≥ 20260510000000.
- Design doc at `.squad/decisions/inbox/keaton-accounts-positions-design.md`.


📌 Team update (2026-05-19): Strict-lockout 5-round P0 fix protocol shipped Flex sync fixes in ~2.5h (diagnostic → implement → parallel review → merge → deploy). 88 orphan trading_account_config rows discovered; cascade gap suggests future audit needed. IB Gateway is desktop app, not Docker-managed. Decided by Scribe during cross-agent orchestration.
📌 2026-05-19: Refresh button architecture designed + reviewed (#463, #464) — REQUEST CHANGES + APPROVE posted via cohenjo auth (strict lockout, no code changes by reviewer)
