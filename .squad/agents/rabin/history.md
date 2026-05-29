# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Rabin (Security Engineer)
- **Created:** 2026-02-23T22:46:19Z

## Summary of Work

### Phase 0: Security Foundations (Feb–May 2026)

**Initial Assessment (2026-02-23):** Identified critical vulnerabilities in initial codebase: exposed credentials (IB accounts), zero authentication across 17 API endpoints, unrestricted CORS, missing security headers. Recommended 2–3 week hardening plan.

**Auth & RLS Design (2026-04-30):** Led architecture design for Supabase Auth + household sharing. Wrote comprehensive runbook, migration files, and pgTAP test suite (581 tests). Established security definer patterns for RLS helper functions with strict `search_path` configuration (`public, pg_temp`).

**RLS Audit & Coverage (2026-05-01–05-13):** Verified 9 frontend-direct CRUD targets have full RLS protection. Discovered and fixed RLS anti-pattern: enabled RLS on reference tables (`security_reference`, `tase_yahoo_map`) per canonical pattern (RLS enabled + permissive SELECT, not disabled).

**Incident Response (2026-05-03):** Handled security incident INC-2026-05-03-001 — Supabase service-role key leaked in `.squad/decisions.md`. Rotated key, hardened `.gitignore`, filed incident report, established secret-handling policy (secrets in `.env.local` only, pre-commit gitleaks, push protection enabled).

**Supabase Platform Changes Review (2026-05-14):** Reviewed Supabase announcements (default grants removal, API security, @supabase/server). Identified 30 legacy tables with anon grants (enforce Oct 30 deadline) and P0 fix for `household_audit_log`. Drafted conventions for explicit grants, JWT migration, and reference-table SELECT-only pattern.

### Key Learnings

1. **RLS Correctness:** Strict `search_path` configuration (`public, pg_temp`) prevents temp-table injection. All SECURITY DEFINER helpers must use explicit paths. pgTAP is essential for RLS scenario validation.

2. **Reference Data Pattern:** Global reference data (no household_id) should have RLS ENABLED + permissive SELECT policy (using `true`), NOT disabled. This satisfies Supabase advisor requirements and maintains audit compliance.

3. **Secret Handling:** Rotate service-role keys on every leak (they're JWTs). Pre-commit scanning + push protection + `.env.local` discipline prevent most exposure. History rewrite not necessary if key rotation invalidates it.

4. **Household Lifecycle:** household_id is NOT auto-set by database; both frontend and backend must inject from session context. RLS validates ownership; type system must prevent omission.

5. **Anon Access:** Never grant anon SELECT on sensitive tables (even with RLS). Reference tables are OK with RLS + permissive policy. 30 legacy tables need backfill by May 20. P0: `household_audit_log` revoke.

6. **JWT Security:** Legacy HS256 keys (symmetric) should migrate to asymmetric before Oct 30. Frontend (@supabase/ssr) + backend review both needed.

### Active Decision Merges

- `rabin-auth-sharing.md` (merged 2026-04-30)
- `rabin-secret-handling-policy.md` (merged 2026-05-03)
- Supabase platform changes consolidated into main decisions (2026-05-14)

---

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL: credentials exposed in git, zero authentication across 17 API endpoints, unrestricted CORS, missing security headers. Week 1 actions: rotate credentials immediately, implement JWT auth, restrict CORS, add security headers middleware. Application MUST NOT be deployed to production in current state. Estimated 2-3 weeks to production-ready. — Keaton, Hockney, Rabin

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Team update (2026-05-02T09:03:04Z):** DB-trigger SECURITY DEFINER is canonical for cross-RLS provisioning. When inserting on behalf of user (e.g., household_members), only SECURITY DEFINER functions can bypass RLS. Applies to user signup provisioning: handle_new_auth_user (profile) and handle_new_user_household chains. — Coordinator

📌 **Team update (2026-05-05T18:32:37Z):** Secret handling policy decision merged into shared decisions. Reskill pass extracted secret-handling-policy skill (high confidence) with defense-in-depth patterns, pre-commit scanning, push protection, and rotation response. — Scribe (wind-down)

📌 **Team update (2026-05-13T18:32:37Z):** RLS migration for reference tables (`security_reference`, `tase_yahoo_map`) successfully applied to remote Supabase. Migration follows correct security pattern: RLS enabled, SELECT policies for authenticated users, no anonymous access, service_role retains ALL privileges. Supabase advisor ERROR-level security findings now cleared.

📌 **Team update (2026-05-14T19:40:00Z):** Supabase security review complete — 30 anon-exposed tables + household_audit_log P0 fix + JWT migration to June. Recommendations merged into shared roadmap. — Rabin

📌 **Team update (2026-05-29T122212Z):** Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.
