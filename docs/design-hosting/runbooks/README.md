# Hosting Setup Runbooks

> Status: drafts. Verify all ⚠️-flagged items against live docs before executing.

These deep-dive runbooks support the migration plan in [`../design.md`](../design.md). Each is owned by the squad member listed.

## Supabase

| # | Topic | Owner | File |
|---|-------|-------|------|
| 01 | Local dev (CLI install, `supabase start`, migrations) | Kujan | [supabase-01-local-dev.md](./supabase-01-local-dev.md) |
| 02 | Remote provisioning + Management API + backups | Kujan | [supabase-02-remote.md](./supabase-02-remote.md) |
| 03 | Google OAuth + RLS + households schema | Rabin | [supabase-03-auth-rls.md](./supabase-03-auth-rls.md) |

## Vercel

| # | Topic | Owner | File |
|---|-------|-------|------|
| 01 | Project setup + env vars (CLI + REST API) | Hockney | [vercel-01-project.md](./vercel-01-project.md) |
| 02 | Deploys, preview URLs, redirect-URI gotcha, DNS | Fenster | [vercel-02-deploys.md](./vercel-02-deploys.md) |
| 03 | Hobby limits, commercial-use policy, GitHub Actions CI | Keaton | [vercel-03-policy-ci.md](./vercel-03-policy-ci.md) |

## Combined drafts (legacy/reference)

- `../setup-supabase.md` — Kujan's original combined draft (498 lines). Superseded by the three Supabase deep-dives above; kept for cross-reference.

## Reading order for first-time setup

1. `../design.md` §Architecture (understand the picture)
2. `supabase-01-local-dev.md` (get a local stack running)
3. `supabase-03-auth-rls.md` §4–6 (apply the schema)
4. `vercel-01-project.md` (link the frontend)
5. `supabase-02-remote.md` (provision dev project — see TJ-000 blockers first)
6. `vercel-02-deploys.md` (configure preview redirects)
7. `vercel-03-policy-ci.md` (wire CI + verify Hobby fits)

## Open questions to verify (gathered from ⚠️ flags)

- Supabase free-tier project pause: 7 days inactivity → data preserved? (Kujan-remote)
- Supabase wildcard syntax in Redirect URLs (Rabin, Fenster)
- Vercel Hobby bandwidth quota — not present in fetched docs table (Keaton)
- Vercel exact A-record IP for apex domains (Fenster)
- Google OAuth wildcard support for preview origins (Rabin)
