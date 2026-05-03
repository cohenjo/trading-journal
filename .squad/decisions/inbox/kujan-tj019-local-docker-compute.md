# TJ-019 Decision: Local Docker Compute Backend + Tunnel

## Decision

Run the remaining FastAPI compute backend locally in Docker on Jony's laptop, connect it directly to Supabase Postgres with `DIRECT_DATABASE_URL`, verify Supabase JWTs at the FastAPI boundary, and expose the backend to Vercel through a public tunnel. Cloudflare Tunnel is the recommended tunnel; Tailscale Funnel or ngrok are acceptable fallbacks.

## Rationale

Wave-1 CRUD routes have moved to Supabase-backed frontend paths. The remaining FastAPI routes are compute-heavy workflows (`plans/simulate`, options projection, backtest, pension upload, analyze, tax condor, bond scanner, price lookups, and sync jobs). Keeping those compute workloads on Jony's laptop has zero runtime hosting cost, preserves the existing FastAPI app and Docker workflow, and avoids introducing Railway or another always-on platform after PR #193 was closed.

## Architecture

- `docker-compose.backend.yml` runs only `apps/backend` on port `8000`; it does not start or depend on the legacy local Postgres `db` service.
- The backend receives `DATABASE_URL=${DIRECT_DATABASE_URL}` so SQLModel/SQLAlchemy talks directly to Supabase Postgres or the Supabase pooler connection string.
- `SUPABASE_URL` configures JWKS discovery; `SUPABASE_JWT_SECRET` remains available for local/HS256 fallback.
- Vercel sets `NEXT_PUBLIC_API_URL` to the tunnel URL. Next.js rewrites `/api/*` to that public backend URL.
- Cloudflare Tunnel publishes `http://localhost:8000` as HTTPS for Vercel production and preview deployments.

## Security

- CORS is an allow-list from `BACKEND_CORS_ORIGINS`; defaults cover local dev, the production Vercel app, and Vercel preview hostnames via `https://*.vercel.app`.
- FastAPI compute routers remain registered with `Depends(get_current_user)`, so Supabase JWT verification gates every compute endpoint.
- Public endpoints are limited to root, docs/OpenAPI, auth legacy routes, `/health`, `/health/auth`, and telemetry metrics that already handle optional auth.
- No service-role key is required for this backend path. Do not expose Supabase service-role credentials to Vercel or the browser.
- `DIRECT_DATABASE_URL` and `SUPABASE_JWT_SECRET` are server-only secrets stored in Jony's local `.env`, never committed.

## Tradeoffs

- Laptop offline, asleep, or tunnel stopped means Vercel `/api/*` calls return 5xx/connection failures. This is acceptable for TJ-019; the walkthrough allow-list already tolerates the remaining compute endpoints being unavailable.
- Direct database connectivity keeps the backend simple, but Jony is responsible for local Docker health, laptop uptime, and tunnel process uptime.
- Cloudflare Tunnel avoids opening router ports, but it adds one local daemon and DNS configuration step. Tailscale Funnel or ngrok can replace it if Cloudflare setup is inconvenient.
- Runtime cost is effectively zero beyond laptop/network power.

## How to run it

1. Create a local `.env` from `.env.example` and fill:
   - `DIRECT_DATABASE_URL` from Supabase project `zvbwgxdgxwgduhhzdwjj` Database settings. Include `sslmode=require` when using the direct Postgres URL.
   - `SUPABASE_URL=https://zvbwgxdgxwgduhhzdwjj.supabase.co`.
   - `SUPABASE_JWT_SECRET` from Supabase Auth JWT settings if HS256 fallback is needed.
   - `BACKEND_CORS_ORIGINS=http://localhost:3000,https://trading-journal-cohenjos-projects.vercel.app,https://*.vercel.app` or a tighter preview-domain list.
2. Start the backend only:

   ```bash
   docker compose -f docker-compose.backend.yml up -d --build
   docker compose -f docker-compose.backend.yml ps
   curl http://localhost:8000/health
   ```

3. Create and run the Cloudflare Tunnel:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create tj-backend
   cloudflared tunnel route dns tj-backend api.your-domain.example
   cloudflared tunnel run tj-backend --url http://localhost:8000
   ```

4. In Vercel, set `NEXT_PUBLIC_API_URL=https://api.your-domain.example` for Production and Preview environments, then redeploy.

## Owner

Kujan owns the Docker/tunnel workflow. Rabin should review the CORS allow-list and JWT verification posture before merge.
