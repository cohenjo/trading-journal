# Decision: Startup & Access Pattern — Vercel + Supabase

**By:** Kujan (DevOps/Platform)
**Date:** 2026-04-30
**Context:** Completed first end-to-end boot verification of local dev + first Vercel deployment.

---

## Access URLs

| Environment | URL | Notes |
|-------------|-----|-------|
| Local dev | `http://localhost:3000` | After `vercel pull` + copy step + `npm run dev` |
| Dev deployment | `https://trading-journal-<hash>-cohenjos-projects.vercel.app` | Hash changes per deploy; 401 without Vercel org auth |
| Production | `https://trading-journal.vercel.app` | Canonical; live on main branch push |

---

## Startup Commands (canonical)

```bash
# One-time setup per machine / after key rotation
set -a && source /Users/jocohe/projects/trading-journal/.env && set +a
cd apps/frontend
vercel pull --token "$VERCEL_TOKEN" --scope cohenjos-projects --yes --environment=development
cp .vercel/.env.development.local .env.development.local

# Daily start
npm install && npm run dev
```

---

## Key Gotchas

1. **`.env` is in main repo worktree**, not coord worktree. Always source from full path.
2. **`vercel pull` ≠ `.env.development.local` at project root.** The copy step is mandatory for `npm run dev`. Without it: 500 on every request.
3. **Vercel scope is `cohenjos-projects` (org), not `cohenjo` (personal).** Wrong scope = empty listings or auth errors.
4. **Dev deployments are protection-gated** (401 to anonymous). Disable in Project Settings or generate shareable link.
5. **`vercel.json` `preferredRegion` inside `functions` is invalid** — use top-level `regions: ["fra1"]` instead.

---

## Supabase Project Refs

| Env | Ref | Verified |
|-----|-----|---------|
| DEV | `zvbwgxdgxwgduhhzdwjj` | ✅ (confirmed in pulled env vars) |
| PROD | `jaesiklybkbmzpgipvea` | ✅ (in production Vercel env vars) |

---

## Related

- Full runbook: `docs/design-hosting/runbooks/vercel-06-startup-and-access.md`
- First deployment inspect: `https://vercel.com/cohenjos-projects/trading-journal/C6XcFB3YXpHMVNGVNTAi18QPZ6Ao`
- 8 Vercel env vars confirmed: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` × 2 environments
