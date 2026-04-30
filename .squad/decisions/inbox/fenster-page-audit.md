# Page Audit — Top 3 Architectural Takeaways

**By:** Fenster (Frontend Dev)  
**Date:** 2026-07-29  
**Source:** `docs/design-hosting/page-audit.md` — 21-page gap analysis against Supabase migration

---

## Takeaway 1: All data fetching must attach the Supabase JWT — introduce a `useAuthFetch` hook

Zero of the 21 pages forward an `Authorization` header to FastAPI. The Supabase middleware refreshes the session into cookies, but no page reads the token and passes it on. FastAPI can only enforce RLS and household scoping if it receives a valid Supabase JWT per request.

**Recommended fix:** Create `src/hooks/useAuthFetch.ts` (or `src/lib/apiFetch.ts` for non-hook contexts) that:
1. Reads the current Supabase session from `supabase.auth.getSession()` (browser client)
2. Injects `Authorization: Bearer ${token}` into every FastAPI request
3. Replaces all inline `fetch('/api/...')` calls across the codebase

This is the single highest-leverage change — it unblocks all RLS enforcement without touching individual page components.

---

## Takeaway 2: Kill the localhost:8000 / `NEXT_PUBLIC_API_URL` absolute-URL pattern — standardize on relative `/api/`

Five files build absolute URLs using `${process.env.NEXT_PUBLIC_API_URL}/api/...`:
- `apps/frontend/src/app/pension/page.tsx` (upload + delete)
- `src/components/Analyze/longterm/hooks/useCompanyFundamentals.ts`
- `src/components/Analyze/longterm/hooks/usePriceHistory.ts`
- `src/components/Analyze/longterm/hooks/useSynthesis.ts`
- `src/components/Analyze/longterm/hooks/useGrowthStory.ts`

If `NEXT_PUBLIC_API_URL` is unset (empty string), these accidentally work because `"" + "/api/..."` = `"/api/..."`. But in any environment where the backend lives at a different origin (staging, preview branches), the fallback breaks silently.

**Recommended fix:** All four analyze hooks and the pension upload/delete should use relative `/api/...`. The Next.js rewrite in `next.config.ts` already handles the backend proxy for all environments. `NEXT_PUBLIC_API_URL` should be removed from frontend hooks entirely and kept only in `next.config.ts` (server-side) where it belongs.

---

## Takeaway 3: Introduce a `useHouseholdId` hook + migrate SettingsContext to Supabase

User preferences (`targetIncome`, `mainCurrency`, DOB, projection params) are stored only in `localStorage` under `trading-journal-settings-v1`. This has two consequences for the post-Supabase world:

1. **Settings drift silently** — different devices or household members see different financial parameters, causing Sankey/Plan/Summary charts to show inconsistent numbers.
2. **No `user_id` context in components** — pages have no reliable way to scope their reads/writes to the current user, forcing every FastAPI call to rely on the backend to infer identity from the JWT.

**Recommended fix:**
- Add a `user_settings` table in Supabase with a `user_id` (uuid FK to `auth.users`) and a `jsonb` data column.
- Migrate `SettingsContext` to load from Supabase on mount (using the browser client) and write back on change, with localStorage as the offline fallback.
- Expose a `useHouseholdId()` hook (backed by `supabase.auth.getUser()`) for components that need to include `household_id` in API payloads — this unifies identity handling across all 21 pages.
