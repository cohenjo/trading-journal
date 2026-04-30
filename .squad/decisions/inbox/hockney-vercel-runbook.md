# Decision: Vercel Setup Runbook & Deployment Patterns

**Date:** 2026-05-01  
**Author:** Hockney (Backend Dev)  
**Status:** Approved  
**Scope:** Vercel CLI workflow, environment variables, preview deploys, DNS, CI/CD integration

---

## Context

Jony's trading journal is moving from laptop-only Docker setup to hosted service. We've chosen Vercel for Next.js 15 frontend hosting (free Hobby tier), Supabase for Postgres + Auth, and Next.js Server Actions as CRUD layer replacing FastAPI endpoints. This decision documents the Vercel-specific deployment patterns and operational procedures.

---

## Key Decisions

### 1. Monorepo CLI Workflow

**Decision:** Use `vercel link` from `apps/frontend/` directory; `.vercel/project.json` is gitignored so each developer links independently.

**Rationale:**
- Monorepo root ≠ Next.js app root (`apps/frontend/`)
- Vercel auto-detects Next.js framework preset when run from correct directory
- Gitignoring `.vercel/project.json` prevents team ID conflicts across developers
- `--cwd apps/frontend` flag enables root-level commands but adds cognitive load; `cd apps/frontend` first is clearer

**Alternative rejected:** Committing `.vercel/project.json` to git (causes conflicts when team members have different Vercel accounts/teams).

---

### 2. Environment Variable Security Model

**Decision:** Use three-tier environment targeting (production/preview/development) with strict `NEXT_PUBLIC_` prefix discipline. Service role keys NEVER get public prefix.

**Rationale:**
- Next.js bundles all `NEXT_PUBLIC_*` vars into browser JS at build time
- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security — leaking this is critical vulnerability
- Vercel's environment targets align with branch strategy: production (`main`), preview (all other branches), development (local)
- Explicit per-environment values prevent prod credentials from leaking to preview deploys

**Implementation:**
```
✅ NEXT_PUBLIC_SUPABASE_URL (browser-safe)
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY (browser-safe when RLS is correct)
❌ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY (NEVER — bypasses RLS)
✅ SUPABASE_SERVICE_ROLE_KEY (server-only, use sparingly)
```

**Enforcement:** Code review must flag any `NEXT_PUBLIC_` prefix on sensitive keys.

---

### 3. Preview Deploy OAuth Strategy

**Decision:** Use static redirect proxy pattern OR per-PR allowlisting automation. Do NOT rely on wildcard redirect URIs (not supported by most OAuth providers).

**Problem:** Vercel preview URLs are dynamic (`https://trading-journal-git-feature-xyz-user.vercel.app`). Google OAuth, GitHub OAuth, and most providers don't accept `https://trading-journal-*-user.vercel.app/auth/callback` as a valid redirect URI.

**Solution paths:**
1. **Static redirect proxy (recommended):** Register one stable URL (`https://auth.trading-journal.example.com/callback`), proxy captures original preview URL in signed state, completes auth, redirects back to preview.
2. **Per-PR automation:** GitHub Action adds exact preview URL to Supabase/Google allowlist on PR open, removes on merge/close. Tedious but works.
3. **Wildcard (check docs):** Supabase *may* support limited wildcards like `https://trading-journal-*-user.vercel.app/auth/callback`. Verify against current docs before relying on this.

**Selected for now:** Static redirect proxy (to be implemented in TJ-025).

**Alternative rejected:** Manually adding preview URLs per-test (doesn't scale).

---

### 4. CI/CD Ownership Split

**Decision:** Let Vercel's git integration handle all deploys. GitHub Actions runs tests/lint only.

**Rationale:**
- Avoids duplicate builds (Vercel + GitHub Actions both building)
- Vercel's build infrastructure is optimized for Next.js (faster, edge caching)
- Simpler secret management (no need to expose VERCEL_TOKEN/ORG_ID/PROJECT_ID to GitHub)
- GitHub Actions remains focused on quality gates (tests, lints, type-checking)

**When to override:** If deploy must be gated on test passage or manual approval, use `vercel deploy --prebuilt` from GitHub Actions. Add secrets: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID.

**Gating pattern (if needed):**
```yaml
- run: vercel pull --yes --environment=production --token=$VERCEL_TOKEN
- run: vercel build --prod --token=$VERCEL_TOKEN
- run: vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

---

### 5. Hobby Plan Compliance

**Decision:** Confirm Jony's use case is personal/non-commercial before production cutover. If any revenue-generating activity, upgrade to Pro ($20/month).

**Hobby plan constraints:**
- **100 GB/month bandwidth** (hard cap — site pauses if exceeded)
- **120s function timeout** (long-running compute must offload to Docker worker)
- **No commercial use** (no ads, payments, affiliate marketing, business use)
- **1 concurrent build** (PRs may queue)

**Risk:** Account suspension if commercial use detected. Jony's household financial tracking appears personal, but must confirm no business usage.

**Mitigation:** Add usage monitoring alert (Vercel dashboard → Settings → Notifications) for 80% bandwidth threshold.

---

### 6. DNS Configuration

**Decision:** Use A record for apex domain, CNAME for subdomains. Vercel's current anycast IP is `76.76.21.21`.

**Implementation:**
```
example.com        A      76.76.21.21
www.example.com    CNAME  cname.vercel-dns.com
```

**⚠️ Caveat:** Vercel may rotate anycast IPs. Always verify against https://vercel.com/docs/projects/domains/add-a-domain before DNS cutover.

**Alternative rejected:** ALIAS/ANAME records (not all registrars support; A record is universal).

---

### 7. Server Actions as CRUD Layer

**Decision:** Replace FastAPI CRUD endpoints with Next.js Server Actions one-by-one (phased migration per TJ-014).

**Pattern:**
```typescript
'use server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createTrade(formData: FormData) {
  const supabase = createServerClient(/* anon key + cookies */);
  // User session from cookies → RLS enforced automatically
  return await supabase.from('trades').insert(...);
}
```

**Rationale:**
- Eliminates FastAPI as public attack surface
- RLS enforcement happens at Supabase layer (defense in depth)
- Type-safe RPC between client/server (no REST schema drift)
- 120s timeout sufficient for CRUD (heavy compute stays in Docker)

**Phasing:** Keep `NEXT_PUBLIC_API_URL` during migration; remove once all CRUD migrated.

**Heavy compute stays local:** Backtesting, PDF parsing, broker sync write to `raw_*` tables; Docker worker continues running on Jony's machine.

---

### 8. Rollback + Observability

**Decision:** Use `vercel rollback <url>` for production incidents. Pipe logs to Supabase for retention beyond Hobby tier's ~1 hour window.

**Hobby plan log retention:** ~1 hour to 1 day (verify current docs). Not sufficient for incident analysis.

**Solution:** Structured logging from Server Actions to Supabase `logs` table:
```typescript
await supabase.from('logs').insert({
  level: 'error',
  message: err.message,
  context: { userId, tradeId },
  timestamp: new Date().toISOString(),
});
```

**Alerts:** Free Slack/Discord webhook notifications for deployment errors (enabled in TJ-026).

---

## Implementation Checklist

- [x] Write runbook: `docs/design-hosting/setup-vercel.md`
- [ ] **TJ-019:** Execute `vercel link` + configure project settings
- [ ] **TJ-014:** Migrate env vars from `.env` to Vercel dashboard (production/preview/development)
- [ ] **TJ-025:** Implement static redirect proxy for preview OAuth
- [ ] **TJ-026:** Configure custom domain DNS + SSL verification
- [ ] **TJ-008:** Wire GitHub Actions for test/lint (disable Vercel auto-deploy or keep separate)
- [ ] Confirm Hobby plan compliance (personal use only)
- [ ] Set bandwidth alert at 80 GB/month
- [ ] Test Server Action CRUD pattern with one endpoint (e.g., `createTrade`)

---

## Open Questions

1. **Wildcard redirect URIs:** Does Supabase Auth support `https://trading-journal-*-<scope>.vercel.app/auth/callback` as of 2024? (Verify in TJ-025.)
2. **Custom domain choice:** Has Jony registered a domain, or using `*.vercel.app` indefinitely? (Clarify in TJ-026.)
3. **Vercel Analytics:** Enable free analytics on Hobby plan for usage tracking? (Nice-to-have, not blocking.)

---

## Cross-References

- **Parent design:** `docs/design-hosting/design.md` (approved 2026-04-30)
- **Frontend strategy:** `docs/design-hosting/sections/02-frontend-strategy.md` (Fenster)
- **CI/CD architecture:** `docs/design-hosting/sections/04-deployment-cicd.md` (Kujan)
- **Supabase runbook:** `docs/design-hosting/setup-supabase.md` (Kujan, parallel work)
- **Issues:** TJ-008, TJ-014, TJ-019, TJ-025, TJ-026

---

**Decision recorded by Hockney, 2026-05-01.**
