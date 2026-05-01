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

## Removed Squad Template Workflows

The generic Squad template workflows for package CI/release/docs/preview promotion were removed because this repository is the trading-journal app, not the Squad CLI/package repository. Application validation lives in the PR workflows above, and production/preview deploys are owned by Vercel's git integration.

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
