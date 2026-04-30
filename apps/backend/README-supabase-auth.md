# Supabase JWT Validation — Backend Auth

**Owner:** Hockney (Backend Dev)  
**Added:** TJ-017 / PR #70  
**Status:** Ready — existing `app/auth/` NOT yet removed (see Migration Plan below)

---

## How It Works

```
Client
  │  Authorization: Bearer <supabase_jwt>
  ▼
FastAPI endpoint
  │  Depends(get_current_user)
  ▼
app/dependencies.py → get_current_user()
  │  extracts Bearer token
  ▼
app/supabase_auth.py → verify_supabase_jwt()
  │
  ├─ alg == HS256? → verify with SUPABASE_JWT_SECRET (local dev)
  │
  └─ alg == RS256/ES256 (production)?
       │
       ├─ JWKSCache.get_signing_key(kid)
       │     └─ fetches https://<project>.supabase.co/auth/v1/.well-known/jwks.json
       │        (cached 1 hour, refreshed on unknown kid for rotation)
       │
       └─ jose.jwt.decode(token, public_key, aud=..., iss=...)
            └─ returns SupabaseClaims(sub, email, role, aud, exp)
```

### Verification checks

| Check | Value |
|-------|-------|
| Signature | RS256/ES256 via JWKS public key (or HS256 via secret) |
| `aud` | `"authenticated"` |
| `iss` | `https://<project-ref>.supabase.co/auth/v1` |
| `exp` | Enforced — expired tokens raise 401 |
| `iat` | Enforced |

### HS256 fallback

If `SUPABASE_JWT_SECRET` is set **and** the JWKS endpoint is unreachable (network error only — not an invalid signature), the backend falls back to HS256 symmetric verification and logs a warning.  This covers:

- Local `supabase start` dev instances that issue HS256 tokens.
- Transient JWKS outages in production (graceful degradation).

---

## Using `Depends(get_current_user)` in Endpoints

```python
from uuid import UUID
from fastapi import APIRouter, Depends
from app.dependencies import get_current_user, get_current_user_id, require_role
from app.supabase_auth import SupabaseClaims

router = APIRouter()

# --- Full claims ---
@router.get("/me")
async def me(claims: SupabaseClaims = Depends(get_current_user)):
    return {"user_id": str(claims.sub), "email": claims.email}

# --- Just the UUID (most common) ---
@router.get("/trades")
async def list_trades(user_id: UUID = Depends(get_current_user_id)):
    return await Trade.for_user(user_id)

# --- Role guard ---
@router.post("/admin/seed")
async def seed(claims: SupabaseClaims = Depends(require_role("service_role"))):
    ...
```

---

## Local Dev Setup

### Option A — Supabase local stack (`supabase start`)

`supabase start` issues **HS256** tokens signed with a local JWT secret.

```dotenv
# .env.local (never committed)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_JWT_SECRET=<jwt-secret from `supabase status`>
```

The backend will use the JWT secret directly (no JWKS fetch needed).

### Option B — Supabase Cloud project (dev project)

```dotenv
# .env.local (never committed)
SUPABASE_URL=https://<your-project-ref>.supabase.co
# SUPABASE_JWT_SECRET is optional — JWKS is preferred
```

The backend fetches public keys from the JWKS endpoint automatically.

### Env var aliases

The setting also accepts `NEXT_PUBLIC_SUPABASE_URL` so a single `.env.local` 
shared between the Next.js frontend and the Docker FastAPI backend works 
without duplication.

### Diagnostics endpoint

```bash
curl http://localhost:8001/health/auth
# {"status":"ok","key_count":2,"populated":true}
```

---

## Migration Plan (NOT implemented in this PR)

The existing `app/auth/` module (local username/password JWT system) is 
**intentionally preserved** for a later cutover ticket.  Once Supabase is 
the sole identity provider:

- [ ] Remove `app/auth/security.py` and `app/auth/dependencies.py`
- [ ] Remove `app/api/auth.py` (register/login endpoints)
- [ ] Remove `User` model from `app/schema/user_models.py`
- [ ] Remove `passlib`/`bcrypt` dependencies (unless still needed elsewhere)
- [ ] Remove `JWT_SECRET_KEY` and `ACCESS_TOKEN_EXPIRE_MINUTES` env vars
- [ ] Replace `auth_dep = [Depends(get_current_user)]` in `main.py` with
      `auth_dep = [Depends(supabase_get_current_user)]` from `app.dependencies`
- [ ] Update `conftest.py` to stub `app.dependencies.get_current_user` instead
      of `app.auth.dependencies.get_current_user`

> **Runtime dependency note:** This PR has a runtime dependency on PR #85
> (Supabase `auth.users` table must exist in the Postgres schema) but no 
> build-time dependency — the backend compiles and starts without it.

---

## Security Notes

- `SUPABASE_JWT_SECRET` is stored as `pydantic.SecretStr` — never logged.
- Token contents are never written to logs; only algorithm names and error types are logged.
- Auth failures are logged at WARNING level for audit trail.
- The JWKS cache is module-level singleton, warmed at startup via `lifespan`.
