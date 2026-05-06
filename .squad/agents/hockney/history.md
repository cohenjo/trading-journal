- Runtime dependency on PR #85 (auth.users table), not build-time

**Branch:** `squad/70-backend-jwt-validation`
**PR:** Closes #70

## Learnings

### 2026-05-01: Backend Endpoint Disposition Audit (TJ-006)

**Context:** Phase 3 migration requires classifying every backend endpoint as MOVE (Supabase direct), KEEP (heavy/batch), or DEPRECATE (replaced by Supabase Auth or obsolete).

**Audit results:**
- **67 total endpoints** across 19 routers
- **32 MOVE** — simple CRUD on single tables with household scoping
- **28 KEEP** — heavy compute (backtests, projections, AI analysis), third-party APIs (yfinance, IBKR), multi-table joins with complex business logic
- **7 DEPRECATE** — auth.py (replaced by Supabase Auth), options.py (XLSX storage deprecated), trading.py config endpoints (should use env vars/vault)

**Cross-cutting concerns identified:**
1. **Household ID injection:** 14 routers use `get_user_household_id(session, user_id)` pattern. MOVE candidates need RLS policies + Server Action household context. Medium-High migration complexity.
2. **Mixed routers:** 5 routers (analyze, dividends, finances, ndx, trading) have both MOVE + KEEP endpoints. Requires careful frontend routing to split calls during migration.
3. **JSON field mutations:** pension and dividend_accounts endpoints mutate `finance_snapshot.data` JSONB field. PostgREST supports JSONB operators but adds complexity.

**Disposition criteria refined:**
- **MOVE:** Single-table CRUD, simple queries, no external API, no multi-step transactions beyond RLS+triggers.
- **KEEP:** Backtests, projections, AI analysis (Copilot SDK), third-party API calls (yfinance, IBKR), CPU/memory-intensive work, multi-table joins with aggregation.
- **DEPRECATE:** Replaced by Supabase Auth, obsolete storage patterns (XLSX), config that should be env vars.

**Migration phasing:**
- **Phase 3A (1-2 weeks):** 20 low-hanging fruit endpoints (holdings, insurance, plans CRUD, summary, simple finances/dividends CRUD)
- **Phase 3B (1 week):** 5 partial migration endpoints (dividend_accounts list/create, backtest GET /years)
- **Phase 3C (2-3 weeks, defer):** 5 complex candidates (trades POST with summary recalc, day multi-table join, pension reports)
- **Phase 4 (ongoing):** 28 heavy/batch endpoints stay in FastAPI as local Docker worker

**Key insight:** Frontend-backend HTTP coupling is symptom of incomplete Phase 3. After MOVE migration, `NEXT_PUBLIC_API_URL` should only route to heavy compute endpoints (analyze, backtest, pension upload, plans simulate, trading sync). No round-trip for CRUD — frontend talks to Supabase directly via RLS.

**Deliverable:** `docs/design-hosting/endpoint-disposition.md` — full audit with per-router tables, complexity ratings, and migration recommendations.

---

📌 **Migration dry-run fix (2026-05-02):** Backfill section of `supabase/migrations/20260502120000_auto_provision_household_on_signup.sql` was referencing `auth.users.raw_user_meta_data` (Supabase-hosted column only), causing shadow DB CI dry-run to fail. Simplified backfill CTE to use only standard columns: `coalesce(u.email, 'My Household')`. Trigger function keeps full `raw_user_meta_data` fallback chain since it fires on real auth.users in production. Lesson: shadow DB does not expose `auth.users.raw_user_meta_data`; backfill migrations must use only standard Postgres columns (id, email, etc.).

📌 Team update (2026-05-02T09:03:04Z): Household provisioning (PR #142) — trigger chain caveat. trg_households_add_creator (existing) already inserts household_members owner row; don't re-insert in upstream `handle_new_user_household()` or backfill (causes constraint violations). Document trigger ownership: each trigger owns one side effect, never duplicate. — Coordinator

## 2026-05-03: Household Bootstrap RPC + View + Backfill Landed — PR #164

**Deliverables from 2026-05-03 morning:** Migration `20260503090000_household_bootstrap_rpc.sql` added `account_type` column, `ensure_household(p_account_type)` RPC (SECURITY DEFINER, idempotent), and `v_my_active_household` view (SECURITY INVOKER). Backfill ran cleanly (0 rows affected — all users already had households post-trigger).

**Merge:** PR #164 rebased on #165 (E2E fixes), CI green, merged (commit 0ab20ec). First in the household bootstrap merge stack.

**Operational Blocker:** Stale Vercel env vars post key-rotation remain Jony's responsibility; backend contract is solid.

## 2026-05-06: Transport-Level Retry for IBKR Flex API — Branch squad/options-flex-backfill-resilience

**Context:** 7-month options backfill crashed on the FIRST chunk during SSL handshake before application-level retry could engage. `ConnectionResetError: [Errno 54] Connection reset by peer` at `requests.get` in `flex_probe.py:114` — existing code handled IBKR app error 1001 (throttle) but had no transport-layer resilience.

**Implementation:** Added `_get_with_retries()` helper that wraps `requests.get` with exponential backoff (5s→80s, ±20% jitter) across 5 attempts. Retries on:
- `requests.ConnectionError` (TCP reset, DNS fail, connection refused)
- `requests.Timeout` (slow handshake/response)
- `requests.exceptions.SSLError` (TLS negotiation failure)
- HTTP 500/502/503/504 (IBKR edge/WAF issues)

Does NOT retry on HTTP 4xx (auth/client errors — retrying makes it worse). Applied to both `request_xml()` and `get_statement()`. Made retry parameters tunable via env vars: `FLEX_TRANSPORT_MAX_ATTEMPTS` (default 5), `FLEX_TRANSPORT_INITIAL_BACKOFF` (default 5.0s).

**Testing:** Added 5 tests to `tests/test_flex_send_request.py`:
1. Transport retry succeeds after transient failures (2 ConnectionErrors → success)
2. Transport retry exhaustion (persistent ConnectionError → FlexProbeError)
3. 5xx retry (2x 503 → success)
4. 4xx no-retry (401 → immediate fail)
5. SSL error retry (SSLError → success)

All 11 tests pass. All 12 backfill tests pass. Ruff linting clean.

**Architecture Decision:** Two-layer retry model — transport-level (5s→80s, TCP/TLS/5xx) + application-level (60s→600s, IBKR 1001 throttle). Separate layers because failure classes are orthogonal: edge/network blips vs. IBKR backend statement generation queue. Transport retries make chunk self-healing; existing checkpoint resume logic unchanged.

**Key Files:**
- `apps/backend/scripts/flex_probe.py` — `_get_with_retries()` helper, updated `request_xml()` and `get_statement()`
- `apps/backend/tests/test_flex_send_request.py` — 5 new transport retry tests
- `apps/backend/scripts/backfill_options.py` — added comment near `mark_chunk_complete()` clarifying checkpoint contract

**Sleep Injection Pattern:** Sleep parameter threaded through `send_flex_request()` → `request_xml()` → `_get_with_retries()` so tests can mock time.sleep and assert backoff sequences. Existing tests updated to accept `**kwargs` on mock `request_xml()`.

**Next Steps for Jony:** Re-run the backfill: `uv run python scripts/backfill_options.py --start 2024-06-01 --end 2024-12-31 ...`

## 2026-05-06: Application-Level Retry Budget Expansion — Branch squad/options-flex-backfill-resilience

**Context:** Transport-layer retry fix (earlier today) succeeded — SSL reset no longer kills backfills. But application-level 1001 ("statement could not be generated") persisted across all 3 attempts (total ~3.5 min) for query_id `1496910`. IBKR's real-world 1001 behavior: commonly persists 15 minutes to several hours, typically clears overnight. Previous budget (3 attempts, 60→120→240s, ~7 min worst-case) was too tight for stuck backend jobs.

**Implementation:** Bumped default `max_retries` from 3 to 5 attempts. Added env-tunable constants `APP_MAX_RETRIES` (default 5) and `APP_INITIAL_BACKOFF` (default 60.0s). New worst-case wait: 60 + 120 + 240 + 480 + 600 = 1500s ≈ 25 min. This gives IBKR's backend generation queue a realistic window to clear stuck jobs.

**Improved exhaustion message:** Now includes actionable guidance when 1001 persists after all retries:
- Elapsed wait time
- Query ID for correlation
- Recommendation: wait ~30 min and retry, OR re-save Flex query in Account Management
- "Persistent 1001 typically clears overnight"

**Elapsed total tracking:** Added `elapsed_total` accumulator to show cumulative wait time in per-attempt logs and final error. Helps Jony see progress during long waits without re-computing backoff sequences.

**Testing:** Added 4 new tests to `tests/test_flex_send_request.py`:
1. New default retry count (5 attempts, not 3)
2. Explicit `max_retries` parameter override
3. Exhaustion message includes all guidance components
4. `elapsed_total` accumulates correctly across sleeps and appears in logs/error

All 33 tests pass (15 flex, 12 backfill, 6 options_sync). Ruff linting clean.

**Architecture Decision:** Two-tier retry model remains unchanged — transport-level (5s→80s, TCP/TLS/5xx) + application-level (60s→600s, IBKR 1001 throttle). Timescale separation is intentional: edge/network blips need fast recovery, backend statement generation needs patience.

**Key Files:**
- `apps/backend/scripts/flex_probe.py` — added `APP_MAX_RETRIES`/`APP_INITIAL_BACKOFF` constants, bumped defaults in `send_flex_request()`, added `elapsed_total` tracking, improved exhaustion message
- `apps/backend/tests/test_flex_send_request.py` — 4 new tests covering default behavior, explicit overrides, message content, elapsed accumulation

**Recommendation to Jony:** Try the backfill again. Worst-case 1001 patience is now 25 min (up from 7 min). If 1001 still persists, wait overnight (IBKR backend reset) or re-save the Flex query in Account Management as documented in the error message.

## Learnings

### 2026-05-06: IBKR 1001 Real-World Behavior and Two-Tier Retry Timescales

**Context:** IBKR Flex API error 1001 ("Statement could not be generated at this time") is not a transient blip — it commonly persists for 15 minutes to several hours when the backend has a stuck previous job or the saved Flex query needs re-saving. Overnight reset almost always clears it.

**Two-tier retry model:** Transport-level retries (5s→80s) handle TCP/SSL/edge failures at seconds-scale. Application-level retries (60s→600s) handle IBKR backend capacity issues at minutes-scale. These are orthogonal failure classes and need different patience windows.

**Env-var pattern for tunable resilience:** Module-level constants (`APP_MAX_RETRIES`, `APP_INITIAL_BACKOFF`) read from environment variables at import time, then used as function defaults. This lets operators tune retry budgets without code changes while keeping sensible defaults for common cases.

**Key insight:** When a backfill crashes mid-run (e.g., SSL reset before transport-layer retry existed), IBKR's backend often has a stuck in-flight request for that query_id. Subsequent runs hit persistent 1001 until the stuck job times out or overnight reset clears it. Retry budget must account for this — a 7-minute window is too short for real-world backend recovery.

## 2026-05-06: Flex Query Backfill Architecture Investigation

**Context:** 7-month backfill crashed on chunk 1 (2024-06-01..2024-06-30) with 1001 throttle persisting through 5 retries (57s→136s→254s→572s, 1019s total). Postgres SSL socket also disconnected during long wait. Investigated code architecture to understand query shape, retry math, resumability, Session lifetime, and splitting options.

### 1. Flex Query Type & Scope

**Query IDs from `.env.example:34-39`:** Five separate query IDs configured — trades, option_eae, cash, positions, account_info. Each can be a distinct IBKR Flex query OR all five can share a single master query ID (IBKR returns all sections in one XML).

**Deduplication logic (`flex_probe.py:313-322`):** `fetch_live_xml()` dedups by `query_id` before calling SendRequest — when multiple env vars share the same ID, only one HTTP request is made. Downstream parser walks XML sections by tag name, so one big query works fine.

**No evidence in code whether these are Trade Confirmation vs Activity queries.** Trade Confirmation (lighter, single-section) vs Activity Flex (heavier, multi-section) distinction lives in IBKR's Flex Query builder UI. The query_id itself is opaque. **Action item:** Jony should verify in IBKR Account Management → Flex Queries whether the configured query_id is "Trade Confirmation" (preferred, lighter) or "Activity Flex" (heavier).

### 2. Current Retry/Backoff Math

**Application-level 1001 retry (`flex_probe.py:243-278`):**
- Default: `APP_MAX_RETRIES=5`, `APP_INITIAL_BACKOFF=60.0` (lines 37-38)
- Sequence: 60s → 120s → 240s → 480s → 600s (capped at 600s)
- Jitter: ±20% random (`random.uniform(0.8, 1.2)`, line 252)
- Worst-case total: ~1500s (25 min)
- **Actual observed:** 57s → 136s → 254s → 572s suggests jitter variance and possibly different env var overrides during failed run

**Transport-level retry (`flex_probe.py:72-125`):**
- Default: `TRANSPORT_MAX_ATTEMPTS=5`, `TRANSPORT_INITIAL_BACKOFF=5.0` (lines 35-36)
- Handles TCP/SSL/HTTP 5xx
- Separate layer from 1001 retry — runs INSIDE each SendRequest/GetStatement HTTP call

**IBKR's documented guidance for 1001:** Wait 30-60 minutes between retries, or re-save query. Current 25-min budget may still be too tight for heavy accounts or stuck backend jobs.

### 3. Polling Shape (GetStatement)

**Polling loop (`flex_probe.py:281-298`):**
- Poll interval: `poll_seconds` (default 10, tunable via `--poll-seconds`)
- Max polls: `max_polls` (default 60, tunable via `--max-polls`)
- Terminal statuses: error_code != "1019" (anything but "in progress")
- Worst-case poll timeout: 10s × 60 = 600s (10 min)
- **1019 = statement generation in progress** — expected, keeps polling
- **Other errors fail fast**

**After SendRequest succeeds, GetStatement is called once** (`flex_probe.py:324`) with the reference_code. The poll loop is inside `get_statement()`.

### 4. Run Resumability

**Checkpoint file (`backfill_options.py:28`):** `.flex_backfill_state.json` — persisted JSON keyed by `account_key` (account_id or "_all").

**Checkpoint write (`backfill_options.py:195-206`, `mark_chunk_complete:195`):** Called AFTER `session.commit()` (line 284). Each chunk key (e.g., "2024-06-01:2024-06-30") appended to list only after DB write succeeds.

**Checkpoint read (`backfill_options.py:183-192`, `load_completed_chunks:183`):** Loads set of completed chunk keys. Backfill loop skips chunks in `completed` set (line 242).

**Resumability verdict:** ✅ **YES, fully resumable.** If chunk 3 of 7 fails, user can re-run with same flags and chunks 1-2 are skipped automatically. Use `--no-resume` to force re-processing.

**Idempotency:** Database upserts use `ON CONFLICT ... DO UPDATE` for trades/cash/legs (e.g., `options_sync.py:404`, `444`). Positions are deleted-then-inserted per snapshot_date (line 266-274). Safe to re-run chunks.

### 5. Failure Mode — Surgical vs. Abort

**Chunk loop (`backfill_options.py:253-305`):** Each chunk runs inside its own `with Session(engine) as session:` block. If a chunk raises (e.g., FlexProbeError from 1001 exhaustion), the exception propagates UP and OUT of the loop — **script aborts, remaining chunks are NOT processed**.

**No try/except around chunk operations** — FlexProbeError from `run_flex_options_sync()` (line 255-263) bubbles to main().

**Failure mode verdict:** ❌ **NOT surgical.** One chunk failure kills the entire backfill. Remaining chunks are not attempted. User must re-run to resume from failed chunk.

### 6. DB Socket Disconnect Side-Effect

**Session lifetime (`backfill_options.py:254`):** Session is opened at START of each chunk (line 254), stays open through:
1. Flex fetch (potentially 1019s of 1001 retries inside `run_flex_options_sync` → `_select_flex_source` → `fetch_live_xml` → `send_flex_request`)
2. All parsing and DB writes
3. Commit/rollback (line 278-280)

**Problem:** The Postgres connection lives across the entire 1001 retry storm (~17 min idle). Supabase/Postgres poolers commonly have 5-10 min idle timeouts. The Session is opened at **chunk start** but the Flex fetch (which can take 17 min) happens INSIDE the Session lifetime.

**Root cause (options_sync.py:182-212, `_select_flex_source:182`):** Live Flex fetch called from within the Session context (backfill → run_flex_options_sync → _select_flex_source → fetch_live_xml). The DB connection sits idle during the entire IBKR API round-trip.

**Architecture flaw:** Session lifetime couples DB connection lifetime to IBKR API latency. Should be:
1. Fetch Flex XML (no Session)
2. Open Session
3. Parse & write
4. Commit & close Session

**Workaround today:** Use `--synthetic` to skip live Flex fetch (reads cached XML), or bump pooler `idle_in_transaction_session_timeout` (but that's a band-aid).

### 7. Concurrency Safety

**Quick scan — potential issues:**
1. **No explicit locking** on chunk state file (`.flex_backfill_state.json`). Two concurrent backfills for overlapping ranges could corrupt JSON or race on chunk marks. JSON is re-read and re-written each time (lines 198-206).
2. **Database upserts are idempotent** (ON CONFLICT clauses), so overlapping fetches won't duplicate trades. But two processes fetching the same chunk waste IBKR API quota.
3. **No query_id cooldown tracking** — if two backfills fire the same query_id concurrently, second one likely hits 1001 immediately.

**Verdict:** 🟡 **Mostly safe but wasteful.** Won't corrupt data, but wastes API quota and risks 1001 throttles. Not designed for concurrency — single-user script assumption.

### 8. Quick Wins Available Today

**Without IBKR changes:**
1. **`--chunk-months 1`** — already default (line 26, 81), safest for heavy accounts
2. **`--chunk-sleep 45`** — default inter-chunk sleep (line 27, 89), prevents consecutive 1001s
3. **`--poll-seconds 10` / `--max-polls 60`** — defaults give 10-min GetStatement timeout, tune up if needed
4. **`--no-resume`** — force re-fetch if checkpoint is stale
5. **`--synthetic`** — bypass IBKR entirely for testing (line 71, 221-222)
6. **`--dry-run`** — parse+process but rollback DB writes (line 77, 277-278)
7. **Env var tuning:** `APP_MAX_RETRIES`, `APP_INITIAL_BACKOFF`, `TRANSPORT_MAX_ATTEMPTS` — increase 1001 patience if needed

**Missing flag that would help:** `--resume-from-chunk N` or `--start-chunk` — today you can only skip completed chunks automatically, can't manually jump to chunk N without editing JSON.

### 9. "Split and Simplify" — What It Means in Code

**Current query deduplication (`flex_probe.py:313-322`):** If all five env vars (trades, cash, positions, option_eae, account_info) share the same query_id, only ONE SendRequest is made. The single XML includes all sections.

**Splitting would mean:** Use FIVE distinct query_ids in IBKR Flex Query builder, one per section. Set five different IDs in `.env`. Code already supports this — `query_configs_from_env()` (line 157-164) returns one QueryConfig per unique query_id, and `fetch_live_xml()` loops over them (line 313-329).

**Pros of splitting:**
- Smaller individual queries → less likely to hit 1001 for backend capacity
- Can retry one section without re-fetching others
- Clearer error messages (know which section failed)

**Cons:**
- 5× the API calls → 5× the 1001 risk if queries aren't spaced out
- 5× the wait time (each query has its own SendRequest + poll cycle)
- More complex checkpoint state (would need per-section state tracking, not just per-chunk)

**Code changes needed to split intelligently:**
- Add per-section checkpoint state (today's checkpoint is chunk-level only)
- Add inter-query sleep between sections (like `--chunk-sleep` but for sections within a chunk)
- Handle partial section failures (e.g., trades succeed, cash fails — need to mark trades complete separately)

**Today's code CAN call multiple query_ids** (it's already set up for it), but resumability/checkpointing is coarse (chunk-level, not section-level). Splitting queries without better state tracking could make failures WORSE (re-fetch sections that already succeeded).

### Key Architectural Findings

1. **Session-lifetime bug:** DB connection held across entire Flex retry storm (~17 min). Should fetch XML BEFORE opening Session.
2. **Chunk failure aborts entire run** — not surgical. Need per-chunk exception handling to continue to next chunk.
3. **Resumability works** — checkpoint JSON + idempotent upserts make re-runs safe.
4. **Query split is possible but needs section-level checkpointing** — today's code can call multiple query_ids but checkpoint is chunk-level only.
5. **1001 backoff may still be too tight** — 25-min worst-case budget vs. IBKR's "wait 30-60 min" guidance.

### File:Line Citations

- Query deduplication: `flex_probe.py:313-322`
- 1001 retry logic: `flex_probe.py:243-278`
- Polling loop: `flex_probe.py:281-298`
- Checkpoint write: `backfill_options.py:195-206`, called after commit at line 284
- Checkpoint read: `backfill_options.py:183-192`
- Session lifetime: `backfill_options.py:254` (opened), spans Flex fetch inside `run_flex_options_sync:255`
- Flex fetch called from Session context: `options_sync.py:182-212` (`_select_flex_source` → `fetch_live_xml`)
- Chunk loop: `backfill_options.py:253-305` — no exception handling, fails on first error
- Env var query config: `flex_probe.py:157-164` (`query_configs_from_env`)
- Environment constants: `flex_probe.py:35-38`, `.env.example:31-39`

## 2026-05-06: Phase A Resilience Hardening — Branch squad/options-flex-backfill-resilience

**Context:** Multi-month backfill runs hit two production failure modes: (1) Supabase pooler kills idle connections at ~10min while Flex API calls take ~17min worst-case, causing `SSL SYSCALL Socket is not connected` errors that masked the original FlexProbeError, and (2) one chunk failure aborted the entire multi-month run with no recovery mechanism.

**Phase A.1: Session-Lifetime Decoupling**
Split `run_flex_options_sync()` into fetch-then-apply pattern:
- Added `_fetch_flex_options_paths(**kwargs) → list[Path]` in `options_sync.py` (no Session, does network fetch)
- Added `pre_fetched_paths: list[Path] | None` parameter to `run_flex_options_sync(session, ...)`
- Updated `backfill_options.py` chunk loop: call `_fetch_flex_options_paths()` first (slow network), then open Session for DB writes (fast)
- Backward-compatible: existing daily-sync handler (`run_scheduled_flex_options_sync()`) and worker job handler (`handle_flex_options_sync()`) still work unchanged (they pass `pre_fetched_paths=None` and let the function fetch internally)

This prevents SQLAlchemy Session idle timeout during long Flex waits. The Session is now only open during the fast DB-write phase (~seconds), not the slow network phase (~minutes).

**Phase A.2: --continue-on-error Flag**
Added CLI flag `--continue-on-error` (default: False, to preserve current abort-on-first-failure behavior):
- Wraps chunk processing in try/except that catches `Exception` (but re-raises `KeyboardInterrupt` and `SystemExit`)
- Failed chunks logged loudly with window info + exception type/message
- Failed chunks NOT marked complete in checkpoint (so `--no-resume` or manual resume picks them up later)
- Tracks failed chunks in a list; prints end-of-run summary with all failures
- Exit code 1 if any chunk failed (to keep CI honest), exit 0 only if all succeeded

**Phase A.3: --resume-from-chunk Flag**
Added CLI flag `--resume-from-chunk N` (1-indexed for human readability):
- Skips the first N chunks of the **pending** list (after checkpoint filtering)
- Mutually compatible with `--no-resume`: `--no-resume --resume-from-chunk 3` means "ignore checkpoint AND skip first 3 chunks of all chunks"
- Useful for manual recovery when checkpoint state is missing/corrupt OR Jony wants to manually skip past a known-bad window
- If N >= len(pending), prints warning and exits 0 (nothing to do)

**Phase A.4: Retry Budget Tuning**
Bumped `FLEX_APP_MAX_RETRIES` default from 5 to 8 attempts (giving ~50min retry budget vs ~25min). Jony confirmed query 1496910 is a heavy Activity Flex Query; IBKR 1001 commonly persists 30-60min for these. Updated `.env.example` with full retry config docs.

**Testing:**
- Updated `test_send_flex_request_uses_new_default_retry_count` for new default (8 attempts, not 5)
- All 15 flex_probe tests pass
- All 14 existing backfill tests pass
- Added smoke tests for Phase A.1-A.3 (session decoupling, continue-on-error, resume-from-chunk)

**Key Files:**
- `apps/backend/app/worker/handlers/options_sync.py` — added `_fetch_flex_options_paths()`, updated `run_flex_options_sync()` with `pre_fetched_paths` parameter
- `apps/backend/scripts/backfill_options.py` — refactored chunk loop to fetch→open Session→apply, added `--continue-on-error` and `--resume-from-chunk` flags, added failed-chunk tracking and end-of-run summary
- `apps/backend/scripts/flex_probe.py` — bumped `APP_MAX_RETRIES` default from 5 to 8
- `apps/backend/.env.example` — added retry config docs
- `apps/backend/tests/test_flex_send_request.py` — updated default retry test
- `.squad/skills/two-tier-api-retry/SKILL.md` — captured skill from prior work

**Commits:**
- `fix(backfill): decouple SQLAlchemy Session from Flex fetch (Phase A.1)` — session-lifetime fix
- `feat(backfill): add --continue-on-error and --resume-from-chunk (Phase A.2-A.3)` — resilience flags

**Recommendation to Jony:** Re-run the backfill with these flags as needed:
- Default behavior: abort on first failure (safest for CI)
- `--continue-on-error`: push through all chunks, collect failures, retry later
- `--resume-from-chunk 3`: manually skip first 3 pending chunks (recovery escape hatch)
- Worst-case 1001 patience is now ~50min (up from ~25min)

## Learnings

### 2026-05-06: Session-Lifetime Bug Pattern in Long-Running Network Calls

**Context:** When SQLAlchemy Session is opened before a slow network roundtrip (e.g., IBKR Flex API taking ~17min worst-case), Supabase pooler kills idle connections at ~10min. When the network call finally completes (or fails), any attempt to use the Session (e.g., `session.rollback()`) raises `SSL SYSCALL Socket is not connected` — masking the original error.

**Pattern:** Database session lifecycle must NOT span slow external network calls. Best practice: pre-fetch all network data FIRST, then open Session for fast DB writes only.

**Implementation:** Split fetch-then-apply:
1. `fetch_*(...) → data` (no Session, network I/O)
2. `with Session(engine) as session: apply(session, data, ...)` (Session-bound work)

This pattern applies to any DB-backed service that calls slow external APIs (e.g., yfinance, IBKR, AI model inference endpoints). The Session should only be open during actual DB operations, not during network waits.

**Alternative considered but rejected:** DB keepalive pings during long waits. This is fragile (what if keepalive itself fails?) and wasteful (holding a connection open for no reason). Better to not open the connection until you need it.

### 2026-05-06: Chunk-Level Error Handling for Multi-Month Backfills

**Context:** Multi-month backfills are inherently fragile: one chunk failure (e.g., IBKR 1001 throttle, network blip, transient DB issue) aborts the entire run, losing progress on all other chunks.

**Design decision:** Add `--continue-on-error` flag (default: False) that catches chunk-level exceptions, logs them, does NOT mark the chunk complete, and continues to the next chunk. At the end, print a summary of all failures and exit with code 1 if any failed.

**Why default to False:** Preserves current abort-on-first-failure behavior, which is safest for CI and automated runs. Users opt into continue-on-error when they want to push through a multi-month backfill and collect all failures in one run.

**Critical:** Failed chunks MUST NOT be marked complete in the checkpoint. The resume contract is: "checkpoint contains only successfully completed chunks." This way, `--no-resume` or a fresh run will retry failed chunks.

**Exception handling subtlety:** MUST re-raise `KeyboardInterrupt` and `SystemExit` (user interrupts), NOT catch them. The `except Exception:` clause handles application-level errors (FlexProbeError, DB errors, parsing errors), not user/OS signals.

### 2026-05-06: Manual Recovery Escape Hatch with --resume-from-chunk

**Context:** Checkpoint state can become corrupt (JSON parse error, accidental deletion) OR Jony wants to manually skip past a known-bad chunk window (e.g., IBKR data corruption for a specific month, already reported to IBKR). The existing `--no-resume` flag helps (reprocess all chunks) but doesn't let you skip specific chunks.

**Design decision:** Add `--resume-from-chunk N` (1-indexed) that skips the first N **pending** chunks (after checkpoint filtering). This is compatible with `--no-resume`: you can do both together.

**Example:** Jony has 10 chunks (Jan-Oct 2024). Checkpoint says chunks 1-3 are complete. He knows chunk 4 (April 2024) has IBKR data corruption and wants to skip it for now, process 5-10.
- `--resume-from-chunk 2` skips the first 2 **pending** chunks (4 and 5), processes 6-10.
- OR: `--no-resume --resume-from-chunk 4` ignores checkpoint, treats all 10 as pending, skips first 4 (1-4), processes 5-10.

**Why 1-indexed:** Humans count from 1, not 0. CLI flags should be human-readable.
