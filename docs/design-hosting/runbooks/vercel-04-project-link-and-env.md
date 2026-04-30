# Vercel Project Link + Env Wiring Runbook (Hockney)

> **Scope:** Interactive `vercel link`, env var wiring for all scopes, custom domain
> assignment, branch deploy policy, rollback procedure, Hobby plan limits, and
> troubleshooting reference. This runbook is the **user-executed complement** to the
> committed project config (`apps/frontend/vercel.json`). Sister runbooks:
> `vercel-01-project.md` (API path), `vercel-02-deploys.md` (DNS/preview), `vercel-03-policy-ci.md` (CI/limits).

---

## 1. Login + Link (run once per developer machine)

### 1.1 Install Vercel CLI

```bash
npm i -g vercel
vercel --version   # confirm install
```

### 1.2 Authenticate

```bash
vercel login
# → Choose "Continue with GitHub" when the browser opens.
# → After OAuth completes, CLI stores a token in ~/.local/share/com.vercel.cli/
vercel whoami     # should print your GitHub username (cohenjo)
```

### 1.3 Link the monorepo frontend

Run from inside `apps/frontend/` — Vercel must see `next.config.ts` in the cwd.

```bash
cd apps/frontend
vercel link
```

| Prompt | Answer |
|--------|--------|
| Set up and deploy? | `N` — link only |
| Which scope? | Your personal account (`cohenjo`) |
| Link to existing project? | `N` on first run; `Y` if project already exists on Vercel dashboard |
| Project name | `trading-journal` |
| In which directory is your code? | `.` (already in `apps/frontend`) |

This creates `apps/frontend/.vercel/project.json` containing `orgId` and `projectId`.
**This file is gitignored and must never be committed.** Each developer links independently.

> **Monorepo note:** Vercel auto-detects the `rootDirectory: "apps/frontend"` from the
> link step. If you need to run CLI commands from the repo root, use `--cwd apps/frontend`:
> ```bash
> vercel --cwd apps/frontend ls
> ```

---

## 2. Setting Environment Variables

> **Canonical env var source:** `docs/design-hosting/setup-vercel.md §4` lists all
> required variables. The table below is the authoritative scoping guide for Vercel.

> 🔐 **Security rule:** `NEXT_PUBLIC_*` variables are inlined into the browser bundle at
> build time and **visible to every user**. Never put a secret behind a `NEXT_PUBLIC_`
> prefix. `SUPABASE_SERVICE_ROLE_KEY` is **Production-only** and has server-side access
> only — it bypasses all RLS policies.

### 2.1 Env var scope reference

| Variable | Production | Preview | Development | Exposure |
|----------|:----------:|:-------:|:-----------:|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ | Browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | Browser + server |
| `NEXT_PUBLIC_SITE_URL` | ✅ | ✅ | ✅ | Browser + server — OAuth redirect base |
| `NEXT_PUBLIC_API_URL` | ✅ | ✅ | ✅ | Browser + server — legacy FastAPI (phase down) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | ❌ | **Server-only** — NEVER `NEXT_PUBLIC_`, NEVER preview |
| `SUPABASE_JWT_SECRET` | ✅ | ✅ | ❌ | Server-only — only if server-side JWT verification needed |
| `FASTAPI_INTERNAL_URL` | ✅ | ✅ | ❌ | Server-only — Docker FastAPI internal hostname |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` is restricted to **Production only**. Exposing it on
> preview environments would give admin-level Supabase access to preview build logs and
> any contributor who can inspect the deploy — avoid.

### 2.2 Add vars via CLI (interactive, recommended)

Run from `apps/frontend/`. The CLI prompts for the value without echoing it (safe for secrets).

```bash
cd apps/frontend

# ── Production ──────────────────────────────────────────────────────────
vercel env add NEXT_PUBLIC_SUPABASE_URL        production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY   production
vercel env add NEXT_PUBLIC_SITE_URL            production   # e.g. https://trading-journal.cohenjo.dev
vercel env add NEXT_PUBLIC_API_URL             production   # FastAPI URL (transitional)
vercel env add SUPABASE_SERVICE_ROLE_KEY       production   # server-only, encrypted at rest
vercel env add SUPABASE_JWT_SECRET             production
vercel env add FASTAPI_INTERNAL_URL            production

# ── Preview (point at dev/staging Supabase project, NOT prod data) ──────
vercel env add NEXT_PUBLIC_SUPABASE_URL        preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY   preview
vercel env add NEXT_PUBLIC_SITE_URL            preview      # e.g. https://trading-journal-git-main-cohenjo.vercel.app
vercel env add NEXT_PUBLIC_API_URL             preview
vercel env add SUPABASE_JWT_SECRET             preview
vercel env add FASTAPI_INTERNAL_URL            preview

# ── Development (syncs to .env.local via `vercel env pull`) ─────────────
vercel env add NEXT_PUBLIC_SUPABASE_URL        development  # point at local Supabase (127.0.0.1:54321)
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY   development
vercel env add NEXT_PUBLIC_SITE_URL            development  # http://localhost:3000
vercel env add NEXT_PUBLIC_API_URL             development  # http://127.0.0.1:8000
```

### 2.3 Add vars via Vercel dashboard (alternative)

1. Go to https://vercel.com/dashboard → Select project `trading-journal`.
2. **Settings → Environment Variables**.
3. For each variable: enter **Key**, **Value**, tick the appropriate environment
   checkboxes (Production / Preview / Development), then **Save**.

### 2.4 Verify vars were saved

```bash
vercel env ls production
vercel env ls preview
vercel env ls development
```

### 2.5 Pull development vars to local `.env.local`

```bash
cd apps/frontend
vercel env pull .env.local
```

> ⚠️ **Local Supabase caveat:** If you run Supabase locally (`supabase start`), override
> the pulled URL in `.env.local` manually:
> ```
> NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
> NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key from supabase status>
> ```
> Run `vercel env pull` only when you specifically want to test against the remote
> development Supabase project. See `runbooks/supabase-01-local-dev.md` for local setup.

---

## 3. Custom Domain Assignment

> Replace `<USER_DOMAIN>` below with your actual domain. Current placeholder domains:
> - Production: `prod.trading-journal.cohenjo.dev` (or `<USER_DOMAIN>`)
> - Development/preview: `dev.trading-journal.cohenjo.dev`

### 3.1 Add production domain

```bash
cd apps/frontend
vercel domains add <USER_DOMAIN>
vercel domains inspect <USER_DOMAIN>   # shows DNS instructions + SSL status
```

### 3.2 Required DNS records

Configure at your DNS registrar:

| Record type | Host / Name | Value |
|-------------|-------------|-------|
| `A` | `@` (apex) | `76.76.21.21` ⚠️ verify at https://vercel.com/docs/projects/domains |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `prod` (subdomain) | `cname.vercel-dns.com` |
| `CNAME` | `dev` (subdomain) | `cname.vercel-dns.com` |

> ⚠️ Verify the apex A-record IP against live Vercel docs before updating DNS — the IP
> has changed historically.

### 3.3 Link preview domain to preview environment

```bash
vercel domains add dev.trading-journal.cohenjo.dev
```

In the dashboard: **Project → Settings → Domains** → set environment scope of
`dev.trading-journal.cohenjo.dev` to **Preview**.

### 3.4 Post-domain checklist

After DNS propagates and SSL is issued:

- [ ] Update `NEXT_PUBLIC_SITE_URL` in Production env var to the new domain.
- [ ] Update Supabase Auth → URL Configuration → **Site URL** to the production domain.
- [ ] Update Google OAuth authorized origins and redirect URIs.
- [ ] Run a full OAuth round-trip test on the production domain.

See `runbooks/vercel-02-deploys.md §6` for the full production cutover sequence.

---

## 4. Branch Deployment Policy

Vercel's default git integration handles this automatically once the project is linked.

| Branch pattern | Deploy environment | URL type |
|---------------|-------------------|---------|
| `main` | **Production** | Your custom domain + `trading-journal.vercel.app` |
| `squad/*` | **Preview** | `trading-journal-git-squad-<slug>-cohenjo.vercel.app` |
| Any other branch | **Preview** | Same pattern as `squad/*` |

### 4.1 Configure in dashboard

**Project → Settings → Git:**

| Setting | Value |
|---------|-------|
| Production branch | `main` |
| Comment on Pull Requests | ✅ Enabled (Vercel bot posts preview URL) |
| Deployment Protection | Vercel Authentication (Hobby default) |

### 4.2 Skip a deploy

Include `[skip ci]` in the commit message:

```bash
git commit -m "docs: update README [skip ci]"
```

Or disable deploys for specific branches in `apps/frontend/vercel.json`:

```json
{
  "git": {
    "deploymentEnabled": {
      "chore/local-only-experiment": false
    }
  }
}
```

### 4.3 Preview Supabase auth redirect allowlist

Preview URLs are dynamic. Add wildcard patterns to Supabase Auth:

**Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:**

```
https://trading-journal-git-*-cohenjo.vercel.app/auth/callback
https://trading-journal-*-cohenjo.vercel.app/auth/callback
http://localhost:3000/auth/callback
```

> ⚠️ Verify wildcard semantics against current Supabase docs before relying on this.
> See `runbooks/vercel-02-deploys.md §3` for fallback strategies.

---

## 5. Rollback Runbook

### 5.1 Instant rollback via CLI

```bash
# List recent deployments to find the target
cd apps/frontend
vercel ls

# Roll back to a specific deployment
vercel rollback <deployment-url-or-id>
# Example: vercel rollback https://trading-journal-abc123.vercel.app
```

> Verify flag names with `vercel rollback --help` — syntax may vary by CLI version.

### 5.2 Rollback via dashboard (easiest)

1. Go to https://vercel.com/dashboard → `trading-journal`.
2. **Deployments** tab → find the known-good deployment.
3. Click the **⋯** menu → **Promote to Production**.

The previous deployment becomes live immediately (no rebuild required).

### 5.3 ⚠️ Schema mismatch caveat

Rolling back a frontend deployment does **not** roll back database migrations. If the
bad deploy included a Supabase migration:

1. Coordinate with Kujan (backend) before promoting the older frontend.
2. Check whether the older code is compatible with the current DB schema.
3. If schemas are incompatible, roll back the migration first (see `runbooks/supabase-02-remote.md`).

---

## 6. Hobby Plan Limits

> All figures verified against https://vercel.com/docs/plans/hobby and
> https://vercel.com/pricing (2025-07).

| Resource | Hobby Limit | Notes |
|----------|-------------|-------|
| **Fast Data Transfer (bandwidth)** | **100 GB / month** | Page pauses if exceeded until 30-day reset |
| **Function Invocations** | 1,000,000 / month | Server Actions count; each call = 1 invocation |
| **Active CPU** | 4 CPU-hrs / month | Wall-clock CPU time across all functions |
| **Provisioned Memory** | 360 GB-hrs / month | Memory × time across all invocations |
| **Function max duration** | 10 s default, 60 s max | Enable Fluid Compute for up to 300 s |
| **Build execution minutes** | 6,000 / month | ~100 builds/day at ~60 s each |
| **Deployments / day** | 100 | Hard cap — exceeding blocks new deploys until reset |
| **Image Optimization** | 1,000 source images / month | Unique source URLs; resets monthly |
| **Runtime log retention** | 1 hour / 4,000 rows | Logs are ephemeral — do not rely on next-day access |
| **Concurrent builds** | 1 (sequential queue) | Hobby has 4 vCPUs, Pro has 30 |

**What happens when a limit is exceeded:**
> *"In most cases, if you exceed your usage limits on the Hobby plan, you will have to
> wait until 30 days have passed before you can use the feature again."*
> — Vercel Hobby plan docs

Hobby does **not** auto-bill overages. Features throttle/block until the rolling window resets.

**Key watchpoints for this project:**

- `next/image` with many unique chart thumbnail URLs will exhaust the 1,000 source-image
  limit. Use `unoptimized` prop for charts; save `next/image` for static UI assets.
- Server Actions on every interaction + any polling patterns can drain the 1M invocations
  fast. Use Supabase Realtime subscriptions for live updates instead.
- The 100 GB bandwidth limit is the most likely hard cap to hit if users download months
  of OHLCV data. Paginate chart data and enable gzip on API responses.
- No spend management dashboard on Hobby — check the **Usage** tab in the Vercel project
  dashboard manually. Consider a GitHub Actions scheduled cron to alert if usage
  approaches the limit (see `runbooks/vercel-03-policy-ci.md §3`).

**Migration triggers:** see `runbooks/vercel-03-policy-ci.md §9`.

---

## 7. Troubleshooting

### 7.1 View build logs

**CLI:**
```bash
cd apps/frontend
vercel ls                              # list deployments with status
vercel inspect <deployment-url>        # full build metadata
```

**Dashboard:**
Project → **Deployments** → click deployment → **Build** tab.

### 7.2 View runtime / function logs

**CLI:**
```bash
vercel logs <deployment-url>           # recent function logs
vercel logs <deployment-url> --follow  # stream live logs
```

> ⚠️ Hobby log retention is **1 hour / 4,000 rows**. Logs from earlier today may already
> be gone. For longer retention, ship logs to [Better Stack Logtail](https://betterstack.com/logtail)
> or [Axiom](https://axiom.co) (both have free tiers and Vercel integrations).

**Dashboard:**
Project → **Logs** tab → filter by Function, Deployment, or date range.
Use **Live** toggle for real-time log streaming.

### 7.3 Common failure patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Build fails: `Module not found` | Dependency missing in `package.json` or wrong `rootDirectory` | Confirm `vercel link` was run from `apps/frontend/`; check `package.json` |
| `FUNCTION_INVOCATION_TIMEOUT` | Server Action / API route exceeded 10 s | Move heavy work to compute worker (TJ-024); enable Fluid Compute for up to 300 s |
| `FUNCTION_PAYLOAD_TOO_LARGE` | Request body >4.5 MB | Use Supabase Storage presigned URLs for file uploads — do not POST file through Server Action |
| OAuth `redirect_uri_mismatch` on preview | Preview URL not in Supabase allowlist | Add wildcard to Supabase Auth → Redirect URLs (§4.3) |
| Env var not found at runtime | Var missing for environment scope | `vercel env ls <env>`; add with `vercel env add` |
| Build succeeds but app shows wrong data | Production branch pointed at dev Supabase | Verify `NEXT_PUBLIC_SUPABASE_URL` scope in dashboard |
| `vercel.json` changes ignored | Config at wrong path | Must live at `apps/frontend/vercel.json`; confirm with `vercel inspect` |
| Domain shows `Invalid Configuration` | DNS not propagated or wrong record | `vercel domains inspect <domain>`; re-check A/CNAME records |

### 7.4 Re-trigger a deployment manually

```bash
cd apps/frontend
vercel deploy --prod          # production deploy
vercel deploy                 # preview deploy
```

Or from the dashboard: Deployments → **⋯ → Redeploy**.

---

## 8. Cross-References

| Topic | Location |
|-------|---------|
| Project setup via REST API | `runbooks/vercel-01-project.md` |
| DNS, preview URLs, auth redirect | `runbooks/vercel-02-deploys.md` |
| Hobby limits, CI/CD, Server Actions | `runbooks/vercel-03-policy-ci.md` |
| Deployment flow diagram | `runbooks/vercel-05-deployment-flow.md` |
| Supabase local dev | `runbooks/supabase-01-local-dev.md` |
| Supabase remote setup | `runbooks/supabase-02-remote.md` |
| Related issues | TJ-019 (this), TJ-018 (Server Actions), TJ-024 (compute worker), TJ-026 (prod cutover) |
