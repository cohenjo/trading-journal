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
