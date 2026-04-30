# Decision: TJ-019 Vercel Project Config

**Author:** Hockney  
**Date:** 2026-07  
**Issue:** TJ-019 / GH #72  
**Status:** Decided

---

## Context

Setting up Vercel project config files and runbooks for the Next.js frontend
monorepo subapp at `apps/frontend/`. Key choices were needed on region, env var
scoping, security headers, and `next.config.ts` changes.

---

## Decisions

### 1. Region: `fra1` (Frankfurt) via `functions.preferredRegion`

**Decision:** Use `fra1` (Frankfurt, `eu-central-1`) as the function region.

**Rationale:**
- User is in Tel Aviv, Israel. Frankfurt is the geographically closest Vercel
  region with an active EU data center.
- `fra1` is also the Supabase-recommended region for EU deployments; co-locating
  Vercel functions and the Supabase database in Frankfurt minimises round-trip
  latency on every Server Action (~80–120 ms savings vs. `iad1`).
- Implemented via `functions.preferredRegion` in `vercel.json` (not the top-level
  `regions` array, which is Pro/Enterprise only and breaks Hobby builds per
  `vercel-01-project.md`).

### 2. `SUPABASE_SERVICE_ROLE_KEY` — Production-only scope

**Decision:** `SUPABASE_SERVICE_ROLE_KEY` is added to Production environment only,
not Preview or Development.

**Rationale:**
- The service role key bypasses all Supabase RLS policies. Leaking it to preview
  builds exposes it in Vercel build logs and to any contributor with dashboard access.
- Preview environments use the dev Supabase project with the anon key + RLS — which
  is the correct security posture.
- Developers needing service-role operations locally should use `supabase status`
  to get the local service role key.

### 3. `experimental.serverActions` not added to `next.config.ts`

**Decision:** Do not add `experimental.serverActions: true` to `next.config.ts`.

**Rationale:**
- Server Actions became stable (GA) in Next.js 14. This project uses Next.js 15.3.4.
  The experimental flag is a no-op at best and potentially confusing at worst.

### 4. `output: 'standalone'` not added

**Decision:** Do not add `output: 'standalone'` to `next.config.ts`.

**Rationale:**
- Vercel builds Next.js natively and does not require standalone output mode.
- Standalone mode is needed for Docker/self-hosted deployments only (TJ-024 compute worker).
- Adding it could interfere with Vercel's own output handling. Conservative approach taken.

### 5. CSP `unsafe-inline` + `unsafe-eval`

**Decision:** CSP header includes `'unsafe-inline'` and `'unsafe-eval'` for scripts.

**Rationale:**
- Next.js 15 App Router injects inline scripts for hydration. Restricting these
  breaks the app without a nonce or hash-based CSP implementation.
- This is acceptable as a baseline; a stricter nonce-based CSP is a future hardening
  task (coordinate with Fenster on the frontend).

---

## Impact on Other Members

- **Fenster:** CSP header in `vercel.json` may need updating if new third-party scripts
  (analytics, charting CDN, etc.) are added. Amend the `connect-src` directive.
- **Keaton:** `preferredRegion: fra1` aligns with vercel-03 recommendation — no conflict.
- **Kujan:** `SUPABASE_SERVICE_ROLE_KEY` production-only policy must be respected in all
  Server Action code — never import from client components or preview-only code paths.
