# Vercel Deployment Flow (Hockney)

> **Scope:** One-page reference for the PR → preview → production deployment lifecycle.
> For rollback, see `vercel-04-project-link-and-env.md §5`.
> For DNS and custom domains, see `vercel-02-deploys.md`.

---

## Deployment Lifecycle Diagram

```
Developer pushes branch / opens PR
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│                  GitHub  (cohenjo/trading-journal)             │
│                                                                │
│  branch: squad/72-my-feature                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Pull Request #N opened / commits pushed                 │  │
│  │                                                          │  │
│  │  GitHub Actions (.github/workflows/test.yml)            │  │
│  │    └── npm ci → lint → test → build                     │  │
│  │         └── Status: ✅ passing / ❌ failing             │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
         │
         │  Vercel GitHub App webhook
         ▼
┌────────────────────────────────────────────────────────────────┐
│                  Vercel (trading-journal project)              │
│                                                                │
│  ⚙️  Build triggered (Preview environment)                    │
│  └── Root directory: apps/frontend/                           │
│  └── Build command: npm run build                             │
│  └── Env vars: PREVIEW scope                                  │
│                                                                │
│  ✅ Build succeeds                                            │
│  └── Preview URL generated:                                   │
│       https://trading-journal-git-squad-72-cohenjo.vercel.app │
│       https://trading-journal-<hash>-cohenjo.vercel.app       │
└────────────────────────────────────────────────────────────────┘
         │
         │  Vercel bot posts comment to PR
         ▼
┌────────────────────────────────────────────────────────────────┐
│  PR Comment (from Vercel bot):                                 │
│                                                                │
│  🔍 Preview deployment is ready!                              │
│  ├── Branch URL (stable): https://trading-journal-git-...     │
│  └── Latest commit URL:   https://trading-journal-abc123...   │
│                                                                │
│  Use the Branch URL in Supabase redirect allowlists           │
│  (stable for the lifetime of the branch).                     │
└────────────────────────────────────────────────────────────────┘
         │
         │  PR approved + merged to main
         ▼
┌────────────────────────────────────────────────────────────────┐
│                  Vercel — Production Deploy                    │
│                                                                │
│  ⚙️  Build triggered (Production environment)                 │
│  └── Env vars: PRODUCTION scope                               │
│  └── Vercel checks GitHub required status checks:             │
│       ├── GitHub Actions `test` job: must be ✅               │
│       └── Only then: Production alias promoted                │
│                                                                │
│  ✅ Production deployment live:                               │
│       https://<USER_DOMAIN>  (custom domain)                  │
│       https://trading-journal.vercel.app  (Vercel alias)      │
└────────────────────────────────────────────────────────────────┘
```

---

## Trigger Summary Table

| Action | Environment | URL promoted? |
|--------|-------------|--------------|
| Push to any branch | Preview | No (preview URL only) |
| Open or update a PR | Preview | No (branch URL in PR comment) |
| PR merged to `main` | Production | ✅ Yes — production alias updated |
| `vercel --prod` (CLI) | Production | ✅ Yes |
| `vercel` (CLI, no flag) | Preview | No |
| `[skip ci]` in commit msg | — | 🚫 Deploy skipped entirely |

---

## Environment Variable Scoping

Each deploy receives only the env vars configured for its environment:

```
commit → branch push
           ├── Vercel env scope: PREVIEW
           │     NEXT_PUBLIC_SUPABASE_URL  → dev Supabase project
           │     SUPABASE_SERVICE_ROLE_KEY → ❌ NOT injected (prod-only)
           │
           └── Vercel env scope: PRODUCTION (on main)
                 NEXT_PUBLIC_SUPABASE_URL  → prod Supabase project
                 SUPABASE_SERVICE_ROLE_KEY → ✅ injected (server-side only)
```

---

## Vercel Bot PR Comment (what it looks like)

When a preview deploy completes, the Vercel GitHub app posts a comment:

```
✅  Preview deployment is ready!

Visit it now: https://trading-journal-git-squad-72-my-feature-cohenjo.vercel.app

Built with commit abc1234 by @cohenjo
```

To enable/disable: **Project → Settings → Git → "Comment on Pull Requests"**.

---

## Build Status Checks on PRs

Configure in **GitHub → Settings → Branches → Branch protection rules** for `main`:

| Required check | Source |
|----------------|--------|
| `test` | GitHub Actions workflow |
| `Vercel — Production Deployment` | Vercel GitHub App |

Both must pass before a PR can be merged to `main`. The Vercel deployment status check
is added automatically when the Vercel GitHub App is installed.

---

## Skip Conditions

| Skip method | Scope |
|-------------|-------|
| `[skip ci]` in commit message | Skips both GH Actions and Vercel |
| `[vercel skip]` in commit message | Skips Vercel only |
| `vercel.json` `git.deploymentEnabled: { "branch": false }` | Disables deploy for named branch |

---

## Cross-References

| Topic | Location |
|-------|---------|
| Preview URL patterns + branch URL format | `runbooks/vercel-02-deploys.md §2` |
| Auth redirect gotcha on previews | `runbooks/vercel-02-deploys.md §3` |
| CI/CD policy + GitHub Actions workflow | `runbooks/vercel-03-policy-ci.md §4` |
| Rollback procedure | `runbooks/vercel-04-project-link-and-env.md §5` |
| Hobby plan limits | `runbooks/vercel-04-project-link-and-env.md §6` |
