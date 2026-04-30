# Decision: TJ-017 — Supabase JWT Validation Approach

**Author:** Hockney (Backend Dev)  
**Date:** 2026-07  
**PR:** #70  
**Status:** Accepted

---

## Context

The frontend (Fenster, PR #86) uses `@supabase/ssr` which issues Supabase JWTs
to the browser.  The backend must validate these JWTs server-side without
requiring a database round-trip per request.

---

## Decisions

### 1. JWKS preferred over shared secret

**Decision:** Verify JWTs against the Supabase JWKS endpoint (`/auth/v1/.well-known/jwks.json`) using RS256/ES256 asymmetric keys as the primary path.

**Rationale:** Asymmetric verification never requires the service-role key or JWT secret to leave the Supabase project.  JWKS is the documented Supabase v2 production approach.  Avoids `SUPABASE_JWT_SECRET` exposure in backend environment.

### 2. HS256 fallback only on JWKS unavailability

**Decision:** Fall back to HS256 with `SUPABASE_JWT_SECRET` *only* when the JWKS endpoint is unreachable (network error) — NOT on signature validation failures.

**Rationale:** Falling back on invalid signatures would silently downgrade security.  The fallback is strictly for local dev (`supabase start` issues HS256) and transient JWKS outages.

### 3. `SUPABASE_URL` as backend env var alias

**Decision:** Backend reads `SUPABASE_URL` (canonical) with `NEXT_PUBLIC_SUPABASE_URL` accepted as an alias via `pydantic.AliasChoices`.

**Rationale:** Allows a single `.env.local` shared between the Next.js frontend and the Docker FastAPI worker without duplication, while keeping the backend env var name server-appropriate (no `NEXT_PUBLIC_` prefix).

### 4. Existing `app/auth/` not removed in this PR

**Decision:** The local username/password JWT system (`app/auth/`) is left in place.  Only the *new* Supabase path is added.

**Rationale:** Cutover requires coordinated migration of any existing users and test fixtures.  Separate ticket to avoid breaking the current CI.

### 5. Module-level singleton JWKS cache

**Decision:** A single `JWKSCache` instance is initialized at startup via the FastAPI `lifespan` hook and shared across all requests.

**Rationale:** Avoids per-request key fetches.  TTL (1 hour) balances freshness with JWKS endpoint load.  asyncio.Lock prevents thundering-herd on cache miss.

---

## Rejected Alternatives

- **PyJWT + PyJWKClient:** Would replace `python-jose` which is already installed.  No benefit outweighs the churn.
- **Supabase Python client:** Adds a heavy SDK dependency; JWT validation is self-contained and doesn't need it.
- **Verify in middleware:** Router-level `Depends()` is more idiomatic for FastAPI and allows per-endpoint opt-out for public paths.
