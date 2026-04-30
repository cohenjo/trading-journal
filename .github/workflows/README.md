# GitHub Actions Workflows — Trading Journal

## Overview

This directory contains PR validation workflows. **Vercel's git integration handles all deployments automatically** — no deploy workflows are needed here.

| File | Trigger | Purpose |
|---|---|---|
| `pr-frontend.yml` | PR touching `apps/frontend/**` | Lint, typecheck, build, unit tests (Vitest) |
| `pr-backend.yml` | PR touching `apps/backend/**` | Lint (ruff), typecheck (mypy if configured), tests (pytest) |
| `pr-supabase-migrations.yml` | PR touching `supabase/migrations/**` | Lint migrations, dry-run on shadow Postgres |
| `branch-protection-status.yml` | PR to `main` | Documents required branch protection checks |
| `squad-*.yml` | Various | Squad agent infra — **do not modify** |

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
