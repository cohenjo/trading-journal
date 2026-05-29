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

### 2026-05-27 — RSU Dividend Automation Architecture

**Requested by:** Jony Vesterman Cohen
**Work:** Architecture and contracts for RSU stock price + dividend yield automation across worker, Plan engine, and cash-flow income pool.

**Architecture Decisions:**

1. **Q1 (dividend_tax_rate):** Default to 25% for RSU accounts, allow user override. Rationale: Israeli 25% dividend withholding is standard, but edge cases exist.

2. **Q2 (dividend_policy):** Force-locked to 'Payout' for RSU. Rationale: RSU dividends are cash payouts (no broker DRIP); must route to income pool.

3. **Q3 (WIX ticker):** No mapping needed. WIX is NASDAQ-listed; `yahoo_refresh.py` resolves US tickers verbatim.

4. **Q4 (stock_positions sync):** Not required. `price_cache` already scans `plans.items[].account_settings.stock_symbol`. Extend with `dividend_yield` column instead of syncing to `stock_positions`.

**Key File Paths:**
- `apps/backend/app/services/price_cache.py` — extend `PriceQuote` with `dividend_yield`, add DB column
- `apps/backend/app/worker/yahoo_refresh.py` — existing yield fetch logic (L195-220) already normalizes to [0,1]
- `apps/frontend/src/app/finances/actions.ts` — extend `getPrice()` to return yield
- `apps/frontend/src/components/Plan/PlanAccountDetails.tsx` — auto-populate yield, enforce RSU defaults
- `apps/frontend/src/components/Plan/PlanEngine.ts` — L146/199/231 account normalization, L307 tax calc, L320 policy override

**Cross-System Patterns:**
- `price_cache` is the single source of truth for real-time market data (price + yield) across Plan, Snapshot, and Dashboard.
- RSU accounts are identified by `account_settings.type === 'RSU'` in both `finance_snapshots` and `plans` JSONB.
- `generated_income` flows to `yearIncome` at L495-497 in PlanEngine; Sankey consumes this automatically.

**Design Doc:** `.squad/log/2026-05-27-rsu-automation-design.md`
**Decision Entry:** `.squad/decisions/inbox/keaton-rsu-design.md`

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.

### 2026-05-29 — Credit-Card Expense Analysis Pipeline Architecture

**Requested by:** Jony Vesterman Cohen
**Work:** Full architecture survey + proposal for household credit-card PDF ingestion, categorization, and expense analysis UI.

**PDF Format Survey — confirmed formats (all Hebrew RTL):**

| Format | Issuer | Cardholder | Card | Pages | Sector column? |
|--------|--------|------------|------|-------|----------------|
| Cal General (`דף פירוט דיגיטלי כאל*.pdf`) | Cal Credit Cards | Jony | 9356 (Business Gold MC) | 2 | ✅ ףנע field |
| Cal PayBox (`639156527*.pdf`) | Cal (PayBox Visa variant) | Rita | 4654 (Platinum Visa PayBox) | 2 | ✅ same as Cal General |
| Max (`statement__*.pdf`) | Max Financial Services | Rita | 1494 (MC) | 1 | ❌ must infer from merchant |
| Isracard (`Unknown-N.pdf`) | Isracard Corporate | Jony | 3557 (Corporate Gold MC) | 3 | ✅ ףנע field (domestic section) |

**Key PDF learnings:**
- pdfplumber 0.11.9 (already installed) extracts Hebrew text successfully from all formats. No fallback parser needed at this stage.
- RTL text extraction: pdfplumber uses visual/positional order. Words appear roughly right-to-left. Use word-level `extract_words()` with `x0` positions to reconstruct column order reliably.
- **Cal and Isracard PDFs include an issuer-provided sector field** (`ףנע`) — this is a free categorization signal we can use as Tier 1 in the categorization engine with high confidence (~0.85).
- Max PDFs have NO sector field → must rely entirely on rules + merchant mappings.
- Cal date format: `DD/MM/YYYY`. Max dates have a Hebrew-year suffix artifact (e.g., `05/04/267`) — strip trailing non-numeric chars.
- Isracard splits into two sections: foreign purchases (with FX rate, fee, original currency) and domestic transactions.
- Cal installment format: `N - מ M םולשת` = "payment N of M" — store separately from regular transactions.
- All statements are for the household of Jony + Rita Vesterman Cohen. Two bank account numbers are referenced: `04-136-0000146368` (Jony's Cal) and `10-944-0001415557` (Rita's Cal/Max).
- The "Unknown" naming of Isracard files is from email download — not a special format.

**Architecture decisions made:**
1. **Amount storage:** `NUMERIC(12,2)` in ILS (not agorot integer) — consistent with project conventions, sufficient for household scale.
2. **Dedup:** SHA-256 of raw file bytes stored as `CHAR(64)`.
3. **Inbox folder:** `reports/credit-card/inbox/` → `processed/` or `errors/` — local folder pattern (not Supabase Storage, pending Jony confirmation).
4. **Worker job:** Polled interval, 60 seconds, matching existing APScheduler pattern.
5. **Categorization:** 3-tier: issuer_sector → deterministic YAML rules → learned mappings → unresolved queue.
6. **Category taxonomy:** 28 leaf categories across 10 top-level slugs.
7. **Worker redeploy gate:** CC-5 (worker job) WILL trigger the mandatory rebuild check per Keaton charter.

**Outstanding decisions needed from Jony:** 9 open questions in Section 8 of the proposal. Most critical: Q1 (cardholder mapping confirmation), Q4 (inbox folder vs Supabase Storage), Q5/Q6 (issue + branch strategy).

**Work items:** 14 items across Hockney (parser+API+worker), McManus (taxonomy+plan sketch), Fenster (UI), Redfoot (tests), Kujan (Docker/worker rebuild), Rabin (security review). Critical path: CC-1 (DB) → CC-2+CC-4 (parser+engine) → CC-5+CC-6 (worker+API) → CC-7+CC-8 (UI).

**Decision file:** `.squad/decisions/inbox/keaton-credit-card-architecture.md`
**Skill:** `.squad/skills/hebrew-pdf-statement-parsing/SKILL.md`

### 2026-05-29: Credit-Card Expense Analysis Pipeline — Architecture Proposal

**Requested by:** Jony Vesterman Cohen (Coordinator)

**Work:** Comprehensive architecture kickoff for credit-card expense analysis pipeline. Completed 4-format PDF survey (Cal General, Cal PayBox, Max, Isracard), all Hebrew RTL text extraction validated. Designed 5-table data model, multi-stage backend pipeline (parser → ingestion worker → categorization engine), API contract (5 routes), frontend UI (resolution queue + monthly expenses chart), and 14-item work decomposition with parallelization strategy.

**Key Decisions:**
- Store original FX + rate per transaction (no schema simplification)
- Category taxonomy: 12 core categories + "Transfers" (handling TBD pending Jony input)
- Inbox location: `reports/credit-card/inbox/` (local folder)
- Historical backfill: 30 sample PDFs after worker goes live
- Constraint budget: Agents max 2 clarifying questions per item; beyond that, make reasonable decisions + note assumptions in PR

**Risk Register:** 7 items identified with mitigations:
1. Hebrew RTL column misalignment — use positional extraction + x-coordinate sorting
2. Category miscategorization at scale — resolution queue + issuer_sector signal
3. New PDF format surprise — fingerprint-based detection + errors/ folder
4. PII in PDFs — never log raw text, local storage, Rabin security review (CC-12)
5. Worker redeploy gate ⚠️ — CC-5 modifies app/worker/; Kujan (CC-11) verifies post-rebuild
6. Date parsing errors (Max suffix "267") — regex strip trailing non-digits
7. Installment double-counting — store installment_total_amount_ils separately; monthly summary uses amount_ils only

**Open Questions (Blockers Section 8):** 9 items require Jony sign-off before CC-1 (migrations) begins:
1. Cardholder mapping (4 known cards — any additions?)
2. Category taxonomy (add/remove/rename?)
3. Multi-currency storage (FX rate + original currency confirmed)
4. Inbox folder location (`reports/credit-card/inbox/` or Supabase Storage bucket?)
5. Issue tracking (single epic + sub-issues or one issue listing all?)
6. Branch strategy (per-PR or single feature branch?)
7. PayBox transfers handling (categorize as "Transfers" or underlying expense?)
8. Historical backfill timing (immediate after worker or defer?)
9. Cardholder names (free-text from PDF or FK to household_members table?)

**Work Items:** 14-item fan-out ready:
- Sprint A (parallel): CC-1 (DB migrations, Hockney), CC-3 (category YAML, McManus)
- Sprint B: CC-2 (PDF parsers, Hockney), CC-4 (categorization engine, Hockney), CC-6 (API, Hockney), CC-12 (security review, Rabin)
- Sprint C: CC-5 (inbox worker, Hockney), CC-7 + CC-8 (UI, Fenster)
- Sprint D: CC-9 + CC-10 (tests, Redfoot), CC-11 (worker rebuild, Kujan), CC-14 (backfill, Hockney)

**Deliverables:**
- `.squad/decisions/inbox/keaton-credit-card-architecture.md` (merged to decisions.md)
- `.squad/log/2026-05-29T122212Z-credit-card-architecture-kickoff.md` (session log)
- `.squad/orchestration-log/2026-05-29T122212Z-keaton.md` (orchestration record)

**Status:** Proposal complete. Awaiting Jony sign-off on Section 8 blockers before implementation begins.

**Related Decision:**  `.squad/decisions.md` § "2026-05-29: Credit-Card Expense Analysis Pipeline — Architecture Proposal"
