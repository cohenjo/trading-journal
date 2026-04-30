# Decision: Supabase SSR Client Architecture (TJ-015)

**Date:** 2026-07-18  
**Author:** Fenster (Frontend/Next.js)  
**Issue:** TJ-015 / GH #68

## Decisions Made

### 1. Cookie pattern: `getAll`/`setAll` only
Used the non-deprecated `getAll`/`setAll` API from `@supabase/ssr` v0.10.  
The older `get`/`set`/`remove` methods are deprecated in this version and will be removed in the next major.

### 2. Session refresh: `getClaims()` not `getUser()`
Middleware calls `supabase.auth.getClaims()` (local JWT validation) rather than `getUser()` (remote call).  
This is the Supabase-recommended pattern for middleware to avoid latency on every request.

### 3. `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not `PUBLISHABLE_KEY`)
Supabase's newest docs renamed the key to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.  
We use `ANON_KEY` per the issue spec. Teams should align on one name when setting up `.env.local`.

### 4. `Database = any` stub until migrations land
Type generation requires Phase 1 migrations (PR #85). Until then the stub keeps the codebase compilable.

### 5. Admin client throws at construction in browser
`createAdminClient()` throws synchronously if `typeof window !== 'undefined'`,  
preventing accidental service-role key exposure in client bundles.
