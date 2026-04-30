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
