# Hockney Revision Summary — design.md

**Requested by:** Jony Vesterman Cohen  
**Date:** 2026-05-01  
**Scope:** Revision of `docs/design-hosting/design.md` in place after Rabin, Redfoot, and Kujan reviews.

## Rabin findings

- **Service-role vs direct Postgres credentials:** Addressed in §§4.1, 9, 10, 16, and 17. Server Actions now default to user-scoped clients; privileged secrets are limited to protected CI/local worker/admin contexts; worker direct DB credentials are distinguished from Supabase service-role API keys; privileged writes require audit.
- **Household lifecycle controls:** Addressed in §5. Added at-least-one-owner invariant, soft leave/removal via `left_at`, owner-only role/removal flows, breakup/divorce offboarding semantics, and role-change transaction re-checks.
- **Invite table and replay protections:** Addressed in §5. Added `household_invites` schema, normalized email, non-owner role constraint, expiry/revoke/accepted checks, rate limiting, generic error behavior, owner revocation, duplicate/reciprocal invite handling, and audit.
- **Threat model compression:** Addressed in §16. Expanded the risk table to include XSS/token theft, OAuth open redirects, invite replay, role escalation, CSRF, financial log leakage, soft-deleted data, and ex-member access.
- **Free-tier pausing and backup guarantees:** Addressed in §§4.3, 6, 8, 13, and 16. Added plan-dependent backup language, encrypted local `pg_dump` from Phase 1, restore rehearsal, and inline user-verification warnings for Supabase pause/retention behavior.
- **Section 06 inconsistency with chosen RLS helper:** Addressed in §17 as a reviewer re-check item for McManus; the primary design now carries the canonical schema/RLS starting point.
- **GitHub Actions cron service-role boundaries:** Addressed in §§9, 10, and 16. Actions may use only minimum Supabase secrets and never broker desktop/session material.
- **Corrected RLS snippet:** Applied in §5 with helper functions, grants/revokes, forced RLS, select/insert/update/deleted-owner policies, and immutable audit/ownership guidance.

## Redfoot findings

- **Blocking — no executable phase gates:** Addressed in §11 with phase-by-phase executable proofs across pytest, Vitest, Playwright, SQL assertions, migration smoke, and manual/CI checks.
- **Blocking — identity linking undecided:** Addressed in §§13 and 17. Initial migration is Google OAuth only; email fallback is deferred until identity linking proves one canonical user id per verified email.
- **Blocking — preview-to-production data leakage:** Addressed in §§9, 11, 13, 15, and 17. Preview deploys must use preview/dev Supabase only, with CI checks against production refs.
- **Blocking — worker/migration concurrency undefined:** Addressed in §§9, 12, 13, 15, and 17. Added worker drain/advisory-lock protocol and rehearsal.
- **Important — rollback not rehearsable:** Addressed in §12 with dry-run procedure and success criteria for every phase.
- **Important — observability too passive:** Addressed in §§4.6 and 14. Added `compute_runs`, `household_refresh_state`, UI banners, nightly stale-data checks, GitHub Actions summaries, and owner email alerts.
- **Important — local-dev parity / bug reproduction:** Partially addressed in §11 by requiring Supabase local/dev RLS/auth tests and sanitized seed data. A fuller runbook remains an implementation-doc follow-up.
- **Important — invite race conditions:** Addressed in §§5, 11, and 13 with duplicate/reciprocal invite rules and transaction tests.
- **Important — removed-member semantics:** Addressed in §§5, 11, 13, and 15 with access loss, shared-row retention, private-row protection, and acceptance tests.
- **Important — Supabase pause/resume and connection limits:** Addressed in §§8, 11, 13, and 16 with retry/idempotency tests and user-verification notes.
- **Important — cooked-table correctness:** Addressed in §§6, 11, 13, 14, and 15 with reconciliation totals before successful publish.

## Kujan findings

- **Local Docker → Supabase reliability:** Addressed in §§4.4, 9, 11, 13, and 16. Added `pool_pre_ping=True`, timeouts, healthcheck, `restart: unless-stopped`, exponential reconnect/backoff, and retry/idempotency requirements.
- **Supabase free-tier pause + backup survival:** Addressed in §§4.3, 6, 8, 13, and 16. Added encrypted local `pg_dump` offload from Phase 1, restore rehearsal, and user-verification warning.
- **Clerk secret remnant:** Addressed in §§10 and 17 by removing Clerk secret configuration from the recommended path.
- **Preview deploy OAuth callback feasibility:** Addressed in §§9, 11, 13, and 17. Added custom-domain prerequisite, stable callback spike, and reviewer re-check.
- **Connection pooling split not wired:** Addressed in §§4.4, 9, 10, 11, and 16. Added direct vs pooled URL env examples and `statement_cache_size=0`.
- **Custom domain timing:** Addressed in §9 and kept as an open Jony decision in §17 before Phase 2.

## Deferred / needs user verification

- Supabase free-tier pause behavior, backup retention during pause, restore procedure, and current pricing limits must be verified against current Supabase docs before Phase 1 production cutover.
- Vercel plan suitability and custom-domain choice still need Jony input before Phase 2.
- Section files are not rewritten in this revision except by reference; Section 06 still needs McManus alignment before migrations are implemented.
