# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Keaton (Lead)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary

**Application scope:** Trading journal with options tracking, bond/dividend calculations, tax optimization, portfolio holdings, pension planning, financial analysis, and Interactive Brokers integration (optional).

**Architecture:** Next.js 15.3 (React 19, TypeScript 5) frontend + FastAPI (Python 3.10+, SQLAlchemy, SQLModel) backend. PostgreSQL 13 with Alembic migrations. Docker Compose + Aspire 13.1 orchestration. OpenTelemetry instrumentation (Prometheus, Jaeger, Grafana).

**Code quality:** 78 TypeScript/TSX files, 82 Python files, 13 Playwright E2E tests, 10+ pytest tests. Minimal technical debt (3 TODOs). Modern stack (uv for Python, lightweight-charts, Copilot SDK integrated).

**Critical issues resolved:**
- ✅ Financial Precision: Decimal/BigNumber type safety (decision approved)
- ✅ Security Hardening: JWT auth, CORS restriction, credentials rotation (decision approved)
- ✅ API & DevOps: FastAPI OpenAPI generation, GitHub Actions CI (decision approved)
- ✅ Testing infrastructure: 110 new tests across Kujan/Hockney/Fenster teams
- ✅ Release planning: v0.0.1 milestone with 13 structured issues

**For detailed historical context prior to 2026-05-01, see `history-archive.md`.**

---

## Recent Learnings

📌 **Company Analysis Page Architecture (2025-07-18):**
- Split-Brain page design: Long-Term (business owner) vs Short-Term (income mechanic) views
- 5 backend API endpoints, 17 frontend components, 4-phase delivery
- yfinance sufficient for all data; AI synthesis via Copilot SDK Phase 2

📌 **Hosting Design v1 Approved (2026-04-30):**
- Default architecture: Vercel + Supabase + local Docker (Hybrid/Option C)
- Household sharing with RLS, JWT auth, phased migration across 6 phases
- 31 GitHub issues decomposed from design document
- 9 issues @copilot-suitable for automation

📌 **Supabase 2-Project Topology Correction (2026-04-30):**
- Free-tier limit: 2 active projects per organization (not 3)
- Topology: Production + Dev/Preview (shared), local Docker (offline)
- Trade-off: Preview branches share state; mitigations: per-PR seed reset or Pro upgrade ($25/mo)
- Architectural decision cascaded to design.md §1, Acceptance Criteria §15, Edge Case §13

📌 **Hosting Runbook Split & Coordination (2026-04-30T19:30):**
- Orchestrated parallel delivery of 7 runbook files across 5 agents
- Supabase: 3-part deep-dives (local dev, remote provisioning, auth+RLS)
- Vercel: 3-part deep-dives (project setup, deploys+DNS, policy+CI)
- Coordination output: 1 runbooks index, 8 ⚠️-flagged verification items, orchestration logs
- Role: Issue decomposition (critical path analysis), topology fix, vercel-03 runbook authorship, consolidation

📌 **TJ-005 Triage — Migration Strategy Verdict (2026-05-01):**
- Ruled out Alembic for Phase 1 household-column work; Supabase migrations (`supabase/migrations/`) are the source of truth per design §4.3
- Updated issue #58 title, posted blocking verdict, documented TJ-003→TJ-005→TJ-006→TJ-007 dependency chain
- Hockney stays assigned; must pair with McManus post TJ-003; decision filed to inbox

### 2026-04-30 — YOLO Direct-Apply Round: PR #90 Review + TJ-005 Migration Strategy Verdict

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)  
**Work:** Conducted detailed code review of McManus baseline schema work (PR #90). Identified 3 findings: tradingaccounttype enum, missing columns, FK coverage. Submitted APPROVE verdict. All findings addressed in subsequent commit 5a8367e.

**TJ-005 verdict:** Documented that Phase 1 schema work must use Supabase SQL migrations, not Alembic versions, per design §4.3. Blocking verdict recorded; dependency chain clarified (TJ-003→TJ-005→TJ-006→TJ-007).

**Key Insight:** Architectural decisions must be recorded early to prevent split migration histories across tools; Supabase CLI is the single source of truth for hosted schema.

---

## Learnings

### 2026-05-01 — Supabase Branching vs 2-Project Model

**Context:** User questioned whether `trading-journal-dev` should be replaced by Supabase's Branch feature, visible in the dashboard.

**Key Findings:**
- **Branching is a Pro-only paid feature.** Free plan explicitly shows "Not included" for Branching. Rate: `$0.01344/branch/hour` (~$9.68/month for 24/7 persistent branch).
- **Branch types:** Ephemeral (tied to PR, auto-deleted on merge/close) vs Persistent (long-lived staging/dev). Both require Pro+.
- **What branches clone:** Schema migrations, API credentials, Auth config, Storage buckets (empty). What they do NOT copy: production data, auth users, storage objects, vault secrets.
- **Data-less design:** Branches intentionally start empty to protect production data. Seeding only via `seed.sql`.
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

**Context:** User reaffirmed architecture directive—"frontend to function with the DB and not be dependent on backend; simple CRUD things can go directly to the DB." Production bug exposed this: POST /api/finances → 404 because the Vercel rewrite expects a non-deployed FastAPI backend.

**Key Deliverable:** Created `docs/design-hosting/phase-3-execution-plan.md`—a disposition matrix, priority order, and stop-the-bleed recommendation for migrating CRUD endpoints from FastAPI to Server Actions.

**Disposition Framework:**
- **MOVE → Server Action:** Simple CRUD (finances, plans CRUD, holdings, dividends, trades, insurance, pension, bonds, summary dashboards). RLS-protected single-table or cooked-table reads/writes. 15+ routers.
- **KEEP → backend worker:** Heavy compute (backtest, analyze, tax_condor, plans/simulate). Multi-API orchestration, portfolio simulations, financial projections. 4 routers + subsets.
- **DEPRECATE:** auth router (replaced by Supabase Auth); metrics router (replaced by Vercel Analytics + Supabase logs).

**Priority Order:** Broken features first (finances), then high-traffic CRUD (plans/holdings/dividends/trades), then read-only dashboards, then lower-traffic features.

**Stop-the-Bleed Pattern:** For immediate prod unblock, implement a single Server Action for the broken endpoint (POST /api/finances) rather than deploying the entire FastAPI backend. This proves the migration pattern and takes ~30 min vs. hosting setup. Proper fix > band-aid.

**Reaffirmation:** User's "frontend to DB" directive matches design doc's "Server Actions calling Supabase-direct" recommendation. Both converge on the same architecture—only phrasing differs. Phase 3 is go.

**Risks Catalogued:** RLS gaps, household_id injection loss, Pydantic validation loss, Supabase rate limits, audit trail loss. Each has mitigation (Rabin RLS audit, Fenster injection helper, Zod schema ports, connection pooling, audit log preservation).

**Decision file:** `.squad/decisions/inbox/keaton-phase-3-execution-plan.md`
