# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

---

## 2026-05-11 — ✅ Migration Drift Repair: Track Ad-Hoc Migrations (#335 Steps 1–2)

**Scope:** Register 6 ad-hoc-applied migrations in `supabase_migrations.schema_migrations` so `supabase db push` no longer treats them as pending.

**Background:** On 2026-05-10, Flex pipeline Phase 1 DDL was applied directly to prod outside the Supabase CLI migration flow. All schema objects exist in prod but the tracking table had no rows for these versions, causing `db push` to attempt re-runs (which would fail on the non-idempotent `ADD CONSTRAINT` in 000200).

**Executed:**
- ✅ Verified all 5 DDL migration objects exist in prod (columns, tables, indexes)
- ✅ Verified 000600 (`bond_holdings_add_listing_exchange`) was already tracked — only 000100–000500 + backfill needed insertion
- ✅ Dry-run `BEGIN/ROLLBACK` confirmed correct INSERT shape
- ✅ Applied tracking INSERTs via `supabase_migrations.schema_migrations` with `ON CONFLICT (version) DO NOTHING`
- ✅ Verification `SELECT` confirmed all 6 rows present

**Versions tracked (tracking only — no DDL re-run):**
| Version | Name |
|---------|------|
| 20260510000100 | extend_stock_positions_flex_fields |
| 20260510000200 | flex_bond_holdings_snapshot |
| 20260510000300 | dividend_payments |
| 20260510000400 | dividend_accruals |
| 20260510000500 | security_reference |
| 20260511052500 | backfill_placeholder_account_households |

**Artifacts:**
- Runbook: `supabase/scripts/track-adhoc-migrations.sql`
- Decisions inbox: `.squad/decisions/inbox/kujan-migration-tracking-2026-05-11.md`

**PR:** `squad/335-migration-tracking` — `chore(migrations): track ad-hoc applied migrations (#335 Steps 1-2)`

**Handoff:** Hockney can now safely run Step 5 (apply `20260501120000` insurance_policies cleanup). Steps 3+4 (RLS policies) also remain for Hockney.

---

## 2026-05-11 — ✅ Nightly Backup Triage: #344–#349 (pg_dump v17 mismatch + issue-spam dedupe)

**Scope:** Root-cause the 6× backup failure issues filed 2026-05-09 and harden the workflow.

**Root cause:** Commit `870a253` (2026-05-05) added the PGDG APT repo but kept installing `postgresql-client-15`. Supabase runs PostgreSQL 17; `PG_DUMP` pointed to `/usr/lib/postgresql/17/bin/pg_dump` which wasn't installed, causing every nightly run to fail immediately. An operator manually triggered the workflow 6 times while investigating, and the `alert-on-failure` job had no deduplication guard, producing 6 identical `priority:critical` issues (#344–#349).

**Executed:**
- ✅ Confirmed root cause via log analysis (run 25609713276 shows `postgresql-client-15` install attempt with v17 binary path)
- ✅ pg_dump fix already applied (commits `04d3558`, `fa6b75c`, `1e9e011`) — backup verified working at run [25654224589](https://github.com/cohenjo/trading-journal/actions/runs/25654224589) (`2026-05-11T06:35:26Z`)
- ✅ Added deduplication to `alert-on-failure` job: closes prior open `🚨 Nightly backup FAILED` issues as "superseded" before opening a single fresh issue
- ✅ Filed decisions inbox: `kujan-backup-triage-2026-05-11.md`
- ✅ Closed issues #344–#349 with root-cause comment

**PR:** `squad/backup-triage-344-349` — `chore(infra): backup workflow hardening + dedupe (#344-#349)`

---

## 2026-05-10 — ✅ Flex Pipeline v2: Applied Migrations + Rebuilt Worker (Image 82fe82a9)

**Scope:** Infrastructure work to apply Flex v2 schema migrations and deploy updated worker for live Flex sync.

**Executed:**

**Migrations Applied (05:00–05:15 UTC):**
- ✅ 20260510000100: Extend stock_positions flex fields (8 new columns: listing_exchange, cusip, isin, figi, security_id, security_id_type, accrued_interest, cost_basis_total)
- ✅ 20260510000200: Flex bond_holdings snapshot (Flex identifier cols + nullable coupon/issue_date)
- ✅ 20260510000300: Dividend payments table (UNIQUE constraint on account_id + source_transaction_id)
- ✅ 20260510000400: Dividend accruals table (asset_category + fx_rate_to_base columns)
- ✅ 20260510000500: Security reference table (con_id as PK, 12 identifier/meta columns)
- ✅ 20260510000600: Bond holdings add listing_exchange (hotfix, applied 01:15 UTC after Phase E backfill)

**Worker Rebuild:**
- Old image SHA: 9fe849fe7779ab6db8a1d6c2e8ae33e1caaae1f6e94df32763f5eef5a2eec67d
- New image SHA: 82fe82a954d26f9e665b6eb398a1ec3a1bf63afa34f935190eb23690b82d320e
- Container status: ✅ Healthy
- APScheduler: ✅ 10 jobs registered and scheduler started

**Fresh Flex Sync Attempt:**
- Status: ❌ Failed after 8 retries (2562s elapsed)
- Error: IBKR Flex API error 1001 — "Statement could not be generated at this time."
- Duration: ~43 minutes (exponential backoff on retry)
- **Cause:** Manual syncs running back-to-back triggered IBKR API throttle.
- **Workarounds:** (1) Re-save Flex query in Account Management to reset throttle counter, (2) wait ~30 minutes before retry.
- **Impact:** No data synced; stock_positions snapshot remains dated 2026-05-01 pending retry or cooldown.

**Schema Verification (Post-Migration):**
- stock_positions: 270 rows (flex), 8 new identifier columns all present and nullable
- bond_holdings: 0 rows (pre-backfill); schema ready with Flex fields
- dividend_payments: 0 rows (pre-backfill); UNIQUE constraint applied
- dividend_accruals: 0 rows (pre-backfill); composite index created
- security_reference: 0 rows (pre-backfill); con_id PK created with symbol/cusip/isin indexes

**Handoff:**
Infrastructure ready (migrations applied, worker rebuilt and healthy, new schema verified). Data import pending: IBKR Flex API throttle must clear before sync can succeed. Hockney's Phase 3 backfill (commit eacd8d4) populated all 4 new tables with 5,524 + 217 + 75 + 18 rows. McManus can revalidate end-to-end once throttle clears and next sync completes.

---

## 2026-05-10 — ✅ Fresh XML Backfill Phases A-E + New Master XML

**Scope:** Executed 5-phase XML backfill using the new May 10 master XML (`reports/activity/OptionsIncomeDashboard_Master-10-may.xml`, 374 lines, 216 KB, period=LastBusinessWeek 2026-05-04→2026-05-08).

**Executed via temporary swap of Master.xml (restored after backfill):**

| Phase | Operation | Result |
|-------|-----------|--------|
| A | stock_positions: update identifier cols + cost_basis_total | 14 rows updated |
| B | dividend_payments: re-route from options_cash_events | 5,524 inserted |
| C | dividend_accruals: seed from master XML | 16 inserted |
| D | security_reference: seed from OpenPositions | 75 inserted |
| E | bond_holdings: seed BOND rows | 18 inserted |

**Final DB counts post-backfill:** stock_positions 270 (5 snapshots, max 2026-05-01), bond_holdings 18 (1 snapshot, max 2026-05-08), dividend_accruals 217, dividend_payments 5,524, security_reference 75.

**Gaps identified and handed off to Hockney:**
1. `NetStockPositionSummary` section has 57 rows in XML — no `net_stock_positions` table exists; rows silently dropped.
2. `issueDate` field confirmed empty (`""`) in every FII row even after new export — pending Jony portal config.
3. `underlyingSymbol` in SecurityInfo not captured.

**Live sync status:** Fresh sync triggered at 10:41 UTC+3; IBKR throttle (error 1001) may still be blocking. No confirmed fresh sync completion at time of handoff.

**Decisions filed:** `kujan-flex-fresh-data-2026-05-10.md` (processed by Scribe)

---

## 2026-05-11 — ✅ Nightly Backup Hardening: Issue Dedup (PR #370)

**Scope:** Add deduplication guard to the `alert-on-failure` job to prevent repeated backup failures from spamming multiple GitHub issues.

**Root cause:** pg_dump version mismatch (v15 installed, v17 binary path referenced) caused all nightly backups to fail from 2026-05-05 onward. On 2026-05-09, operator manually re-triggered the workflow 6 times while investigating. The `alert-on-failure` job created a new critical GitHub issue on each failure, producing 6 identical issues (#344–#349) in 31 minutes with no deduplication.

**Executed:**
- ✅ pg_dump fix already merged (commits `04d3558`, `fa6b75c`, `1e9e011`) — updated to `postgresql-client-17`, set explicit binary path
- ✅ Last successful backup: run [25654224589](https://github.com/cohenjo/trading-journal/actions/runs/25654224589) (2026-05-11T06:35:26Z)
- ✅ Deduplication logic added: `alert-on-failure` searches for open `🚨 Nightly backup FAILED` issues, closes any found as "superseded", then opens exactly one fresh issue
- ✅ Decisions folded into shared decisions.md (processed by Scribe)

**PR:** [#370](https://github.com/cohenjo/trading-journal/pull/370) — `chore(infra): backup workflow hardening + dedupe (#344-#349)`

**Outcome:** One open backup-failure issue at any given time; repeated manual re-triggers no longer spam issue tracker.

---

## Learnings

### 2026-05-12 — Options-extrapolation sprint merge orchestration

- **Summary:** Merged options-extrapolation sprint PRs #433–#438 with the coordinator-approved Playwright-infra bypass extension for the known Node 20 WebSocket workflow failure.
- **Patterns observed:**
  - When a root PR has its branch deleted, dependent PRs auto-close; restore the missing base branch only long enough to `gh pr reopen`, retarget with `--base main`, then rebase.
  - Force-pushing after rebase invalidates prior CI runs, so re-check the failure signature before any admin merge.
- **Follow-up:** The Playwright Node 20 workflow infra issue needs a separate fix; note filed on #419 for Hockney/Kobayashi/Redfoot handoff.

---

## 2026-05-12 — Plan-persistence sprint merges (#442, #443, #445, #444)

- **Merged in order:** #442 → #443 → #445 → #444 using `--squash --delete-branch --admin` under Keaton's pre-authorized Playwright CI infra bypass.
- **Squash SHAs:** #442: `bdf568f`, #443: `71917fe`, #445: `282660d`, #444: `b4c1143`
- **Rebase actions:** #445 (`squad/441-income-streams`) rebased onto main after #443 landed (both touched `plan/page.tsx` in different regions — clean, zero conflicts). #444 (`squad/440-441-tests`) rebased onto main after #445 merged; A6 and B6 `test.fixme()` calls un-fixme'd via commit `chore(tests): un-fixme A6 and B6 — PR-C (#445) shipped the wiring` before push. PR #444 marked ready with `gh pr ready 444` before final merge.
- **Worker rebuild:** Not needed — no `apps/backend/app/worker/`, `Dockerfile`, `pyproject.toml`, or `uv.lock` files touched across all 4 PRs.
- **Vercel production:** SHA `b4c1143c` deployed successfully (state: success, 2026-05-12T22:00:25Z).

---

## 2026-05-12 — Round 1 review merges (#424, #425, #427)

- **Merged in order:** #424 → #425 → #427 using `--squash --delete-branch --admin` under Keaton's approved Playwright CI infra bypass.
- **Squash SHAs:**
  - #424: `f2cdff6f9d9e9e5d1ca9b91890484fd42e911f2f`
  - #425: `94643208988135aaeee958c32ef756ec863c8385`
  - #427: `ab4da1fe0337dd55f1d08c6e0c53d392c617a109`
- **Pre-merge checks:** Each PR was open and mergeable via REST (`mergeable=true`, `mergeable_state=unstable`); failed Playwright logs matched `Error: Node.js 20 detected without native WebSocket support.`
- **Rebase actions:** None needed for the PR branches.
- **Worker rebuild:** Correctly skipped for #425 per Keaton's no-op/audit-trail guidance; `./scripts/rebuild-worker.sh` was not run.

---

## Learnings

### Direct psql Migration Apply Pattern (2026-05-13)

When migration drift exists and you need to apply a specific migration without disturbing the larger drift state:

**Pattern:**
```bash
# 1. Source env
set -a; source .env; set +a

# 2. Apply via direct psql with error-stopping
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<timestamp>_<name>.sql

# 3. Verify with SQL queries
```

**Key Points:**
- `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>` is the safe targeted-apply incantation
- `ON_ERROR_STOP=1` prevents half-applied state (exits on first error)
- Direct psql bypasses Supabase migration tracking — tracking table remains unchanged
- Use when `supabase db push --linked` would apply unwanted migrations
- After apply, `supabase migration list --linked` will still show migration as "pending" (cosmetic)
- Reconcile later with: `supabase migration repair --status applied <timestamp>`

### Migration Drift Discovered (2026-05-13)

**State on 2026-05-13:**
- **Local pending:** 10 migrations (20260510004200 through 20260513153400) not tracked in remote
- **Remote-only:** 10 migrations exist in remote `schema_migrations` that don't exist as local files
- **Immediate need:** Apply RLS migration (20260513153400) via direct psql to resolve Advisor findings without disturbing drift

**Implications:**
- `supabase db push --linked` is dangerous until drift is reconciled
- Running it would attempt to apply all 10 pending local migrations at once
- Direct psql apply bypasses tracking but solves immediate RLS security concern

**Recommendation:** Dedicated drift-reconciliation task before next `supabase db push`

---

## 2026-05-18 — Dependabot Batch Merge: 8 PRs (Post-#460 Merge)

**Scope:** Review and merge 8 open Dependabot PRs after Jony merged PR #460 (cash-flow dividend redesign).

**Execution:**

**Phase 1 — Safe Patch/Minor Merges (5 PRs):** ✅ ALL MERGED
- #454 (cachetools 7.1.1 → 7.1.2, Python patch): ✅ MERGED
- #455 (react 19.2.5 → 19.2.6, npm patch): ✅ MERGED
- #456 (python-multipart 0.0.27 → 0.0.29, Python patch): ✅ MERGED (resolved pyproject.toml conflict via rebase + manual fix to align cachetools with #454's update)
- #457 (lucide-react 1.14.0 → 1.16.0, npm minor): ✅ MERGED
- #458 (@vitest/coverage-v8 4.1.5 → 4.1.6, npm dev patch): ✅ MERGED

**Phase 2 — Major Bump Validation (3 PRs):**
- **#459 (eslint 9.30.1 → 10.4.0, MAJOR):** 🔴 HELD — Breaking: eslint 10 incompatible with eslint-config-next@15.x. Blocked by Next.js version requirement. Recommend Jony merge #393 first to upgrade eslint-config-next, then #459 becomes mergeable.
- **#453 (actions/upload-artifact 4 → 7, MAJOR):** ✅ MERGED — Safe; 6 workflow bumps with compatible parameters; no artifact download logic in workflows that would break.
- **#393 (next 15.5.15 → 16.2.6, MAJOR):** 🟡 HELD — Builds & tests pass (no new failures beyond 3 pre-existing in dividend-positions/SettingsContext). Recommend Jony decide; major framework migration warrants human oversight despite passing automated checks. Note: merging #393 first enables #459.

**Key Learnings:**
- Framework major upgrades often ship with dependency updates (Next.js 16 includes eslint-config-next update). Plan upgrade sequences accordingly.
- PR conflicts during sequential merges (dep PRs) can be resolved via rebase + manual version alignment.
- Repo CI does not run full build/test on PRs (Vercel deploy-time build); local validation (npm install, npm run build, vitest) required to detect breaking changes.

**Final Summary:**
- 6 of 8 PRs merged (5 Phase 1 + 1 Phase 2 safe)
- 2 PRs held pending Jony decision (#393 + #459 pending framework migration coordination)
- Decision file: `.squad/decisions/inbox/kujan-dep-batch-2026-05-18.md`
## Learnings

### 2026-05-18 — eslint-config-next@16 FlatCompat circular reference (PR #393)

- **`eslint-config-next@16` exports native flat config.** Do not wrap with `FlatCompat.extends()`. The config object contains circular references that crash `JSON.stringify` in `@eslint/eslintrc@3.3.5` on the very first lint invocation.
- **Correct migration pattern:** Replace `compat.extends("next/core-web-vitals", "next/typescript")` with `import nextConfig from "eslint-config-next/core-web-vitals"` — the `core-web-vitals` subpath exports a 4-item array that includes `next`, `next/typescript`, `next/core-web-vitals` rules, and a built-in `.next/**` ignores block.
- **Add explicit ignores up front** in the flat config array for `.next/**`, `node_modules/**`, `dist/**` — `eslint .` does not auto-ignore these the way `next lint` does.
- **eslint@10 + eslint-config-next@16.2.6 has a pre-existing compat gap:** `eslint-plugin-react` bundled inside uses `context.getFilename()`, removed in eslint@10. This surfaces only once the FlatCompat circular reference is fixed. Flag to #459 team — it is not fixable within the `eslint.config.mjs` file; requires plugin upgrade or override.

---

## 2026-05-18 — Next.js 16 migration + ESLint 10 investigation

**Session Context:** Round 1 Dependabot batch review + Round 2–5 Next.js 16 migration cycle.

**Key Actions:**
- Merged 6 safe Dependabot PRs (Phase 1: patch/minor bumps) with sequential squash-merge; 1 conflict resolved via rebase
- Validated Phase 2 majors locally (npm install, build, vitest) before merge attempt
- Identified 4 actionable gaps in PR #393 (eslint config, eslint-config-next version, middleware deprecation, tsconfig auto-changes)
- Fixed FlatCompat circular reference blocker in `eslint.config.mjs` — replaced with native flat config import from `eslint-config-next/core-web-vitals`
- Removed `@eslint/eslintrc` package dependency
- Discovered pre-existing upstream blocker for #459: `eslint-plugin-react` inside `eslint-config-next@16.2.6` uses removed eslint@10 API (`context.getFilename()`)

**Key Learnings:**
- Framework majors (Next.js) ship with dependency bumps (eslint-config-next version updates). Plan upgrade sequences to validate paired dependencies.
- When `eslint-config-next` exports native flat config (v16+), do NOT wrap with `FlatCompat`. Import directly: `import nextConfig from "eslint-config-next/core-web-vitals"`.
- Vendored plugins inherit upstream API incompatibilities. When bumping eslint majors, audit all transitive plugins for API removal (context.getFilename, context.getScope, etc.).
- Strict lockout discipline works: when code review finds a blocker in complex config (ESLint), lock implementer and bring in specialist. Avoids rework loops.

**References:**
- Dependabot batch: `.squad/decisions/inbox/kujan-dep-batch-2026-05-18.md`
- Recon: `.squad/decisions/inbox/kujan-next16-recon-2026-05-18.md`
- Fix: `.squad/decisions/inbox/kujan-next16-eslint-fix-2026-05-18.md`
