# Decision: E2E Testing Strategy

**Date:** 2026-05-02  
**Author:** Keaton (Lead)  
**Status:** Approved  
**Scope:** Cross-team

## Decision

We use **Playwright** for browser-driven E2E tests, running in the existing `apps/frontend/e2e/` directory (not a separate package).

### Test Environment

**Hybrid model:**
- **Dev Supabase** (`zvbwgxdgxwgduhhzdwjj`) for CI runs — exercises real Supabase round-trips, RLS, household trigger
- **Local Supabase** (`supabase start`) for developer iteration — fast, offline-capable
- **Production** — read-only smoke only (page loads, no mutations), triggered post-Vercel-deploy

### Test-User Strategy

Throwaway users with pattern `e2e_<ts>_<rand>@example.com`. Created via service-role admin API, wait for household provisioning trigger, inject auth cookies. Deleted in `afterAll`. Cleanup script catches orphans > 1hr old.

### CI Integration

| Trigger | Suite | Blocking? |
|---------|-------|-----------|
| PR | Smoke + Auth | Yes |
| Nightly (03:00 UTC) | Full (smoke + auth + flows) | Yes (creates issue on failure) |
| Post-deploy | Prod smoke (read-only) | Alert only |

### Provisioning Helper Language

TypeScript — same runtime as Playwright, direct import into fixtures.

## Rationale

- Dev Supabase catches prod-only issues (migration drift, trigger behavior) that local misses
- Local Supabase is fastest for iteration but doesn't replicate hosted behavior exactly
- No mutations against prod eliminates data pollution risk
- Extending existing scaffold avoids rebuild; fixtures, admin client, cleanup already exist

## Issues

#144 (scaffold), #145 (provisioning), #146 (auth test), #147 (finances flow), #148 (trades flow), #149 (CI workflow), #150 (prod smoke), #151 (seed utilities)

## References

- `docs/testing/e2e-strategy.md`
- PR #143
