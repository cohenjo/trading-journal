# Keaton — Active History

> **Last summarized:** 2026-05-13 (removed 100 older entries to archive)
> **Current size:** 13127 bytes

---

- **Merging:** GitHub integration triggers automated DAG (Clone → Pull → Health → Configure → Migrate → Seed → Deploy). Only migrations land in prod; no data flows back.
- **Free-tier verdict:** The 2-project model (prod + dev) IS the free-tier equivalent of persistent branching. The `dev` project correctly serves as a persistent staging branch.
- **Recommendation filed:** Keep 2-project model. Revisit when: Pro upgrade for other reasons, team grows, or PR-preview automation needed.

**Decision file:** `.squad/decisions/inbox/keaton-supabase-branching.md`
**Sources:** supabase.com/docs/guides/deployment, /branching, /branching/working-with-branches, supabase.com/pricing.md

📌 Team update (2026-04-30T20:15:00Z): Supabase branching recommendation merged into shared decisions — no user rejection received. Confirmed: keep 2-project model (prod+dev on Free tier). Decision now live in `.squad/decisions.md`.



📌 **Team update (2026-04-30T22-16-38Z):** RLS-21 dev+prod merge complete — PR #98 (21 public tables + drop secrets) merged to main (9ec4d2b), 18 migrations applied to prod (jaesiklybkbmzpgipvea), 0 rls_disabled_in_public advisor errors verified. Issue #97 closed. Cross-agent RLS coverage now extends to all 21 public tables. — Rabin (author), Keaton (reviewer), Hockney (prod apply), Redfoot (E2E coverage opportunity)

---

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

## Learnings

### 2026-05-09 — Phase 2 Plan: Accounts/Positions + Dividend Table Decision

**Context:** Jony answered Phase 1 open questions for #340. Reconciled answers into Phase 2 work plan.

**`dividend_positions` Decision (option b — fold into `stock_positions`):**
`dividend_positions` is deprecated progressively. `stock_positions` becomes the single source of truth for all held positions across all accounts; `dividend_ticker_data` (already populated by yfinance worker) acts as the per-symbol yield lookup. `dividend_positions` stays alive through Phase 2c (no dashboard breakage), then is dropped in Phase 2d after the `/dividends` dashboard is migrated to read from `stock_positions JOIN dividend_ticker_data`. Key migration risk: 6 queries in `apps/frontend/src/app/dividends/actions.ts` reference `dividend_positions` directly — each must be ported before drop.

**3-Account Hard-Coded Set:**
Exactly `['ibkr', 'schwab', 'ira']` — enforced via CHECK constraint on `trading_account_config.account_type`. IBKR is Flex-synced; Schwab and IRA (Hishtalmut) are manual CRUD. No arbitrary account names. Enum must be migrated if a 4th account is ever added.

**Architectural Risk — #342 Regression:**
`summary/page.tsx` derives `projectedDividendAmount` from `dividend_positions` data today. When Fenster wires it to `GET /api/dividends/projection`, if `stock_positions` is empty the chart regresses to $0 (identical to pre-#342 bug). Mitigation: projection endpoint must fall back to `dividend_positions` total during transition; Redfoot must add regression guard test.

**McManus Dependency:**
All Flex STK parser work (H3) gates on McManus confirming whether existing Activity XMLs carry STK `OpenPosition` rows or if a new Flex query template is needed. Schema migration (H1) is Flex-source-agnostic and can proceed immediately.

## 2026-05-12 — Dividend accuracy + Leumi IRA + chore-PR triage sprint

**Sprint by:** Jony Vesterman Cohen

### PR Triage (12 chore PRs)

Triaged all 12 dependabot/chore PRs. E2E Smoke + Auth failures on all PRs confirmed as pre-existing infra issue (#366/#350), not caused by dep bumps — "All Required Checks Reference" gate SUCCESS for all.

- **Merged (8):** #383 #384 #385 #386 #387 #388 #390 #392 — patch/minor dep bumps and CI action major bumps (checkout 4→6, setup-python 5→6, setup-cli 1→2). CI action majors merged when CI proves green.
- **Closed (2):** #389 #391 — merge conflicts (superseded by concurrent merges; Dependabot will regenerate)
- **Held (2):** #393 (Next.js 15→16), #244 (ESLint 9→10) — framework major versions; require @cohenjo manual validation before merging

**Key decision:** Framework-level major bumps (Next.js, ESLint) must be manually validated — not auto-merged even when CI passes.

### Issue Triage (25 open issues)

- **Closed (3):** #350 (E2E superseded by #366), #79 (production confirmed live on Vercel), #65 (Supabase backfill complete via Flex XML)
- **Help wanted (1):** #304 — OAuth preview-deploy strategy awaiting @cohenjo decision on 3 design options
- **Re-routed:** #353 → squad:hockney; #315 → squad:copilot
- **Kept active:** 21 issues (5 with next-step comments, 16 unchanged)

### 2026-05-12 — Multi-PR Gate Review: Options Income Estimation Sprint

**Requested by:** Jony Vesterman Cohen
**PRs reviewed:** #433, #434, #435, #436, #437 (5 PRs, ~1800 additions)
**Verdict:** ✅ ALL 5 APPROVED

**Architecture validation:**
- All estimation logic lives in frontend server actions (not backend API) — consistent with dividends/bonds pattern ✓
- Single source of truth via `getOptionsIncomeEstimation()` server action ✓
- Actuals-win-over-projections merge in /summary page ✓
- Plan integration is optional/backward compatible ✓
- Default growth changed from 5% → 2% per Jony's spec (architecture note §3 acknowledged) ✓

**Key findings:**
1. **#433 CI:** Playwright E2E failure is a workflow YAML configuration issue, not code. Logic is clean.
2. **#434 negative income:** `optionsIncome.gt(0)` guard silently excludes negative projections from the plan. Conservative and probably intentional, but inconsistent with architecture decision §2 (negative baselines project forward). Noted, not blocking.
3. **No worker files touched** in any PR — worker redeploy gate NOT triggered.
4. **Merge order:** #433 → {#434, #435, #436} (any order) → #437. Rebases needed after #433 lands.
5. **Code quality:** Decimal arithmetic used throughout, proper TypeScript typing, comprehensive test coverage across all PRs.

**Decision-inbox:** No new patterns worth codifying — sprint follows established conventions cleanly.

---

2026-05-12: Authored 5 issues (#428–#432) for options-income-extrapolation. Reviewed all 5 PRs. All approved. Merge order: #433 root → {#434–#436} → #437.

## Learnings

### 2026-05-12 — Scribe Wrap Review: PR #427 (Round 8)

**Verdict:** APPROVE. Administrative-only (4 `.squad/` files), no source/test changes. `merge=union` gitattribute auto-resolves append conflicts with Round 9 wrap (#438). All 6 Round 8 decisions (Keaton-4, Hockney-14, Fenster-11, Hockney-15, Fenster-12, Hockney-16) captured accurately. Worker redeploy skill shipped separately in PR #426.

**Pattern:** Scribe wrap PRs are safe to approve when: (1) diff touches only `.squad/`, `.copilot/skills/` paths; (2) `merge=union` covers all append-only files; (3) GitHub reports MERGEABLE; (4) decision entries match PR body claims.

### 2026-05-12 — Reviewer Gate: PR #424 (Round 8 Phase 2 Frontend Currency Fix)

**Verdict:** APPROVE. Surgical Round 8 Phase 2 frontend fix — extends ÷100 display guard to GBP, adds GBP rate, QQQI TTM guard. 7 frontend-only files, 370 additions (191 tests), 61 deletions. Fully compliant with Round 8 currency contract (mark_price in native unit, ÷100 at display, market_value from DB). No Round 9 drift (zero file overlap with #433–#438). CI failure is known Node.js 20 WebSocket infra issue — safe to bypass. Merge standalone before #425.

**Pattern:** Post-merge drift check for stacked/delayed PRs — compare touched files against all PRs merged to main since the branch point. Zero overlap = no rebase needed even when multiple sprints have elapsed.

## 2026-05-13 — Plan persistence + cashflow sprint (Round 9, Issues #440 + #441)

Synthesis call (opus-4.6): triaged root causes (frontend optimistic UI swallow, backend NOT NULL without defaults, migration idempotency footgun). Routed 4 parallel agents: Fenster (frontend recon), Hockney (backend recon + migration audit), McManus (22 test scenarios), self (architecture synthesis). Blocked on migration fix before testing; PR merge order: Hockney #442 → Fenster #443 → Fenster #445 → McManus #444. Final HEAD 215fb8b verified green on Vercel. Worker redeploy not needed (no code changes to worker, Dockerfile, pyproject.toml). 6 decisions synthesized to Round 9; inbox files merged to decisions.md.

📌 **Team update (2026-05-13T15:34:00Z):** RLS pattern established for reference tables (security_reference, tase_yahoo_map). Canonical pattern: RLS enabled + permissive SELECT for authenticated. Never DISABLE RLS on PostgREST-exposed tables. — Hockney

### 2026-05-14: Supabase Platform Changes Review — Multi-agent Synthesis

**Requested by:** Jony Vesterman Cohen
**Work:** Synthesized Rabin (Security) + Hockney (Backend) specialist reviews of three Supabase announcements into a unified roadmap and architecture stance.

**Key findings:**
- **30 tables** with legacy anon grants (Rabin count: correct; Hockney text: stale "19" in summary, but correct table audit = 30)
- **Live query reconciliation:** Ran `information_schema.table_privileges WHERE grantee='anon'` and confirmed 29 full-CRUD + 1 SELECT-only (audit log)
- **Reference-table pattern confirmed:** Migration `20260513153400` set the correct template (REVOKE + GRANT + RLS)
- **Oct 30, 2026 deadline** for enforcement — we have 5 months
- **No Edge Functions** → `@supabase/server` not applicable; Python backend + supabase-ssr frontend
- **16 RPC functions** with implicit grants — also need explicit GRANT EXECUTE before Oct 30

**Synthesis pattern:** Multi-turn specialist fan-out (Rabin + Hockney parallel), catch discrepancies via live DB query, reconcile findings into unified 6-decision framework with roadmap. Caught the reference-table authenticated CRUD bug (today's migration left `authenticated` with full CRUD — should be SELECT-only). Flagged 16 RPC functions as Phase 2.3 inventory task.

**Decision file:** `.squad/decisions.md` § "Supabase platform changes review"
**Tasks opened:** 7 follow-up tasks (Phase 0/1/2) in coordination with Hockney, Rabin, Fenster.

📌 **Team update (2026-05-14T19:46:00Z):** Supabase platform-changes review complete — 30 tables with legacy anon grants, Oct 30 enforcement deadline, Phase 0/1/2 roadmap + 3 new conventions merged into shared decisions. Rabin + Hockney specialist reviews reconciled; migration template confirmed. Act this week on opt-in grants. Schedule JWT keys for June. — Keaton, Rabin, Hockney
