### 3. Plan Page Implications
**Recommendation:** Replace editable dividend controls with **"Auto from real positions" read-only banner** showing per-account totals. Rationale: dividend income is now auto-calculated via `getDividendSummary()` — user-entered policies would be overridden and confusing.

### Edge Cases Documented
- Empty dividend account (0-value filtering)
- Lopsided Sankey when reinvestment rate = 0 (no reinvest entries emitted)
- Currency mismatch (ILS mainCurrency with USD dividends — existing FX approximation limitation documented)
- Reinvestment rate > 100% or < 0% (Keaton to clamp to [0, 1])

### Test Surfaces (for Redfoot)
- Toggle interaction + aria-pressed state
- Monthly calculations (all values / 12)
- Per-account dividend node rendering (3 sources + 3 sinks)
- 0-value account omission (no orphaned nodes)
- Color differentiation (dividend emerald vs reinvestment bright indigo vs regular savings indigo)
- Integration: `getDividendSummary` → simulation → Sankey

**Files produced:**
- `.squad/decisions/inbox/fenster-cashflow-ui-design.md` (22KB, 8 sections)

**Open questions for Jony:**
1. Should monthly/yearly preference persist in localStorage?
2. Reinvestment naming: "Reinvest: IBKR" vs "IBKR Dividend Reinvestment"?
3. Plan page controls: confirm removal of editable dividend inputs acceptable?
4. Should monthly toggle apply to options income too, or only dividends?

## Learnings

**Design-first sprint pattern works.** When UX changes involve multiple pages + backend contracts + test surfaces, producing a design doc BEFORE code prevents re-work. The monthly toggle decision (local state vs SettingsContext) and the plan page removal (vs grayed-out locked state) are architectural choices that would have caused refactor loops if discovered mid-implementation. Documenting the per-account data flow contract (Keaton's domain) ensures alignment before backend work starts.

## 2026-05-18 — Cash Flow UI Implementation, PR squad/cashflow-dividend-redesign (`09cd6c1`)

Monthly/yearly toggle added to cash-flow header (pill button, local useState, resets on reload). `displayData` useMemo scales all monetary fields ÷12 in monthly mode; summary card labels get "/ mo" suffix. Sankey reinvestment nodes now use indigo `#7c7ef8` vs regular savings `#6366f1`. Plan page wires `dividendByAccount` to simulation and threads `dividendAutoAccounts` through PlanEditor→PlanModal→PlanAccountDetails; accounts with real positions (>$0) show blue "Auto from real positions" banner and hide editable yield/policy controls. Build: ✅ (`npm run build` exit 0, 6 files changed).

## 2026-05-18 — Next.js 16 Round 2 Fixes, PR #393 (`3855e10`)

Applied 4 targeted fixes to bring PR #393 from "builds + tests pass" to "ready to merge with zero deprecation warnings":

1. `next.config.ts`: removed deprecated `eslint: { ignoreDuringBuilds: true }` block (Next 16 removed this config key).
2. `package.json`: bumped `eslint-config-next` `^15.5.15` → `^16.2.6` (unblocks PR #459 eslint 10 upgrade).
3. `package.json`: changed `"lint": "next lint"` → `"lint": "eslint ."` (next lint removed in Next 16).
4. `package.json`: bumped `react-dom` `^19.2.5` → `^19.2.6` to match `react@19.2.6`.
5. `middleware.ts`: added one-line TODO comment for Next 17 proxy migration (edge runtime preserved).

**tsconfig.json** was reverted post-build (Next 16 auto-modifies it; Keaton's merge gate criterion #8 forbids tsconfig changes).

**Result:** Tests improved from 534 passed (26 failed suites) → 714 passed (2 failed suites). React-dom version sync eliminated all 25 suite initialization failures. 3 pre-existing TTM dividend calc failures remain (matches Keaton's 714/717 baseline). Build shows zero eslint-key deprecation warnings. eslint@10 compat dry-run clean — PR #459 is unblocked.

## Learnings

**Always revert tsconfig.json after `next build`.** Next 16 silently rewrites `jsx: "preserve"` → `"react-jsx"` and injects `.next/dev/types` into the include array. This must be caught and reverted BEFORE commit. Add `git checkout -- apps/frontend/tsconfig.json` to the post-build verification sequence for every Next.js upgrade sprint. If left in, it will cause unwanted diffs and break Keaton's merge gate criterion #8 without any error message.
📌 2026-05-19: PR #464 frontend shipped (Refresh button rewire, state machine, 7 tests, 4 nits addressed) merged a9e2444

## 2026-05-27 — RSU Account UI Wiring (PlanAccountDetails.tsx)

**Branch:** `squad/rsu-ui-wiring` | **Tests:** 10 new pass (714+10 total)

**Goal:** Wire RSU account configuration surface in `PlanAccountDetails.tsx` for "Wix RSU" and "MSFT RSU" accounts.

**Changes to `apps/frontend/src/components/Plan/PlanAccountDetails.tsx`:**
- Added `dividendYieldOverride` state (local, default false — auto mode).
- `fetchMarketData`: defensively reads optional `dividend_yield` from extended API response with TODO for Hockney's endpoint; conditionally calls `updateSettings({ dividend_yield })` when not in override mode.
- Price-fetch `useEffect`: now fires in **both** planning and snapshot modes (removed `mode === 'snapshot'` guard).
- Auto-defaults `useEffect`: fires on `settings.type` change; sets `dividend_policy = 'Payout'` and `dividend_tax_rate = 25` (if unset) when type is RSU. Uses eslint-disable for intentional deps.
- New **RSU Configuration** block (planning mode only): ticker input required (red border + error when empty), price cache status, dividend yield auto-display with Override/Revert toggle, tax rate input defaulting to 25.
- Investment Profile section: `settings.type !== 'RSU'` guard on dividend yield block — RSU yield managed by RSU Config block only.
- Dividend Policy section: `settings.type !== 'RSU'` added to section-level condition — entire section hidden for RSU.

**Tests created:** `apps/frontend/src/components/Plan/__tests__/PlanAccountDetails.test.tsx`
- 10 tests across: ticker validation, dividend yield auto display, policy locked for RSU, tax rate default 25.

**Patterns confirmed:**
- Ticker field name is `stock_symbol` (not `ticker`).
- `getPrice` returns `{ price, as_of, refreshed_at, isStale }` — no `dividend_yield` yet. Defensive cast pattern: `const extendedData = data as typeof data & { dividend_yield?: number }`.
- Hockney's extended endpoint is a future TODO; code is ready to handle it.
- Dividend Policy section hidden (not disabled) — single source of truth is the RSU Config block.
- `dividendYieldOverride` does NOT reset on ticker change — user opted in explicitly.

**Decisions filed:** `fenster-rsu-ui.md`

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.
