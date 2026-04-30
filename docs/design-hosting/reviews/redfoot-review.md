# Redfoot Test/Risk Review — design.md

## Verdict: CHANGES REQUESTED

## Summary
The unified hosting design is directionally sound and gives the team a realistic low-cost migration path, but it is not yet testable enough to approve as an execution plan. The document names the right risk areas — RLS, Supabase Auth, local workers, migration rollback, preview deploys — yet several phase exits are stated as outcomes without specifying executable proofs, fixtures, failure drills, or observable signals. For a financial application where household access and derived balances are safety-critical, the migration plan needs explicit acceptance tests, rollback rehearsals, and stale/failed refresh visibility before implementation begins.

## Test Plan Critique
The design mentions PR validation, existing frontend/backend tests, RLS integration tests, Playwright auth flows, row-count checks, and financial-total parity, but it does not convert those into a phase-by-phase test matrix. Most proposed tests are writable with the current stack, but the plan should name them as required gates:

- **Phase 0 — Validate & Freeze:** Done should be proven by `pytest` for migration/backfill helpers, Alembic upgrade/downgrade against local Docker Postgres, and financial parity assertions on trades, matched trades, daily summaries, finance snapshots, plans, insurance, pensions, and positions. Vitest should cover any frontend assumptions added for household context. Missing: fixture dataset definition, before/after expected totals, and downgrade data-loss expectations.
- **Phase 1 — Database Cutover:** Done should require pytest integration tests against a Supabase-like Postgres target or Supabase local/dev project for RLS denial-by-default, household isolation, owner/member/viewer permissions, ex-member denial, and service-role audit paths. Also require migration smoke tests using direct connection versus pooled URL. Missing: repeatable sanitized snapshot load test, connection-limit stress smoke, backup/restore proof, and RLS policy test harness.
- **Phase 2 — Vercel + Supabase Auth:** Done should require Playwright tests for Google OAuth/mocked auth callback, signin redirects, session refresh, invite acceptance, expired invite, wrong account, sign-out cache clearing, and protected-route denial. Vitest can cover middleware path classification and safe redirect validation. Missing: preview callback test plan, account-linking behavior, and browser-cache/private-page regression tests.
- **Phase 3 — CRUD Migration:** Done should require one contract test per migrated FastAPI endpoint showing old and new behavior match, Server Action unit/integration tests for validation and RLS, and Playwright coverage for the user workflows that moved. Missing: endpoint-by-endpoint checklist with rollback toggle, parity assertions for financial calculations, and proof that deprecated FastAPI routes are no longer called.
- **Phase 4 — Operationalize Workers:** Done should require pytest tests for job claiming, idempotency, retry, partial failure, publish-only-on-success, stale-state transitions, and direct DB write behavior during network loss. Playwright should verify user-visible stale/failed/refreshing states. Missing: deterministic worker fixtures, pause/resume simulation, migration-while-worker-running drill, and alerting tests.

Current stack fit is good: Vitest for frontend helpers and Server Action validation boundaries, pytest for Alembic/data/worker/RLS integration tests, and Playwright for auth/invite/household and stale-data journeys. The document should explicitly require a Supabase dev/local mode for RLS tests because local Docker Postgres alone cannot reproduce Supabase Auth/session behavior.

## Edge Cases Not Addressed
- **Spouse joins household, writes data, then is removed:** Section 03 states `left_at` removes access and keeps attribution, but the unified doc does not define ownership semantics for records they authored. Tests must prove their shared financial rows remain visible to active household members, their private rows become inaccessible, audit attribution is anonymized or retained per policy, and they cannot mutate or restore prior records after removal.
- **Two users invite each other simultaneously:** No conflict policy is defined. The plan needs a uniqueness/transaction rule for reciprocal invites, duplicate households, and accepting an invite while another pending invite exists. Tests should cover two users creating households and cross-inviting at the same time.
- **Expired magic link/invite:** The invite flow checks expiry, and frontend copy mentions expired invite, but there is no required test that expired links cannot be accepted, do not leak account existence, and can be replaced safely by a new invite.
- **Google sign-in, then email sign-in:** The design allows email/password fallback but does not decide whether the same email maps to one Supabase identity, linked identities, or two accounts. This is a blocking product/security decision because duplicate identities can split household membership and data access.
- **Supabase project paused and resumes:** The worker reliability section mentions idempotency generally, but not Supabase free-tier pause/resume. Tests must simulate connection refusal/timeouts and verify local Docker jobs retry from `queued/running` safely without losing raw writes or publishing partial cooked data.
- **Migrations while local Docker is mid-write:** The design says Alembic uses direct URL but does not define a worker drain/lock protocol. Need tests or dry runs for migration lock acquisition, worker pause, in-flight transaction behavior, FK changes while raw rows are being inserted, and recovery from a failed migration.
- **Vercel preview deploys hitting production Supabase:** The design recommends dev/prod projects but does not make this a hard gate. Preview environments must never use production Supabase by default. CI/Vercel environment tests should fail if preview variables point at production refs or if preview OAuth state can write production household data.
- **Cooked refresh succeeds with wrong totals:** Publish-only-on-success is necessary but insufficient. There should be reconciliation tests comparing cooked summaries to raw/compute source totals within exact Decimal/numeric expectations.
- **Concurrent household edits:** The design does not specify optimistic concurrency, last-write-wins, or conflict UX for spouse edits to the same plan/trade. Server Action tests should cover lost update prevention for high-value records.
- **Service-role misuse:** Section 03 asks for tests preventing service-role imports into user handlers; the unified plan should promote this to a required CI check.

## Acceptance Criteria for "Migration Complete"
1. All household-scoped tables have `household_id` or an explicit documented exemption, RLS is enabled/forced where appropriate, and automated RLS tests prove anonymous denied, non-member denied, viewer write denied, member write allowed, owner admin allowed, ex-member denied.
2. A sanitized migration fixture can be upgraded from current schema to Supabase schema and downgraded in rehearsal, with row counts and financial totals matching approved baselines.
3. Production, preview, development, and local environments use separate Supabase projects or verified isolated schemas; CI fails if preview deploys target production Supabase credentials.
4. Supabase Auth sign-in, sign-out, session refresh, invite accept, expired invite, wrong-account invite, and leave/remove household flows pass Playwright coverage.
5. Each CRUD endpoint moved from FastAPI has contract/parity tests, Server Action tests, and a documented rollback switch or route restoration plan.
6. Local Docker workers are idempotent: interrupted jobs can retry without duplicate raw rows, partial compute output is not published to cooked tables, and failed runs are visible in `compute_runs`.
7. Cooked tables expose `refreshed_at`, `source_run_id`, status, and staleness metadata; the UI displays fresh, refreshing, stale, and failed states in Playwright tests.
8. Backup and restore are rehearsed before production cutover: a Supabase dump restores into local Docker Postgres and passes smoke/parity tests.
9. Migrations are rehearsed while workers are disabled/drained, and a documented lock/drain mechanism prevents concurrent worker writes during DDL.
10. The legacy local auth/JWT path is removed or disabled in production, with tests proving FastAPI accepts Supabase JWTs only for transitional/worker endpoints.

## Findings
### 🔴 Blocking
- **No executable phase gates.** The migration phases have exit statements but not mandatory test artifacts, commands, fixture data, or pass/fail criteria. Add a migration test matrix mapping each phase to Vitest, pytest, Playwright, migration, and smoke tests.
- **Identity linking is undecided.** Google sign-in followed by email sign-in could create duplicate users or split household access. Decide and test the canonical account-linking policy before enabling email fallback.
- **Preview-to-production data leakage risk is not closed.** The plan warns about preview OAuth but does not prohibit preview deploys from using production Supabase. Make environment isolation a hard CI/Vercel gate.
- **Worker/migration concurrency is undefined.** Local Docker jobs can write raw/compute/cooked tables while Alembic changes constraints or FKs. Define a worker drain/advisory-lock protocol and rehearse it.

### 🟡 Important
- **Rollback is described but not rehearsable.** Each phase needs a dry-run: downgrade local migration, restore Supabase snapshot, Vercel deployment rollback, Server Action-to-FastAPI route toggle, and worker cron disable/re-enable.
- **Observability is too passive.** Supabase Logs UI and Docker stdout are not enough when cooked refresh fails silently. Add `compute_runs` failure surfacing, stale badges, owner notifications for repeated failures, and nightly stale-data checks with visible output.
- **Local-dev parity has three modes but no bug-reproduction recipe.** Contributors need documented commands to reproduce a production auth/RLS bug using Supabase local or dev project plus sanitized seed data.
- **Invite race conditions need constraints.** Reciprocal invites, duplicate invites, already-member acceptance, and role downgrade/removal during acceptance should be transactionally tested.
- **Removed-member data semantics need acceptance tests.** Shared records should remain with audit attribution; private records should not leak; removed users must lose read/write/restore access immediately.
- **Supabase pause/resume and connection limits need failure tests.** Free-tier behavior can cause jobs to fail mid-run; test retry and idempotency explicitly.
- **Cooked-table correctness needs reconciliation tests.** Staleness indicators show age, not correctness. Add raw→compute→cooked total reconciliation for P&L, positions, and planning dashboards.

### 🟢 Nits
- The unified doc references all six sections clearly, but Section 04 still contains stale backend-hosting and Clerk details that could confuse implementers despite the unified resolutions.
- `compute_runs` and `jobs` are both mentioned; choose one canonical table or define their relationship to avoid duplicate observability paths.
- The frontend section has strong accessibility/error-state guidance; promote the expired/wrong-account invite messages into acceptance tests.
- Spell out whether `household_refresh_state` lives in `public` or `compute`, and whether browser clients can read it directly through RLS.

## Recommendation to Lead
Do not start implementation until Keaton adds a concrete test/rollback matrix and closes the identity-linking, preview-isolation, and worker-migration concurrency decisions. Once those are written, this design should be implementable with the existing Vitest + pytest + Playwright stack, plus a Supabase dev/local target for RLS/auth parity. I recommend assigning Rabin to co-own RLS/auth tests, Kujan to own environment and rollback drills, Hockney/McManus to own worker and data parity tests, and Redfoot to approve the final migration acceptance suite before Phase 1 cutover.
