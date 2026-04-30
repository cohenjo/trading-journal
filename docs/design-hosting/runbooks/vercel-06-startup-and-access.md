# Vercel 06 — Startup & Access Reference (Kujan)

> **Scope:** Day-to-day developer operations — local dev boot, dev deployment, prod deployment,
> env switching, and troubleshooting. Written and verified 2026-04-30.
>
> **Sister runbooks:** [supabase-01-local-dev](./supabase-01-local-dev.md) ·
> [vercel-04-project-link-and-env](./vercel-04-project-link-and-env.md) ·
> [vercel-05-deployment-flow](./vercel-05-deployment-flow.md)

---

## ⚡ Quick-reference cheat sheet

```bash
# 1. Get me running locally (dev env, first time)
set -a && source /Users/jocohe/projects/trading-journal/.env && set +a
cd apps/frontend
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=development
cp .vercel/.env.development.local .env.development.local   # ← required for npm run dev
npm install
npm run dev   # → http://localhost:3000 (redirects to /summary; auth-gated)

# 2. Deploy to dev (preview deployment using development env vars)
set -a && source /Users/jocohe/projects/trading-journal/.env && set +a
cd apps/frontend
vercel deploy --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes
# → prints URL: https://trading-journal-<hash>-cohenjos-projects.vercel.app

# 3. See deployment logs (after deploy)
vercel logs <deploy-url> --token "$VERCEL_TOKEN" --scope cohenjos-projects

# 4. Rotate Supabase keys (update in Vercel after rotation)
vercel env rm SUPABASE_SERVICE_ROLE_KEY production --token "$VERCEL_TOKEN" --scope cohenjos-projects
vercel env add SUPABASE_SERVICE_ROLE_KEY production --token "$VERCEL_TOKEN" --scope cohenjos-projects
# Then re-pull: vercel pull --environment=development (or production)

# 5. Switch to production env locally
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=production
cp .vercel/.env.production.local .env.production.local
npm run dev   # ← now using prod Supabase; be careful with real data
```

---

## 1. Local development

### 1.1 Prerequisites

| Item | Value |
|------|-------|
| Vercel CLI | `npm i -g vercel` (verify: `vercel --version`) |
| Node.js | ≥ 20 (match CI) |
| `VERCEL_TOKEN` | Available in `.env` at repo root (`/Users/jocohe/projects/trading-journal/.env`) |
| Working directory | `apps/frontend/` relative to the **coord worktree** (`trading-journal-coord`) |

### 1.2 Load secrets

The `.env` file lives in the **main repo worktree**, not the coord worktree:

```bash
# From the coord worktree root:
set -a && source /Users/jocohe/projects/trading-journal/.env && set +a
# Verify: echo "VERCEL_TOKEN=${VERCEL_TOKEN:+SET}"
```

> ⚠️ The `.env` file may contain comment lines that bash will attempt to execute (harmless `bash: <word>: command not found` errors). These are safe to ignore.

### 1.3 Pull development env vars

```bash
cd apps/frontend
vercel pull \
  --token "$VERCEL_TOKEN" \
  --scope cohenjos-projects \
  --yes \
  --environment=development
```

This writes `.vercel/.env.development.local` with 4 vars:
- `NEXT_PUBLIC_SUPABASE_URL` — points to DEV project (`zvbwgxdgxwgduhhzdwjj`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

> **Critical gotcha — Next.js env loading:** `next dev` loads `.env.development.local` from
> the **project root**, not from `.vercel/`. Running `npm run dev` without the copy step will
> cause a 500 (`Your project's URL and Key are required to create a Supabase client!`).

### 1.4 Copy env to Next.js-readable location

```bash
cp .vercel/.env.development.local .env.development.local
```

Both files are already covered by `.gitignore` (`.env*` pattern).

> Alternative: use `vercel dev` instead of `npm run dev` — it reads `.vercel/` directly and
> proxies the Next.js dev server. Trade-off: slightly slower startup, loses Turbopack flag.

### 1.5 Install and start

```bash
npm install
npm run dev
# → http://localhost:3000
# Expected: HTTP 307 redirect to /summary (auth-gated — correct)
# Startup log shows: "- Environments: .env.development.local"
```

Port conflict: if 3000 is in use, Next.js auto-selects the next available port (e.g. 3002) and
prints the actual URL on startup.

### 1.6 Expected startup output

```
▲ Next.js 15.3.4 (Turbopack)
- Local:        http://localhost:3000
- Environments: .env.development.local
✓ Starting...
✓ Compiled middleware in ~180ms
✓ Ready in ~1s
```

### 1.7 Verifying the right Supabase

```bash
grep NEXT_PUBLIC_SUPABASE_URL .vercel/.env.development.local
# Expected: contains "zvbwgxdgxwgduhhzdwjj" (DEV project ref)
```

---

## 2. Dev environment access (remote deployment)

### 2.1 Vercel environments

| Vercel env | Supabase project | Trigger |
|------------|-----------------|---------|
| `development` | DEV (`zvbwgxdgxwgduhhzdwjj`) | `vercel deploy` (no `--prod` flag) |
| `production` | PROD (`jaesiklybkbmzpgipvea`) | `vercel deploy --prod` or main-branch push |

> **No preview environment:** The team uses only `production` + `development`. See
> [decisions.md](../../../.squad/decisions.md) — Keaton's two-project decision (free-tier cap
> of 2 Supabase projects).

### 2.2 Deploy to dev

From `apps/frontend/`:

```bash
vercel deploy --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes
```

Output includes:
- **Inspect URL:** `https://vercel.com/cohenjos-projects/trading-journal/<build-id>`
- **Preview URL:** `https://trading-journal-<hash>-cohenjos-projects.vercel.app`

> The preview URL is **deployment-protection-gated** (returns 401 for unauthenticated requests).
> Access requires a Vercel account in the `cohenjos-projects` org, or disable deployment
> protection in Vercel project settings → General → Deployment Protection.

### 2.3 Verify dev Supabase in a deployment

Check the build output or runtime logs:
```bash
vercel logs <deploy-url> --token "$VERCEL_TOKEN" --scope cohenjos-projects
# Look for NEXT_PUBLIC_SUPABASE_URL containing "zvbwgxdgxwgduhhzdwjj"
```

Or check Vercel dashboard: Project → Deployments → select deploy → Functions → Environment Variables.

---

## 3. Production environment access

### 3.1 Production URL

```
https://trading-journal.vercel.app
```

This is the canonical production URL (Vercel default domain). Custom domains can be added in
Vercel project settings.

### 3.2 Deploy to production

**Option A — Manual:**
```bash
vercel deploy --prod --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes
```

**Option B — Git push to main (recommended):**
```bash
git push origin main
# Vercel GitHub App picks this up automatically and deploys to production
```

> ⚠️ Vercel auto-deploys on every push to `main`. Guard main with branch protection if you
> want a manual gate. See [vercel-05-deployment-flow](./vercel-05-deployment-flow.md) for the
> full PR → preview → production lifecycle.

### 3.3 Verify production

```bash
curl -sI https://trading-journal.vercel.app
# Expected: 307 or 200 (auth-gated, redirects to /summary)
vercel ls --token "$VERCEL_TOKEN" --scope cohenjos-projects
# Shows latest production deployment with status "● Ready"
```

---

## 4. Switching between environments locally

### 4.1 File locations

| `vercel pull --environment=` | Written to | Copy to |
|-----------------------------|-----------|---------|
| `development` | `.vercel/.env.development.local` | `.env.development.local` |
| `production` | `.vercel/.env.production.local` | `.env.production.local` |

Next.js load priority (highest first):
1. `.env.development.local` (when `NODE_ENV=development` / `npm run dev`)
2. `.env.development`
3. `.env.local`
4. `.env`

### 4.2 Switch to dev env

```bash
cd apps/frontend
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=development
cp .vercel/.env.development.local .env.development.local
npm run dev
```

### 4.3 Switch to production env (read-only check)

```bash
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=production
cp .vercel/.env.production.local .env.production.local
# Run build (not dev) to avoid accidentally writing to prod DB with hot-reload
npm run build && npm run start
```

> ⚠️ Running locally against production Supabase means any writes hit real data.
> Only do this for read-only inspection. Delete `.env.production.local` when done.

### 4.4 Gitignore status

Both `.env.development.local` and `.env.production.local` are covered by `.env*` in
`apps/frontend/.gitignore`. Never override this with `!.env.*.local`.

---

## 5. Troubleshooting

### 5.1 `VERCEL_TOKEN` not set

```
Error: Not authenticated. Run `vercel login` or pass --token.
```

**Fix:**
```bash
set -a && source /Users/jocohe/projects/trading-journal/.env && set +a
echo "VERCEL_TOKEN=${VERCEL_TOKEN:+SET}"   # should print "SET"
```

The `.env` lives in the **main repo** (`/Users/jocohe/projects/trading-journal/.env`), not the
coord worktree. If running from coord, adjust the path.

### 5.2 Wrong scope

```
Error: The specified scope does not exist
```

**Fix:** Always pass `--scope cohenjos-projects`. This is the team org slug, not your personal
username.

### 5.3 `vercel pull` succeeds but `npm run dev` 500s

**Symptom:** `Error: Your project's URL and Key are required to create a Supabase client!`

**Cause:** `vercel pull` writes env vars to `.vercel/.env.development.local`; Next.js does not
read the `.vercel/` subdirectory.

**Fix:**
```bash
cp .vercel/.env.development.local .env.development.local
```

Verify the correct file is loaded on startup: look for `- Environments: .env.development.local`
in the `npm run dev` output.

### 5.4 Expired or rotated Supabase keys

**Symptoms:** API calls return 401/403; Supabase Studio shows "Invalid JWT".

**Fix:**
1. Rotate key in Supabase Dashboard → Project Settings → API → Service Role Key (or Anon Key).
   See [Supabase Management API key rotation](https://supabase.com/dashboard/project/zvbwgxdgxwgduhhzdwjj/settings/api).
2. Update in Vercel:
   ```bash
   vercel env rm SUPABASE_SERVICE_ROLE_KEY development --token "$VERCEL_TOKEN" --scope cohenjos-projects
   vercel env add SUPABASE_SERVICE_ROLE_KEY development --token "$VERCEL_TOKEN" --scope cohenjos-projects
   ```
3. Re-pull: `vercel pull --environment=development ...` + copy step.
4. Redeploy: `vercel deploy ...`

### 5.5 Stale `.vercel/.env.*.local` files

After Supabase key rotation or project re-provisioning, the pulled env files are stale.

**Fix:**
```bash
rm .vercel/.env.development.local .env.development.local 2>/dev/null
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=development
cp .vercel/.env.development.local .env.development.local
```

### 5.6 `vercel.json` schema errors

**Symptom:** `Error: Invalid vercel.json - should NOT have additional property X`

**Fix:** Check Vercel's schema. Common mistake: `preferredRegion` belongs at the top level
(via `regions: ["fra1"]`), not nested inside `functions`. Reference:
[vercel.json schema](https://vercel.com/docs/projects/project-configuration).

### 5.7 Deployment protection / 401 on preview URL

Preview deployments return 401 for unauthenticated visitors. This is Vercel's Deployment
Protection feature. Options:
- Share via Vercel dashboard → Generate a shareable link (bypasses SSO for 24h)
- Disable protection: Vercel Project Settings → General → Deployment Protection → Off
- Access while logged in to `cohenjos-projects` Vercel org in your browser

### 5.8 `Vulnerable version of Next.js detected` during deploy

Vercel's build-time vulnerability scanner may flag the current Next.js version. Check
[Next.js CVE advisories](https://github.com/advisories?query=next.js). If the version is
current (`npm outdated next`), this may be a scanner lag. Update if a patched version is
available: `npm install next@latest`.

---

## 6. Environment inventory

### Supabase projects

| Env | Project ref | Dashboard URL |
|-----|------------|---------------|
| DEV | `zvbwgxdgxwgduhhzdwjj` | https://supabase.com/dashboard/project/zvbwgxdgxwgduhhzdwjj |
| PROD | `jaesiklybkbmzpgipvea` | https://supabase.com/dashboard/project/jaesiklybkbmzpgipvea |

### Vercel env vars (8 total — as of 2026-04-30)

| Variable | Environments | Notes |
|----------|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Development, Production | Different per env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Development, Production | Different per env |
| `SUPABASE_SERVICE_ROLE_KEY` | Development, Production | 🔴 Never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | Development, Production | Different per env |

---

## Cross-references

- **Local Supabase stack:** [supabase-01-local-dev.md](./supabase-01-local-dev.md)
- **Project linking & initial env push:** [vercel-04-project-link-and-env.md](./vercel-04-project-link-and-env.md)
- **PR → preview → production lifecycle:** [vercel-05-deployment-flow.md](./vercel-05-deployment-flow.md)
- **Secrets inventory:** [operations/secrets-and-env-vars.md](../operations/secrets-and-env-vars.md)
- **Backup & restore:** [operations/backup-and-restore.md](../operations/backup-and-restore.md)
