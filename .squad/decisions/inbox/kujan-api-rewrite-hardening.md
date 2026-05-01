# API Rewrite Hardening

- **Date:** 2026-05-01T19:30:41+03:00
- **Agent:** Kujan (DevOps/Platform)
- **Requested by:** Jony (cohenjo)

## Defensive change made

`apps/frontend/next.config.ts` now keeps the local-development fallback to `http://127.0.0.1:8000`, but production build/start validates `NEXT_PUBLIC_API_URL` before configuring `/api/:path*` rewrites. Production now fails loudly if the value is missing, empty, malformed, non-HTTP(S), localhost, loopback, or private-address based.

## Open decision

Backend deployment strategy is **OPEN**. The user must choose between:

1. Deploying the FastAPI backend in `apps/backend` publicly and setting Vercel `NEXT_PUBLIC_API_URL` to that public backend URL.
2. Porting the required API endpoints to Next.js route handlers so Vercel owns the API surface.

Until that decision is made and implemented, production write paths that depend on `/api/*` remain broken.
