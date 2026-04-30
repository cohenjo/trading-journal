# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Rabin (Security Engineer)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

### 2026-02-23: Initial Security Review
- **Context:** First comprehensive security review of trading journal codebase
- **Findings:** Identified critical vulnerabilities: exposed credentials in `.env`, zero authentication/authorization across all API endpoints, unrestricted CORS policy
- **Impact:** Application not production-ready; 17 API modules completely unprotected
- **Key Concerns:** 
  - Interactive Brokers credentials in plaintext (live & paper accounts)
  - All financial data accessible without authentication
  - CORS allows any origin with credentials
  - No rate limiting on financial operations
- **Recommendations:** 3-week security hardening plan prioritizing credential rotation, JWT authentication, CORS restrictions, and security headers
- **Positive Notes:** Good foundation with SQLModel ORM, Pydantic validation, proper .gitignore structure
- **Decision:** Created detailed findings document for team review and action planning

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL: credentials exposed in git, zero authentication across 17 API endpoints, unrestricted CORS, missing security headers. Week 1 actions: rotate credentials immediately, implement JWT auth, restrict CORS, add security headers middleware. Application MUST NOT be deployed to production in current state. Estimated 2-3 weeks to production-ready. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety - Both frontend and backend use unsafe numeric types causing precision risks. Quality gate required: all PRs must use Decimal/BigNumber for monetary operations. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Testing and Quality Assurance - CI/CD pipeline and comprehensive test suite needed for financial calculations and security validation. — Fenster, Hockney, Keaton

### 2026-04-30: Supabase Auth and Household Sharing Design
- **Context:** Auth migration design for Google OAuth and spouse/household sharing in a sensitive personal finance and trading app.
- **Recommendation:** Use Supabase Auth with Google OAuth and Postgres RLS, backed by `households`, `household_members`, single-use invite tokens, and role-based owner/member/viewer permissions.
- **Security guardrails:** No tokens in localStorage; prefer server-managed secure cookies via `@supabase/ssr`; use anon-key + per-request JWT for user-scoped data so RLS applies; reserve service-role key for audited backend-only jobs.
- **Deliverables:** Wrote `docs/design-hosting/sections/03-auth-sharing-security.md`, generated `docs/design-hosting/diagrams/03-auth-sharing-flow.excalidraw`, and drafted `.squad/decisions/inbox/rabin-auth-sharing.md`.

### 2026-05-01: Unified Hosting Design Security Review
- **Context:** Reviewed `docs/design-hosting/design.md` against Rabin's auth/security section, data architecture RLS coordination, and backend service-role handling guidance.
- **Verdict:** Approved with conditions; no fatal architecture blocker, but implementation readiness depends on tightening service-role/direct DB credential wording, household lifecycle controls, invite revocation/replay details, threat model coverage, and free-tier backup/pausing guarantees.
- **Deliverable:** Wrote `docs/design-hosting/reviews/rabin-review.md` with corrected canonical RLS helper/policy snippet and owner assignments for Keaton, Rabin, Hockney, Kujan, and McManus.

📌 Team update (2026-04-30T15:00:37Z): Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.
