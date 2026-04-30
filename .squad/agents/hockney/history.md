# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary (Feb-Mar 2026)

**Initial Audit Findings:**
- Float usage for all monetary calculations — needs Decimal migration
- Missing Pydantic validation on API endpoints
- Insufficient error handling (5 HTTPExceptions found across codebase)
- Security exposure: plaintext .env credentials in git, CORS wide open (allow_origins=["*"])
- Limited test coverage for financial calculations
- Logging inconsistency across modules

**Early Q2 Work:**
- Participated in Financial Precision & Type Safety consolidation (Feb 23)
- Security Hardening review completed (Feb 23)
- Testing & QA planning (Feb 23)
- API Documentation & DevOps planning (Feb 23)
- Started codebase baseline work March-April

**Architecture Notes:**
- Good Alembic migration history (19+ versions)
- SQLModel/SQLAlchemy patterns generally sound
- Service layer separation exists (data_ingestion, dividend_service)
- OpenTelemetry instrumentation setup in place

---

## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Vercel project setup runbook (2026-05-01):** Authored `docs/design-hosting/runbooks/vercel-01-project.md` — covers CLI install/auth, monorepo link (`apps/frontend/`), `vercel.json` with security headers, REST API project creation, env var wiring for all three target envs (production/preview/development), bulk import loop, local dev `.env.local` precedence, GitHub repo connection, and inspect/pull commands. Also added `.vercel` to repo `.gitignore`. ⚠️-flagged: `vercel git connect` interactivity and bulk `<` import unsupported in current CLI — documented loop workaround.
