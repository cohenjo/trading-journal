# Decision: CI/CD Scaffolding Strategy (TJ-008)

**Author:** Kujan (DevOps/Platform)  
**Date:** 2026-05-01  
**Issue:** TJ-008 / GH #61  

## Decision

Implemented Strategy A per `docs/design-hosting/runbooks/vercel-03-policy-ci.md`:  
**Vercel git integration owns all deployments; GitHub Actions owns PR validation only.**

## Rationale

- Vercel natively deploys on push to `main` and creates preview URLs for branches — no GH Actions deploy step needed.
- Keeping deploy logic out of GH Actions reduces secret sprawl and simplifies rollback.
- PR validation workflows are path-filtered so unrelated changes don't trigger expensive CI jobs.

## Files Created

| File | Purpose |
|---|---|
| `.github/workflows/pr-frontend.yml` | npm lint / tsc typecheck / next build / vitest |
| `.github/workflows/pr-backend.yml` | ruff lint / mypy (optional) / pytest |
| `.github/workflows/pr-supabase-migrations.yml` | supabase db lint + shadow DB dry-run |
| `.github/workflows/branch-protection-status.yml` | Branch protection check reference |
| `.github/workflows/README.md` | Workflow docs + `gh api` branch protection commands |

## Toolchain Detected

- **Frontend:** npm (package-lock.json), Node 20, Next.js, Vitest
- **Backend:** uv (uv.lock), Python 3.11, FastAPI, pytest, ruff
- **No pnpm** in use (task brief assumed pnpm; adapted to actual npm setup)

## Deferred

- RLS smoke test in migration workflow (inline TODO with implementation guide)
- mypy config: no `[tool.mypy]` in pyproject.toml yet; typecheck job auto-skips with notice

## Impact on Other Members

- **Hockney / Rabin:** Branch protection commands in README.md must be run once by repo admin
- **All members:** Stale PR runs are auto-cancelled via concurrency groups (fast feedback)
- **Scribe:** Branch protection setup is documented; no schema changes
