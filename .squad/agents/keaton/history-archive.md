# Keaton — Historical Context (Archived)

> Detailed entries prior to 2026-05-01. Summarized in `history.md` under "Core Context".

## Core Context: Codebase Review (2026-02-23)

**Architecture:** Next.js 15.3 (React 19, TypeScript 5) frontend + FastAPI (Python 3.10+, SQLAlchemy, SQLModel) backend. PostgreSQL 13, Aspire 13.1, OpenTelemetry instrumentation (Prometheus, Jaeger, Grafana). IB Gateway integration (optional, opt-in).

**Code Quality:** 78 TypeScript/TSX (clean), 82 Python (well-organized, 18 routers), 13 Playwright E2E + 10+ pytest tests. Minimal technical debt (3 TODOs). Modern stack (uv, lightweight-charts, Copilot SDK integrated).

**Risk Areas:** CORS unrestricted (`allow_origins=["*"]`), hardcoded credentials in docker-compose, financial Decimal type usage unverified. Security blocking: no JWT auth (17 endpoints exposed), credentials in git history.

---

## Team Initialization (2026-02-23)

Three critical team updates issued:
1. **Financial Precision:** All PRs must use Decimal/BigNumber for monetary calculations (breaking change, 1–2 weeks implementation).
2. **Security Hardening:** JWT implementation, credentials rotation, CORS restriction, CSP headers (blocks production).
3. **API & DevOps:** FastAPI OpenAPI generation, GitHub Actions CI/CD, production hardening checklist.

---

## v0.0.1 Release Planning (2026-03-04)

- **14 labels** created (stage workflow, priority levels, domain labels)
- **Milestone:** 13 issues across 3 priority tiers (critical: auth/credentials/CORS; high: tests, caching, CI; medium: Decimal migration, headers, AI Phase 2, docs, pension history)
- **Routing:** Each issue tagged to domain owner
- **Learning:** `gh project` requires unavailable scope; used milestone + labels instead

---

## Company Analysis Page Architecture (2025-07-18)

**Decision:** Split-Brain page at `/analyze` with Long-Term (business owner) and Short-Term (income mechanic) views.

**Architecture:**
- 5 backend API endpoints (`/api/analyze/*`)
- 17 frontend components across two view folders
- 4-phase delivery (Foundation → Long-Term → Short-Term → Polish)
- yfinance covers all data needs
- Financial calculations server-side in `analyze_service.py`
- AI synthesis: template-based (Phase 1) → Copilot SDK (Phase 2)

**Routing insight:** Existing TRADING pages use top-level paths (`/options`, `/ladder`, `/holdings`), so `/analyze` follows convention.

---

## Testing Sprint Phase 1–3 (2026-04-10)

**Outcome:** 110 new tests across 3 branches (Kujan CI, Hockney backend, Fenster frontend). 8 agents orchestrated. 3 branches ready for merge with 14 commits. Financial core priority approved, infrastructure P0, depth-over-breadth APIs approved.

---

## Hosting Architecture Overview (2026-04-30)

**Recommendation:** Default to **Option A: Lean** — Vercel-hosted Next.js, Supabase Auth/Postgres/RLS, local Docker for heavy compute.

**Sections drafted:**
- System-context diagram
- Architecture overview
- Alternatives matrix

**Decision:** `.squad/decisions/inbox/keaton-hosting-architecture.md`

---

## Unified Design Synthesis (2026-05-01)

**What:** Synthesized 6 section drafts into single unified design document (`docs/design-hosting/design.md`).

**Key reconciliations:**
- Adopted Hockney's Hybrid (Option C) as recommended architecture
- Standardized RLS helper functions per Rabin's stricter approach
- Clarified Kujan's Fly.io as future escalation, not initial deployment
- Default invite role: `viewer` (least privilege)
- Flagged stale `CLERK_SECRET_KEY` reference

**Team consensus:** Hosting design v1 approved with full-stack architecture, household sharing, RLS auth, phased migration plan.

---

## Vercel Policy & CI Runbook (2025-05)

**Artifact:** `docs/design-hosting/runbooks/vercel-03-policy-ci.md`

**Coverage:**
- Hobby commercial-use policy
- Live-verified quota table
- GitHub Actions CI Pattern A (recommended)
- Server Action duration limits (10s/60s standard; 300s with Fluid Compute)
- Function region guidance (`fra1` to match Supabase Frankfurt)

**Key findings:**
- Bandwidth limit not explicit in Hobby table (flagged ⚠️)
- Function duration discrepancy: 60s vs 300s with Fluid Compute (both documented)

---

## Hosting Migration Issue Decomposition (2026-05-02)

**What:** 31 GitHub issues across 6 phases (Prep → Foundation → Data → Frontend → Sharing → Cutover).

**Decomposition strategy:**
- Remapped design.md 5-phase into 6 task-oriented phases for better domain alignment
- Household DDL in Phase 1; sharing UX deferred to Phase 4
- Significant cross-phase parallelism enabled (frontend work can start early)

**Phase criticality:**
- Critical path depth: 9 issues (TJ-000 → TJ-030)
- TJ-014 (env vars) is earliest @copilot issue, unblocked by just TJ-002
- Phase 4 (Sharing) is smallest (4 issues) — structural work done in Phase 1

**@copilot-suitability:**
- ✅ Suitable (9): boilerplate, mechanical replacements, script creation, doc-driven audit
- ❌ Not suitable: security-critical design, cross-cutting architecture, manual provisioning, E2E test suites

**Artifacts:** `docs/design-hosting/issue-manifest.json`, `docs/design-hosting/issue-manifest.md`

## Archive Entry — 2026-05-09 (keaton)

**Total entries:** ~208 lines
**Archived to make room for ongoing work.**
---

## Archive Entry — Session 2026-05-13

**Lines archived:** 100 of 250
**Reason:** History file exceeded 15KB threshold (20858 bytes)

## 2026-05-13 — PR #447 review + merge (squad/440-followup-error-logging)

Reviewed Fenster's one-liner: propagates `error?.message` from Supabase through `{ok: false, error}` in `createPlan`. Note: raw error also surfaces in toast description (same `message` var feeds both console.error and toast on page.tsx:97-98) — Coordinator explicitly approved this tradeoff for single-tenant context. All required checks green; branch deleted at 1c0bc04.

## Archive (compressed)

### 2026-05-01–2026-05-02
- **2026-05-01 Supabase Branching:** Evaluated Supabase Branch feature (Pro-only, $9.68/month). Recommended keeping 2-project model (prod+dev) for Free tier. Branches clone schema but not data; merging uses automated DAG.
- **2026-05-01 Phase 3 Plan:** Planned frontend↔Supabase direct compute architecture (TJ-019/TJ-020). Scoped schema, API routes, and auth flow.
- **2026-05-02 E2E Testing Strategy:** Designed comprehensive E2E strategy with test-user provisioning, CI split (smoke+auth blocking, full flows nightly), tag-based suite selection. Produced 8 GitHub issues (#144–#151).

---

### 2026-05-06 — Merge Review: IBKR Flex Backfill Resilience Branch

**Requested by:** Jony Vesterman Cohen
**Branch:** `squad/options-flex-backfill-resilience` (12 commits, HEAD 3ccca71)
**Verdict:** 🔍 APPROVE WITH FOLLOW-UPS

**Work:** Final pre-merge architectural gate review of the entire IBKR Flex backfill resilience initiative. Reviewed two-tier API retry (`flex_probe.py`), session-lifetime decoupling (critical bug fix), `--continue-on-error`/`--resume-from-chunk` flags, persistent failure log, and `--xml-dir` mode. Verified 49 tests pass, 9 decision inbox notes consistent, env vars documented.

**Findings:**
1. ✅ Architecture sound — three-mode dispatch clean, session decoupling correct, failure semantics preserve fail-loud for daily sync
2. ⚠️ Committed test artifact `.flex_backfill_failures.json` (tracked in git despite gitignore) — cosmetic, needs `git rm --cached`
3. ⚠️ Final metrics recompute runs unconditionally even with failed chunks — known limitation per McManus review, not a blocker
4. ⚠️ `datetime.utcnow()` deprecation warning in `flex_probe.py:311` — pre-existing, low priority

**Key Insight:** When decoupling session lifetimes from network I/O in pooler-managed DB environments, the cleanest pattern is: fetch → open session → write → close. Never hold a session across slow external calls.

**Decision filed:** `.squad/decisions/inbox/keaton-merge-review.md`

---

### 2026-05-11 — #363/#364 Architecture Directive Design Lead

**Requested by:** Jony Vesterman Cohen
**Work:** Architected the positions-as-source-of-truth pattern for dividends and bonds pages. Inventoried data model, chose yield computation strategy (Option A: TTM from dividend_payments), confirmed bonds page already has positions pattern but needs 3-tab filtering. Recommended summary chart wiring already covered by backend refactoring.

**Design decisions:**
- Hardcoded 3 tabs (ibkr, schwab, ira) reuse existing `TAB_ORDER`, `TAB_LABELS`, `ACCOUNT_TABS` constants
- TTM yield = SUM(dividend_payments where ex_date >= 12mo ago) / mark_price (no external API dependency)
- Forward yield = dividend_accruals.gross_rate × paymentFrequency
- Account mapping: account_type (lowercase) → config.id (int) → stock_positions.account_id (int FK)
- Bonds: new `getLadderOverviewByAccount(accountKey)` export; Schwab/IRA return empty by construction

**Issues filed:** #363 (Dividends, high priority), #364 (Bonds, medium priority)

**Open questions flagged for Jony:**
- `dividend_payments.account_id` mapping (IBKR text string vs config FK)
- Historical payments UX (collapsible vs separate tab)
- `dividend_positions` table retirement timeline

**Decision filed:** `.squad/decisions/inbox/keaton-positions-source-of-truth-design.md`

---

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)
**Work:** Conducted detailed code review of McManus baseline schema work (PR #90). Identified 3 findings: tradingaccounttype enum, missing columns, FK coverage. Submitted APPROVE verdict. All findings addressed in subsequent commit 5a8367e.

**TJ-005 verdict:** Documented that Phase 1 schema work must use Supabase SQL migrations, not Alembic versions, per design §4.3. Blocking verdict recorded; dependency chain clarified (TJ-003→TJ-005→TJ-006→TJ-007).

**Key Insight:** Architectural decisions must be recorded early to prevent split migration histories across tools; Supabase CLI is the single source of truth for hosted schema.

---

### 2026-05-11 — Positions-as-Source-of-Truth: Dividends + Bonds Alignment Design

**Requested by:** Jony Vesterman Cohen
**Work:** Inventoried the full data model gap between the current dividends page (reads from `dividend_positions` — 0 rows, manually maintained) and the directive (read from `stock_positions` — 427 rows, synced from FlexQuery). Confirmed bonds page (`/ladder`) already uses `bond_holdings` with positions-pattern columns but lacks 3-tab account filtering. Chose Option A (compute TTM yield from `dividend_payments` — 5524 historical rows) over external API or FlexQuery field ingestion. Summary chart wiring is already covered — `getDividendDashboard()` feeds `projectedDividendAmount` and will automatically pick up the refactored data source.

**Issues filed:**
- #363 — Dividends page refactor to projected-income view (high priority)
- #364 — Bonds page 3-tab alignment (medium priority)
- No Issue C needed (summary chart covered by #363)

**Key finding:** `dividend_payments.account_id` is the IBKR account STRING ("U2515365"), not the integer `trading_account_config.id`. The join for per-account TTM yield requires mapping through `trading_account_config.details` or a dedicated lookup. Flagged as open question for Jony.

**Decision filed:** `.squad/decisions/inbox/keaton-positions-source-of-truth-design.md`

---

## Learnings

### 2026-05-11 — dividend_payments.account_id is IBKR string, not config FK

**Context:** The `dividend_payments` table uses a TEXT `account_id` column containing the IBKR account string (e.g. "U2515365"), while `stock_positions` uses an INTEGER `account_id` that FK's to `trading_account_config.id`. Any cross-table join for dividend enrichment must bridge this mismatch.

### 2026-05-11 — Dividend data lives in 4 separate tables

**Context:** `dividend_positions` (manual ticker/shares), `dividend_ticker_data` (cached market data), `dividend_payments` (IBKR payment history), `dividend_accruals` (217 rows). The positions-as-source-of-truth directive consolidates the position source to `stock_positions`, making `dividend_positions` redundant for the main view.

### 2026-05-01 — Supabase Branching vs 2-Project Model

**Context:** User questioned whether `trading-journal-dev` should be replaced by Supabase's Branch feature, visible in the dashboard.

**Key Findings:**
- **Branching is a Pro-only paid feature.** Free plan explicitly shows "Not included" for Branching. Rate: `$0.01344/branch/hour` (~$9.68/month for 24/7 persistent branch).
- **Branch types:** Ephemeral (tied to PR, auto-deleted on merge/close) vs Persistent (long-lived staging/dev). Both require Pro+.
- **What branches clone:** Schema migrations, API credentials, Auth config, Storage buckets (empty). What they do NOT copy: production data, auth users, storage objects, vault secrets.
- **Data-less design:** Branches intentionally start empty to protect production data. Seeding only via `seed.sql`.


---

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

### 2026-05-15 — Cash Flow Dividend Redesign Architecture

**Requested by:** Jony Vesterman Cohen
**Work:** Produced comprehensive architecture design for 3 cash flow improvements: (1) monthly/yearly display toggle, (2) replace plan-configured yields with real per-account dividend data, (3) visualize dividend reinvestment in Sankey.

**Key architectural findings:**
- `getDividendSummary()` already provides per-account breakdown (ibkr, schwab, ira) — no worker changes needed
- Current `DividendIncomeTotal` interface must change to `DividendIncome` with per-account structure
- Simulation must emit 3 separate dividend income nodes + 3 reinvestment flows (bypassing "Net Savings" node)
- AccountManager dividend logic must be disabled for accounts with real data (backwards compatibility via `use_real_dividends` flag)
- Deficit year semantics require clarification (should dividends reduce deficit before withdrawals?)
- Monthly/yearly toggle recommended as display-only (÷12 divisor at render time, not simulation rerun)

**Files analyzed:**
- `simulation.ts` (DividendIncomeTotal interface, AccountManager dividend logic, processSavings/processDeficit, projection loop)
- `cash-flow/page.tsx` (state management, simulation invocation, summary cards)
- `CashFlowSankey.tsx` (income/savings node rendering, Sankey structure)
- `dividends/actions.ts` (getDividendSummary data source)
- `plan/page.tsx` (dividend yield config UI)

**Precedents applied:**
- Options Income Estimation pattern (virtual income streams, multiple Sankey nodes)
- Round 8 currency contract (USD major units, no ÷100 conversion)
- Stacked-Branch protocol (merge sequencing)

**Open questions for Jony:**
1. Trailing 12-month vs. forecasted dividend data?
2. Does getDividendSummary() distinguish paid vs. reinvested dividends?
3. Dividend-offset-deficit semantics (Option A vs B)?
4. Monthly toggle display-only or affect calculations?
5. Plan page yield config UI treatment (hide, remove, or deprecate)?
6. Gradual rollout (per-account `use_real_dividends` flag)?

**Sequencing:**
- Phase 1: Data contract + simulation engine changes (data structure, 3-node emission, reinvestment logic)
- Phase 2: Sankey visualization updates (3 dividend nodes, 3 reinvestment edges)
- Phase 3: Monthly/yearly toggle (independent, can merge in parallel)
- Phase 4: Plan page integration (conditional yield config visibility)

**Decision file:** `.squad/decisions/inbox/keaton-cashflow-dividend-redesign.md`
**Estimated scope:** ~300-400 LOC across 4 frontend files, no worker changes

### 2026-05-18 — Dividend Redesign Consolidated Approval Document

**Requested by:** Jony Vesterman Cohen
**Work:** Synthesized 5 agent design documents (Keaton architecture, Fenster UI, McManus simulation, Hockney backend audit, Redfoot test plan) into unified approval gate with 8 open questions.

**Key synthesis findings:**
- Resolved 4 naming/strategy conflicts (reinvestment labels, toggle persistence, tax treatment, account mapping)
- Backend confirmed no worker needed — `getDividendSummary().by_account` already exists
- Total scope: ~400-500 LOC production code + ~450 LOC tests = ~795 LOC
- 28 new test cases planned across simulation/component/integration layers
- Recommended stacked PR strategy: PR#1 (simulation) → PR#2 (toggle, independent) → PR#3 (Sankey) → PR#4 (plan page) → PR#5 (regression)

**Approval document:** `.squad/decisions/inbox/keaton-consolidated-approval.md` (458 lines, 8 open questions for Jony)

**[2026-05-18 22:35] Code review: cash-flow dividend redesign implementation**
- Reviewed: commits 6f5fd5d, 09cd6c1, 9c42238, 514f16d on squad/cashflow-dividend-redesign
- Verdict: REJECT
- Findings: 2 critical / 5 important / 2 nits
- See: `.squad/decisions/inbox/keaton-review-cashflow-impl.md`

### 2026-05-18 — PR #393 Next 16 Migration Review (Round 3 Gate)

- Verdict: REJECT — `eslint.config.mjs` FlatCompat wrapper crashes with `eslint-config-next@16` native flat config (circular reference in @eslint/eslintrc). `npm run lint` broken; CI lint job will fail. Fixer: Kujan.

### 2026-05-18 — PR #393 Next 16 Re-Review (Round 5 Gate)

- Verdict: APPROVE — Kujan's `f7b59f4` resolves FlatCompat blocker. Native flat config import, `.next/` ignores, `@eslint/eslintrc` removed. Lint/test/build all match baseline. eslint@10 blocked upstream (`eslint-plugin-react` uses removed `context.getFilename()`); documented for #459.

2026-05-18: When a vendored plugin uses a deprecated API, the upgrade is blocked on the vendoring package (eslint-config-next) — always verify transitive plugin compat before approving major eslint bumps.

## Reviews

### 2026-05-19 — PR #461 Flex Sync Fixes (Round 2 Gate)

- **Verdict:** APPROVE — 0 must-fix / 2 should-fix / 2 nits
- **PR:** Fix orphaned E2E account FK violation + `last_synced` write-through from Flex path
- **Key findings:**
  1. Migration predicate (`NOT IN (SELECT id FROM households)`) only cleans hard-deleted households; the `_load_accounts()` guard additionally filters soft-deleted households. No current production impact, but latent warning-log churn if a soft-deleted household config is introduced. Should align migration to match guard semantics.
  2. `_update_config_last_synced()` placed inside inner `for parsed_account_id` loop — redundant UPDATEs in wildcard mode (N calls per config). Harmless but should be hoisted to outer loop.
  3. Worker redeploy gate flagged — PR touches `apps/backend/app/worker/**`; `./scripts/rebuild-worker.sh` mandatory post-merge.
- **Strict lockout respected:** Hockney not proposed as fix author. No code modified.
- **Pattern:** When a migration and a runtime guard address the same class of bad data, verify they use the same predicate (e.g., both treat soft-deleted households as "missing"). Mismatches produce perpetual warning noise even after the migration runs.
