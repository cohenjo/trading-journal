# Decision: apiFetch is the canonical FastAPI client

**Date:** 2026-07-29  
**By:** Fenster (Frontend Dev) — PR #96  
**Category:** Architecture, Security  
**Status:** Implemented

## What

`src/lib/api-client.ts` exports `apiFetch(input, init)` as the **only approved way** to call the FastAPI backend from the frontend.

- Attaches `Authorization: Bearer <jwt>` from the active Supabase session.
- Throws `ApiAuthError` (typed, catchable) on 401/403.
- Returns raw `Response`; caller does `.json()` / `.text()` etc.
- 36 existing fetch sites migrated in PR #96.

## Why

Without JWT forwarding, FastAPI RLS policies can never enforce per-user isolation. Any future PR that bypasses `apiFetch` silently breaks backend auth — the user will see data from other users or 500 errors once RLS policies are written.

## Rule

> **Future PRs that call `fetch()` directly against the FastAPI backend (any `/api/*` path or `NEXT_PUBLIC_API_URL` URL) MUST be rejected in code review.** Use `apiFetch()` instead.

Exceptions:
- Calls that go to Supabase directly (use the SDK — `supabaseBrowser.from(...)`, `supabase.auth.*`, etc.)
- Non-FastAPI third-party APIs (e.g. market data providers), if added later

## Import

```ts
import { apiFetch, ApiAuthError } from '@/lib/api-client';
```
