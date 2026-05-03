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

### 2026-04-30: First Supabase Migration Files (TJ-005)
- **Context:** Turned runbook §4–§5 SQL into three ready-to-apply migration files under `supabase/migrations/`.
- **Deliverables:** `20260430120000_households_and_members.sql`, `20260430120100_rls_helpers.sql`, `20260430120200_rls_policies_households.sql`, `supabase/migrations/README.md`.
- **Key choices:** ON DELETE CASCADE on both `households` and `household_members` FK refs to `auth.users`; hard-delete policies use `using (false)` to enforce soft-delete discipline (deviation from task spec); enum named `household_role` (runbook) not `household_member_role` (data-arch doc).
- **Security note:** Helper functions are `security definer` with explicit `SET search_path = public, auth` to prevent search-path injection; EXECUTE revoked from PUBLIC and granted to `authenticated` only.
- **Status:** Schema not yet locally tested — must run `supabase db reset` before remote push.

### 2026-05-03: Supabase Auth + RLS Runbook
- **Context:** Narrowly scoped implementation runbook covering Google OAuth wiring, Households+Members schema, RLS helper functions and policies, invite flow schema and token-hash pattern, and common pitfalls.
- **Deliverable:** `docs/design-hosting/runbooks/supabase-03-auth-rls.md` (~300 lines, copy-pasteable SQL migration block included).
- **Flags:** Google Console does not support wildcard authorized origins — each preview URL must be registered explicitly. Supabase redirect-URL wildcard syntax should be verified against current docs. Free-tier email rate limit (3/hr) may constrain invite emails at scale.
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md

### 2026-04-30 — YOLO Direct-Apply Round: TJ-022 Sharing RLS + 581 pgTAP Tests

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)
**Work:** Implemented 5 SECURITY DEFINER helper functions with `SET search_path = public, pg_temp` (stricter than design spec) to prevent temp-table injection. Built comprehensive 581-line pgTAP test suite validating all RLS scenarios. Documented 4 key tradeoffs: search_path convention, household hard-delete limits, cooked-table write-access coexistence, trigger firing order safety.

**Key Insight:** Strict search_path configuration provides defense-in-depth; pgTAP is essential for RLS correctness validation at scale.


📌 **Team update (2026-04-30T22-16-38Z):** RLS-21 dev+prod merge complete — PR #98 (21 public tables + drop secrets) merged to main (9ec4d2b), 18 migrations applied to prod (jaesiklybkbmzpgipvea), 0 rls_disabled_in_public advisor errors verified. Issue #97 closed. Cross-agent RLS coverage now extends to all 21 public tables. — Rabin (author), Keaton (reviewer), Hockney (prod apply), Redfoot (E2E coverage opportunity)

### 2026-05-01: RLS Coverage Audit — Frontend-Direct CRUD Targets
- **Context:** Jony requested pre-Phase-3 verification that frontend-direct CRUD targets have RLS protection before backend no longer injects household_id.
- **Scope:** 9 tables (finance_snapshots, plans, dividend_positions, dividend_accounts, insurance_policies, bond_holdings, optioncontract, trade/execution/manualtrade/matchedtrade).
- **Key findings:**
  - ✅ All 9 tables have RLS enabled with full 4-policy coverage (SELECT/INSERT/UPDATE/DELETE)
  - ✅ All use household-scoped pattern with `is_household_member()` and `is_household_writer()` helpers
  - ✅ Helpers include soft-delete boundary check (`households.deleted_at IS NULL`)
  - ❌ No database-level auto-injection of household_id (no triggers, no current_setting); backend injects via `get_user_household_id()`
  - ⚠️ When frontend-direct lands, frontend MUST always pass household_id (client-provided); RLS validates ownership
- **Critical insight:** household_id is NOT auto-set by database; frontend and backend both must inject it from session context. If frontend omits household_id or sends malicious value, RLS will reject (good), but frontend type system must enforce required UUID field to prevent accidental omission.
- **Top 3 risks:** (1) malicious client crafts household_id not from session → RLS rejects (mitigated) (2) frontend omits household_id → RLS rejects (mitigated by type system) (3) viewers escalate via role check → RLS enforces role (mitigated).
- **Deliverable:** `docs/design-hosting/rls-coverage-audit.md` (comprehensive per-table checklist, pre-Phase-3 readiness, 3 actionable risks, 6-item mitigation checklist).
- **Status:** Complete; ready for Keaton/Hockney/Jony review.

📌 Team update (2026-05-02T09:03:04Z): DB-trigger SECURITY DEFINER is canonical for cross-RLS provisioning. When inserting on behalf of user (e.g., household_members), only SECURITY DEFINER functions can bypass RLS. Applies to user signup provisioning: handle_new_auth_user (profile) and handle_new_user_household chains. — Coordinator
### 2026-05-03: Security Incident INC-2026-05-03-001 — Supabase Service-Role Key Leak

- **Context:** GitHub secret-scanning alert #1 fired. Supabase service-role key for project `zvbwgxdgxwgduhhzdwjj` found in `.squad/decisions.md` on `origin/main`.
- **Investigation findings:**
  - Key first introduced: commit `5a75bd1` (2026-05-01 01:52) in E2E test file + `.secrets/` directory (local branch `squad/wave1-all-pages` — never pushed to remote)
  - Key propagated to `main`: via `.squad/decisions/inbox/` session-log shell snippets merged by Scribe into `decisions.md`
  - Key confirmed in `origin/main` tip (`c3c38fa`) in `.squad/decisions.md` at line 2977
  - Additional credentials exposed (local branch only): Google OAuth client secrets (dev + prod), Vercel 2FA recovery codes, E2E test user password
  - `.secrets/test-user-redfoot.txt` was still tracked in git HEAD — untracked in this PR
  - `.gitignore` had `**/secrets/**` but NOT `.secrets/` — leading-dot variant added
- **Actions taken (Rabin security lead):**
  - Redacted service-role key + anon key from working tree (superseded by branch evolution on `squad/secret-scan-hardening`)
  - Untracked `.secrets/test-user-redfoot.txt` via `git rm --cached`
  - Added `.secrets/` and `docs/security/**` exception patterns to `.gitignore`
  - Filed incident report: `docs/security/incident-2026-05-03-supabase-service-role.md`
  - Filed policy: `.squad/decisions/inbox/rabin-secret-handling-policy.md`
  - Created sign-off GitHub issue for Hockney + Kujan
  - Confirmed GitHub push protection: ✅ already enabled
- **History rewrite decision:** NOT recommended. Service-role key is a rotatable JWT — rotation invalidates it. Rewrite only if forensic evidence of unauthorized use found in Supabase audit logs.
- **Policy codified:** Secrets in `.env.local` only; `.env.example` placeholders only; pre-commit gitleaks; push protection enabled; service-role keys rotated on every leak.
- **PR:** `squad/secret-scan-hardening` → `security: incident report + remediation tracker (Supabase service-role rotation)`
