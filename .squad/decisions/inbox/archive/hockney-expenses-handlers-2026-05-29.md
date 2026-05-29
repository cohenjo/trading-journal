# Hockney — Expenses Route Handlers Production Fix (2026-05-29)

## Decision

Port the production-facing `/api/expenses/*` surface from FastAPI-only endpoints to Next.js Route Handlers under `apps/frontend/src/app/api/expenses/`.

## Rationale

- Production Vercel resolves `apiFetch('/api/expenses/...')` relative to the frontend origin.
- The FastAPI expense endpoints are only available in local Docker and are not deployed publicly.
- Adding Route Handlers fixes the immediate 404 failure mode without changing the existing frontend client.
- Handlers query Supabase directly, authenticate with the request-scoped server client, resolve the active household, and explicitly scope household tables by `household_id`.
- The resolve write path can use the server-only service-role client when configured, because the current expense migration grants writes to `service_role`; all write queries still carry explicit household filters.

## Scope

Implemented Route Handlers for:

- `GET /api/expenses/categories`
- `GET /api/expenses/monthly-summary`
- `GET /api/expenses/unresolved`
- `GET /api/expenses/by-category/[slug]`
- `GET /api/expenses/statements`
- `POST /api/expenses/resolve`

Kujan owns the separate production migration application/fix. This change fixes the missing-handler 404s; data availability still depends on the production expense tables and seed data existing.
