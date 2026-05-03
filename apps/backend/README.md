# Trading Journal Backend

FastAPI compute backend for Trading Journal. CRUD data paths are moving to Supabase; the remaining FastAPI routes provide compute workflows such as simulations, options projection, backtests, pension uploads, analysis, tax-condor tooling, scanners, pricing, and sync jobs.

## Quick start: backend talking to Supabase locally + tunnel for Vercel

This mode runs only the backend in Docker on Jony's laptop. It does **not** start the legacy local Postgres service from `docker-compose.yml`; the backend connects directly to Supabase Postgres.

### Required environment variables

Copy the root `.env.example` to `.env` and fill these server-only values:

| Variable | Purpose | Where to get it |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | Supabase Postgres or pooler connection string. `docker-compose.backend.yml` passes it through as `DATABASE_URL`. Include `sslmode=require` for direct Supabase Postgres. | Supabase dashboard → project `zvbwgxdgxwgduhhzdwjj` → Database → Connection string |
| `SUPABASE_URL` | Supabase Auth/JWKS base URL. | `https://zvbwgxdgxwgduhhzdwjj.supabase.co` |
| `SUPABASE_JWT_SECRET` | Optional HS256 fallback for local/Supabase JWT verification. | Supabase dashboard → Auth → JWT settings |
| `BACKEND_CORS_ORIGINS` | Comma-separated browser origins allowed to call FastAPI. | Local dev and Vercel deployment URLs |

Recommended local value:

```dotenv
BACKEND_CORS_ORIGINS=http://localhost:3000,https://trading-journal-cohenjos-projects.vercel.app,https://*.vercel.app
```

Use exact preview URLs instead of `https://*.vercel.app` if you want a tighter allow-list.

### Run backend-only Docker compose

```bash
docker compose -f docker-compose.backend.yml up -d --build
docker compose -f docker-compose.backend.yml ps
curl http://localhost:8000/health
```

The compose file uses the production-style image (no source bind mount and no `--reload`) and publishes `8000:8000`. The `/health` endpoint returns 200 only after a database `SELECT 1` succeeds.

To stop it:

```bash
docker compose -f docker-compose.backend.yml down
```

### Cloudflare Tunnel for Vercel

Cloudflare Tunnel is the recommended way to expose the laptop backend without opening router ports.

```bash
cloudflared tunnel login
cloudflared tunnel create tj-backend
cloudflared tunnel route dns tj-backend api.your-domain.example
cloudflared tunnel run tj-backend --url http://localhost:8000
```

Alternatives: Tailscale Funnel or ngrok can expose the same local `http://localhost:8000` service. Keep the public URL HTTPS and stable enough for Vercel environment variables.

### Point Vercel at the tunnel

1. Open the Vercel dashboard for `https://trading-journal-cohenjos-projects.vercel.app`.
2. Set `NEXT_PUBLIC_API_URL` to the tunnel URL, for example `https://api.your-domain.example`.
3. Apply it to Production and Preview environments.
4. Redeploy the frontend.

`apps/frontend/next.config.ts` already proxies `/api/*` to `NEXT_PUBLIC_API_URL` when the variable is set to a public URL. If it is unset in production, `/api/*` remains disabled and unmigrated compute calls fail fast with 404.

### Offline behavior

If Jony's laptop is offline, asleep, Docker is stopped, or the tunnel is down, Vercel `/api/*` compute calls fail with 5xx/connection errors. This is an accepted TJ-019 tradeoff: the walkthrough allow-list already tolerates the remaining compute endpoints being unavailable while CRUD paths continue through Supabase.

## Auth and CORS

All compute routers in `main.py` are registered with `Depends(get_current_user)`, which verifies Supabase JWTs using JWKS from `SUPABASE_URL` or the `SUPABASE_JWT_SECRET` fallback. CORS is a tight allow-list read from `BACKEND_CORS_ORIGINS`; do not use `*` for this financial application.

See also [`README-supabase-auth.md`](./README-supabase-auth.md) for JWT verification details.
