# Frontend Page Audit — Supabase Migration Gap Analysis

**Date:** 2026-07-29  
**Branch:** main  
**Author:** Fenster (Frontend Dev)  
**How to update:** Re-run the audit by grepping `apps/frontend/src/app/**/page.tsx` for `fetch(`, `supabase.from(`, `useUser`, `redirect(`, and `NEXT_PUBLIC_API_URL`. Update the table rows and tally counts below.

---

## Audit Table

> **Key for Data Sources column:**
> - `FastAPI` = calls `/api/*` which is proxied to `NEXT_PUBLIC_API_URL || http://127.0.0.1:8000`
> - `FastAPI (abs)` = calls `${NEXT_PUBLIC_API_URL}/api/*` — absolute URL, skips the Next.js rewrite proxy
> - `Supabase JS` = calls `supabase.from(...)` directly
> - `localStorage` = reads/writes via SettingsContext; no network
> - `static` = no data fetching

| # | Route | Purpose | Data Sources | Auth Req? | Auth Fallback | Critical UI Elements | Gaps (post-Supabase migration) | Test Priority |
|---|-------|---------|-------------|-----------|---------------|----------------------|-------------------------------|---------------|
| 1 | `/` | Root redirect to `/summary` | static | No | Redirects to /summary | — | None. Pure redirect. | P0 |
| 2 | `/settings` | User profile & planning preferences (name, DOB, currency, income targets) | `localStorage` only | No | No redirect — renders with defaults | Planning mode toggle, person edit modals, currency selector | Settings stored only in localStorage — **not persisted to Supabase**; no user_id scoping; will silently differ between devices/users sharing a household | P1 |
| 3 | `/options` | Options income history + yield projection chart | FastAPI `/api/options` (GET), `/api/options/projection` (POST) | No | Silently shows empty state on API error | Projection chart, options history table, settings panel | FastAPI must scope options records by `user_id` / `household_id`; no JWT forwarded in fetch calls today; RLS will reject unscoped inserts | P1 |
| 4 | `/progress` | Net worth history chart & table with CRUD | FastAPI `/api/finances/history`, `/api/finances/` (POST), `/api/finances/:date` (DELETE) | No | Shows empty state if API fails | Net worth chart, progress table, add-record modal | Same as #3 — no JWT / `user_id` forwarded; `/api/finances/` must scope snapshots per household | P1 |
| 5 | `/current-finances` | Live net worth snapshot editor — assets, savings, investments, liabilities | FastAPI `/api/finances/latest` (GET), `/api/finances/` (POST) | No | Shows "Loading finances..." forever if 404 | Donut charts ×4, finance tabs editor (add/edit/delete items) | High-value page — financial data stored without `user_id`; metrics saved in display currency (not normalized) so cross-device comparison will drift; no auth guard | P0 |
| 6 | `/plan` | Long-range financial simulation with projection chart & milestone markers | FastAPI `/api/plans/latest`, `/api/plans/` (POST/PUT), `/api/finances/latest`, `/api/plans/simulate` (POST) | No | Shows "Loading plan..." forever | Projection chart, plan editor, year details pane | Plan data not scoped by user; `simulate` endpoint receives full `settings` object from localStorage — if settings differ between users in a household the simulation diverges silently | P0 |
| 7 | `/tax-condor` | Iron Condor tax-loss harvesting recommender | FastAPI `/api/tax-condor/recommend` (POST) | No | Silent console error | Symbol + budget inputs, recommendations list | Compute-only endpoint; no persistent data; no household scoping needed for v1 | P2 |
| 8 | `/pension` | Pension dashboard — upload PDF reports, track history & projections | FastAPI `/api/pension/dashboard`, `/api/pension/reports`, **`${NEXT_PUBLIC_API_URL}/api/pension/upload`** (POST multipart), **`${NEXT_PUBLIC_API_URL}/api/pension/:id`** (DELETE) | No | Silent on failure; dashboard shows blank | Owner selector, file drag-drop upload, report history | `NEXT_PUBLIC_API_URL` used directly for upload + delete — breaks if env var is unset in production (falls back to empty string → 404); no auth; pension snapshots not scoped | P1 |
| 9 | `/ladder` | Bond ladder visual manager — rungs, income chart, distributions | FastAPI `/api/ladder/overview`, `/api/ladder/income`, `/api/ladder/rungs/:id` (PUT), `/api/ladder/bonds` (POST) | No | Silent `console.error` on load failure | Ladder rungs sidebar, income chart, distributions table | Bond data is unscoped; `candidateId` / `candidateYear` passed via query params from scanner are safe but the bond POST doesn't include owner identity | P1 |
| 10 | `/ladder/scanner` | Bond scanner with filter inputs → redirects to ladder with selected bond | FastAPI `/api/bonds/scanner` (GET with query params) | No | Inline error message on scan failure | Date range + yield + rating + currency filters, results table, "Select" button | Compute/market-data endpoint; no persistent write; low RLS risk | P2 |
| 11 | `/holdings` | Bond holdings portfolio editor (face value, coupon, maturity) | FastAPI `/api/holdings` (GET), `/api/holdings/:id` (PUT/DELETE), `/api/ladder/bonds` (POST for new) | No | Inline error message | Holdings table with inline face-value editing, add-row form, save/remove buttons | Holdings must be scoped to household; saves go to `/api/ladder/bonds` (shared endpoint with ladder) — dual-write surface | P1 |
| 12 | `/after-i-leave` | Long-form family financial guide with PDF export | FastAPI `/api/insurance`, `/api/finances/latest` | No | Returns empty arrays on failure, page renders | Collapsible sections, summary table, PDF print button | Reads from two FastAPI endpoints that both need household scoping post-migration; PDF export is client-side (html2pdf.js) — unaffected | P1 |
| 13 | `/backtest` | Iron Condor strategy backtester with equity curve chart | FastAPI `/api/backtest/years` (GET), `/api/backtest/run` (POST) | No | Inline error banner on run failure | Year + step + strategy selectors, run button, equity curve chart, trade log table | Backtest data is read-only from historical market data — no user data persisted; no scoping needed | P2 |
| 14 | `/cash-flow` | Sankey diagram of income/spending flows across projection years | FastAPI `/api/plans/latest`, `/api/finances/latest`, `/api/plans/simulate` (POST) | No | Shows "Loading cash flow data..." | Year slider, Sankey chart, 4× summary stat cards | Same plan/finance scoping gaps as `/plan`; duplicate `fetchLatestPlan` / `fetchFinances` utility functions (not shared) | P1 |
| 15 | `/analyze` | Company analysis — long-term DCF + short-term technical/options | Short-term: FastAPI `/api/analyze/*` (relative); Long-term: **`${NEXT_PUBLIC_API_URL}/api/analyze/*`** (absolute) | No | SectionErrorBoundary catches failures | Ticker search, Long/Short toggle, view-specific cards | Long-term hooks use `NEXT_PUBLIC_API_URL` directly — inconsistent with short-term hooks that use relative `/api/`; if `NEXT_PUBLIC_API_URL` is unset, long-term calls hit empty string base; growth-story endpoint uses `POST` and calls AI (expensive) with no auth gate | P1 |
| 16 | `/dividends` | Dividend portfolio dashboard — positions, stats, account tabs | FastAPI `/api/dividends/accounts`, `/api/dividends/dashboard` | No | Shows loading spinner on failure | Account tabs, portfolio stats row, positions table, add-position modal | Dividend positions not scoped by user/household; `convertCurrency` applied client-side using static rates | P1 |
| 17 | `/dividends/estimations` | Dividend growth projections with historical data input | FastAPI `/api/dividends` (GET/POST), `/api/dividends/projection` (POST) | No | Silent `console.error`, empty chart | Projection chart, dividend history table with edit, settings panel | Projection params stored only in localStorage (via SettingsContext); historical dividend records not scoped | P2 |
| 18 | `/day/[date]` | Daily trading summary — trades, gauges, NDX chart for a specific date | FastAPI `/api/day/:date` | No | Shows "No data found for this day." | Trades table, summary gauges, NDX intraday chart | IBKR trade data import pipeline must scope by user; date is URL param — no validation beyond Next.js routing | P2 |
| 19 | `/trading/accounts` | IBKR account dashboard — positions, P&L, sync + settings | FastAPI `/api/trading/configs`, `/api/trading/summary`, `/api/trading/positions`, `/api/trading/sync` | No | Shows empty state + error message | IBKR/Settings tabs, positions table, sync button, stats row | IBKR credentials stored in `trading_configs` table — **critical**: must be scoped per user; currently no auth forwarded; sync action calls IBKR live | P1 |
| 20 | `/insurance` | Insurance policy CRUD — Hebrew/English toggle | FastAPI `/api/insurance` (GET/POST), `/api/insurance/:id` (PUT/DELETE) | No | Shows empty state if API unavailable | Lang toggle, policy table, add/edit form modal | Insurance policies must be scoped per household; form is complete with proper validation; bilingual support works client-side | P1 |
| 21 | `/summary` | Income summary — stacked chart combining ladder + dividends + options projections | FastAPI `/api/ladder/income`, `/api/dividends/projection` (POST), `/api/options/projection` (POST) | No | Silent `console.error`, empty chart | Stacked income chart, legend | Entry-point page (root redirects here); three concurrent fetches, each with their own scoping gaps; projection params from localStorage | P0 |

---

## Common Gaps

### 1. No auth guard on any page (21 / 21 pages)
Not a single page component calls `useUser`, `supabase.auth.getUser()`, or redirects to a login route. The middleware refreshes the Supabase session but **never gates access**. Any unauthenticated user can view every page. After the Supabase migration this is a security gap — all RLS policies assume a valid JWT to resolve `auth.uid()`, but the client never attaches it to FastAPI requests.

### 2. All data fetches target FastAPI with no JWT forwarding (21 / 21 pages)
Every fetch call uses relative `/api/*` (proxied via `next.config.ts` to `NEXT_PUBLIC_API_URL`) or directly builds `${NEXT_PUBLIC_API_URL}/api/...`. None of them attach an `Authorization: Bearer <token>` header. FastAPI must validate Supabase JWTs and resolve `user_id` / `household_id` before querying Supabase. Until that is wired, RLS will reject writes and household-scoped reads will return empty results in production.

### 3. Settings in localStorage — not persisted to Supabase (all pages consuming SettingsContext)
`SettingsContext` reads/writes `localStorage` key `trading-journal-settings-v1`. Preferences (currency, target income, DOB, projection params) are never synced to a Supabase table. In a multi-device or household-sharing model this silently diverges. Pages affected: `/settings`, `/options`, `/progress`, `/plan`, `/cash-flow`, `/dividends/estimations`, `/summary`, `/analyze`.

### 4. `NEXT_PUBLIC_API_URL` used inconsistently for absolute URL construction (5 hooks in `/analyze`)
Long-term analyze hooks (`useCompanyFundamentals`, `usePriceHistory`, `useSynthesis`, `useGrowthStory`) prepend `process.env.NEXT_PUBLIC_API_URL` to construct full URLs. Short-term hooks use relative `/api/`. The pension upload/delete handlers do the same. If the env var is not set, long-term calls hit `"/api/..."` (which happens to work) but this is accidental parity — these calls bypass the Next.js rewrite and will break in any environment where `NEXT_PUBLIC_API_URL` points to a different origin (e.g., a staging backend).

### 5. No Supabase JS client used in any page (0 / 21 pages)
Despite the Supabase SSR client scaffolding (`src/lib/supabase/server.ts`, `browser.ts`) added in TJ-015, zero page components or hooks call `supabase.from()` or `supabase.auth.*`. All data access is mediated by FastAPI. This is intentional for the current architecture (FastAPI + Supabase as Postgres) but means the Supabase JS client infrastructure is unused in the frontend — it was built but not yet wired into any data-fetching logic.

---

## Recommended Fix Order

| Priority | Fix | Pages Affected | Effort |
|----------|-----|----------------|--------|
| **1 — Critical** | Add Supabase auth session to all FastAPI fetch calls (`Authorization: Bearer ${token}`) — implement a `useAuthFetch` or `apiFetch` wrapper that auto-attaches the token | All 21 | Medium |
| **2 — Critical** | Add auth guard / redirect-to-login in `middleware.ts` or a shared layout component — check `supabase.auth.getUser()` and redirect unauthenticated users | All 21 | Low |
| **3 — High** | Migrate SettingsContext persistence from localStorage to a Supabase `user_settings` table, with `user_id` RLS | /settings + 8 consumer pages | Medium |
| **4 — High** | Normalize all analyze long-term hooks + pension upload/delete to use relative `/api/` instead of `${NEXT_PUBLIC_API_URL}/api/` | /analyze, /pension | Low |
| **5 — Medium** | Verify FastAPI endpoints scope data by `user_id`/`household_id` (extracted from JWT) for: finances, plans, options, dividends, insurance, holdings, ladder, trading configs | 16 pages | High (backend work) |
| **6 — Medium** | Add `household_id` to all POST/PUT payloads so data is correctly attributed when multiple household members share the app | Writes on 12+ pages | Medium |
| **7 — Low** | Extract duplicate `fetchLatestPlan` / `fetchFinances` functions (copy-pasted in `/plan` and `/cash-flow`) into a shared API module | /plan, /cash-flow | Low |

---

## Test Priority Tally

| Priority | Count | Pages |
|----------|-------|-------|
| **P0** (smoke must pass) | **4** | `/`, `/current-finances`, `/plan`, `/summary` |
| **P1** (key flow) | **12** | `/settings`, `/options`, `/progress`, `/pension`, `/ladder`, `/holdings`, `/after-i-leave`, `/cash-flow`, `/analyze`, `/dividends`, `/trading/accounts`, `/insurance` |
| **P2** (edge / secondary) | **5** | `/tax-condor`, `/ladder/scanner`, `/backtest`, `/dividends/estimations`, `/day/[date]` |
| **skip** | **0** | — |
| **Total** | **21** | |

> Redfoot's E2E smoke suite needs to cover all 4 P0 pages before any deploy can be considered safe. The 12 P1 pages represent the primary user journeys and should be covered before the Supabase migration goes live.
