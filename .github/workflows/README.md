# GitHub Actions Workflows — Trading Journal

## Overview

This directory contains PR validation, backup, and Squad routing workflows. **Vercel's git integration handles all application deployments automatically** — no GitHub Actions deploy/release workflows are needed here.

| File | Trigger | Purpose |
|---|---|---|
| `pr-frontend.yml` | PR touching `apps/frontend/**` | Lint, typecheck, build, unit tests (Vitest) |
| `pr-backend.yml` | PR touching `apps/backend/**` | Lint (ruff), typecheck (mypy if configured), tests (pytest) |
| `pr-supabase-migrations.yml` | PR touching `supabase/migrations/**` | Lint migrations, dry-run on shadow Postgres |
| `branch-protection-status.yml` | PR to `main` | Documents required branch protection checks |
| `nightly-backup.yml` | Nightly cron + manual | Encrypted Supabase/Postgres backup artifact and failure issue |
| `test-rls.yml` | Squad branches + PRs to `main` | Informational pgTAP/RLS regression suite (`continue-on-error`) |
| `squad-heartbeat.yml` | Issues/PR lifecycle + manual | Squad/Ralph triage heartbeat and Copilot auto-assignment |
| `squad-issue-assign.yml` | Issue labeled `squad:*` | Comment/assign workflow for Squad-routed issues |
| `squad-label-enforce.yml` | Issue labeled | Enforces mutually exclusive `go:`, `release:`, `type:`, and `priority:` labels |
| `squad-triage.yml` | Issue labeled `squad` | Routes new Squad inbox issues to the best agent/member |
| `sync-squad-labels.yml` | Squad team file changes + manual | Syncs GitHub labels from the Squad roster |
| `squad-ci.yml` | PR/push to `main` | Node built-in tests for routing, support registration, coordinator canaries, and workflow conditions |
| `playwright-e2e.yml` | PR, nightly, manual | Chromium smoke/auth and nightly flows against this checkout and disposable Supabase |

## E2E reliability

Automatic E2E jobs use Ubuntu **24.04**, Node 22, the locked frontend dependencies,
and Supabase CLI **2.95.4**. `ubuntu-latest` moved to Ubuntu 26.04, unsupported by
Playwright 1.59; nightly runs 39568069437 and 39746822934 failed during browser
installation, before any tests ran. Images use their upstream Docker Hub references:
run 39822390266 demonstrated GHCR anonymous-pull throttling, and run 39822647369
hit public ECR's data quota, both before migrations or browser tests.

Dependabot cannot read ordinary Actions secrets. Previously its PRs failed the
required-secrets guard (for example run 39228467938). The local composite action
starts disposable Auth/PostgREST/Postgres, applies the actual repository migrations,
and exports only loopback test credentials. Next.js is built from the checked-out
PR, not an unrelated deployed URL. No production override or hosted service-role
key is used. Cleanup removes the disposable stack even after test failure.

Manual runs with a blank `base_url` use the same local setup. An explicitly supplied
hosted staging URL requires the three `E2E_SUPABASE_*` secrets and remains subject
to the fixture production-safety guard; opaque production project refs are blocked.
Do not use `pull_request_target` or add hosted credentials to untrusted PR runs.

The A5 household-isolation browser test (#485) opens the **Income** tab before
checking seeded salaries; PlanEditor starts on **Accounts**. Session injection
uses the Supabase SSR storage key, chunking, and actual browser target hostname,
including HTTP loopback URLs. Authenticated walkthroughs require HTTP 200 and
reject sign-in redirects; navigation errors cannot become a false-green status 0.
The three anonymous route checks assert the actual sign-in URL (including `next`)
and sign-in heading, rather than treating any non-500 page as an auth gate.
Three duplicate HTML-length/title-only tests were folded into these stronger
checks; no security coverage was skipped. A new access-denial check for the
fixture cleanup RPC brings the inventory to 43 smoke/auth tests instead of 45.

Run 39823516955 reached real browsers: 39 passed (including restored two-user
isolation), two existing tests skipped, and one cleanup assertion failed.
Fresh local migrations owned the legacy `e2e_reset_test_user` fixture RPC with
an unprivileged role, so its intended teardown operation failed. The local-only
bootstrap restores that **single fixture function's** privileged owner and
explicitly restricts execution to `service_role`. It does not grant replication
privileges to app roles or alter table triggers/RLS. Browser tests verify anonymous
and authenticated callers are denied and cannot destroy the fixture household.
PG17 requires password authentication even for the container's Unix socket;
the bootstrap supplies only that disposable container's `POSTGRES_PASSWORD` to
`psql` without printing or exporting it to the job. Bootstrap SQL verifies a
privileged definer and service-only execution, with an empty search path.
Every fixture teardown caller now resets household data before deleting auth and
throws on lookup, RPC, or deletion failure. The lifecycle test checks query errors
as well as absent membership, household, and auth rows, so failures cannot masquerade
as successful cleanup.

Validate workflow contracts with `node --test .github/tests/*.test.cjs` and cookie
serialization with `cd apps/frontend && npm test -- src/test/session-cookies.test.ts`.
Teardown error-path regressions run with `npm test -- src/test/e2e-teardown.test.ts`
from `apps/frontend`.
Real browser CI remains required; those tests are not substitutes for it.

The independent PR frontend Build job also supplies non-secret, loopback public
Supabase placeholders: the SSR browser client is constructed during prerendering
and requires a URL/key even without runtime requests. Its artifact is validation
only and is never deployed; Vercel performs its own build with deployment config.

## Removed Squad Template Workflows

The generic Squad template workflows for package CI/release/docs/preview promotion were removed because this repository is the trading-journal app, not the Squad CLI/package repository. Application validation lives in the PR workflows above, and production/preview deploys are owned by Vercel's git integration.

`main` is the integration branch; do not introduce upstream `dev`/`insider`
promotion or package-publishing jobs. The adapted Squad configuration check runs
`node --test .github/tests/squad-upgrade.test.cjs` without application credentials.
Rai and Fact Checker are registered as support agents, outside the routable
specialist table. Job-level conditions must not use `hashFiles`: that expression
is unavailable before a runner is assigned and prevents a workflow from starting.

---

## Toolchain

- **Frontend**: Node 20, `npm ci` (uses `package-lock.json`), Next.js, Vitest
- **Backend**: Python 3.11, `uv sync --frozen` (uses `uv.lock`), FastAPI, pytest, ruff
- **Migrations**: Supabase CLI (`supabase/setup-cli@v1`), Postgres 15

---

## Branch Protection Setup

Run once to configure required status checks on `main`:

```bash
# Set required status checks for main branch
gh api -X PUT repos/cohenjo/trading-journal/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint",
      "Type Check",
      "Build",
      "Lint (ruff)",
      "Lint Migrations (supabase db lint)",
      "Dry-Run Migrations on Shadow DB"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF
```

> ⚠️ **Note**: Status check names in `contexts` above must exactly match the `name:` field in each job. Verify after first PR run if names drift.

To list current branch protection:
```bash
gh api repos/cohenjo/trading-journal/branches/main/protection
```

---

## Vercel Deploys

Vercel is connected via **git integration** (not GitHub Actions). It automatically:
- Deploys `main` → production
- Deploys feature branches → preview URLs

No deploy workflow exists here by design. See `docs/design-hosting/runbooks/vercel-03-policy-ci.md` for the architecture decision (Strategy A).

---

## Skipping CI

Add `[skip ci]` to any commit message to skip all workflows:

```bash
git commit -m "chore: update README [skip ci]"
```

Or use GitHub's `paths:` filtering — workflows only trigger when relevant files change.

---

## Manually Re-Running a Workflow

```bash
# Re-run all jobs in the last failed run
gh run rerun --failed

# Re-run a specific run by ID
gh run rerun <run-id>

# Watch a run in progress
gh run watch
```

---

## RLS Smoke Test (TODO)

`pr-supabase-migrations.yml` has a placeholder for cross-household RLS validation. To implement:
1. Create two test households + one user each in the shadow DB
2. As user A, SELECT from household B's RLS-restricted tables
3. Assert 0 rows returned
4. Assert user A can read their own data

Track in a follow-up issue.
