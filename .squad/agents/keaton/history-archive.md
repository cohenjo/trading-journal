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
