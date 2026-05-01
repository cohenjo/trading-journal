# Decision: Backend JWT Validator Switch (Supabase)

**Date**: 2026-05-01  
**Author**: Fenster (Frontend Dev)  
**Status**: Implemented (PR #122)  
**Issue**: #121

## Context

After implementing Supabase auth in PR #96, the frontend correctly forwards Supabase JWTs via `Authorization: Bearer` headers using `apiFetch()`. However, ALL protected API endpoints returned 403 `{"detail":"Not authenticated"}` because the backend was using a mismatched JWT validator.

## The Problem

**Backend `main.py` imported the wrong dependency:**
```python
from app.auth.dependencies import get_current_user  # ❌ OLD: local JWT system
```

This dependency (`app.auth.dependencies.get_current_user`):
- Expects JWTs signed by the backend using `JWT_SECRET_KEY` (HS256)
- Validates with `app.auth.security.verify_token()` using `python-jose`
- Cannot validate Supabase JWTs (signed by Supabase with RS256 via JWKS)

**Supabase JWTs use a different signing mechanism:**
- Signed by Supabase Auth with RS256 (asymmetric) or ES256
- Require fetching public keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`
- Cannot be verified with a shared secret key

## The Solution

**Change `main.py` import to use the Supabase JWT validator:**
```python
from app.dependencies import get_current_user  # ✅ NEW: Supabase JWT
```

The new `app.dependencies.get_current_user`:
1. Extracts the JWT from `Authorization: Bearer <token>` header
2. Calls `app.supabase_auth.verify_supabase_jwt(token, settings, cache)`
3. The verifier:
   - Fetches public keys from Supabase JWKS endpoint (cached with TTL)
   - Validates signature, issuer, audience, and expiration
   - Falls back to `SUPABASE_JWT_SECRET` for HS256 local dev tokens
4. Returns `SupabaseClaims` with `sub` (user UUID), `email`, `role`, etc.

**This was a one-line change** because the backend already had:
- The Supabase JWT verifier (`app.supabase_auth.verify_supabase_jwt`)
- JWKS cache initialization in the lifespan handler (`main.py` line 88)
- The dependency wrapper (`app.dependencies.get_current_user`)

All that was missing was **using it** in the route dependency injection.

## Configuration

Backend `.env` must include:
```bash
SUPABASE_URL=https://zvbwgxdgxwgduhhzdwjj.supabase.co
# Optional: SUPABASE_JWT_SECRET for HS256 fallback (local dev)
```

The `SupabaseAuthSettings` class reads from environment using `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` (fallback for shared `.env` files).

## Alternatives Considered

1. **Keep local JWT system and have frontend use it**
   - ❌ Rejected: Would require backend to issue JWTs after Supabase auth, adding complexity
   - ❌ Loses Supabase's built-in session management, refresh tokens, and security features
   
2. **Add middleware to translate Supabase JWT → local JWT**
   - ❌ Rejected: Unnecessary complexity and latency
   - ❌ Duplicates authentication logic

3. **Use the NEW Supabase JWT validator** ✅
   - Already implemented in the codebase
   - One-line change to switch over
   - Native Supabase integration (JWKS, refresh tokens, etc.)

## Impact

**Before fix**: All 5 Wave 1 endpoints + all protected endpoints returned 403  
**After fix**: 53/60 smoke tests passed (7 webkit failures due to Supabase rate limiting, NOT auth)

Unblocks:
- Wave 1 pages (current-finances, summary, cash-flow, settings)
- Wave 2 backend CRUD operations (all use the same auth dependency)
- Wave 3 household sharing (RLS relies on `auth.uid()` matching Supabase JWT `sub` claim)

This was THE single highest-leverage fix per issue #121.

## Migration Path

For other developers:
1. Add `SUPABASE_URL` to backend `.env` (using same value as frontend's `NEXT_PUBLIC_SUPABASE_URL`)
2. Pull latest `main` (includes this PR)
3. Restart backend — JWKS cache will warm up automatically

**No database migrations required** — this is purely an API-layer change.

## Future Deprecation

The old `app.auth` module (local JWT system) should be removed once Supabase auth is fully stable:
- `app/auth/dependencies.py` → delete
- `app/auth/security.py` → delete
- `User.password_hash` column → drop in migration
- `JWT_SECRET_KEY` env var → remove

Track in: issue #TBD (create after Wave 1 stabilizes)
