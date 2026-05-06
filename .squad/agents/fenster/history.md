- Upsert uses `onConflict: 'date'` (PK). RLS blocks cross-household updates at DB level.

### Pattern established

This is the **template for all 32 MOVE endpoints**. See decision note at:
`.squad/decisions/inbox/fenster-finances-server-action.md`

### Build/test results

- `npm run test`: 8/8 new tests pass. 3 pre-existing Pension test failures (unrelated).
- `npm run lint`: 0 errors in changed files. All other lint errors are pre-existing.
- `npm run build`: ✅ succeeds with env vars set.

## Household Bootstrap + Sign-out (2026-05-03)

**Issue:** Jony hit "⚠️ No active household found for your account" on `/current-finances` when saving funds/assets. New OAuth users have no `household_members` row.

**Solution:** Implemented TASK A–D in branch `squad/login-household-bootstrap-2026-05-03`.

### Files created/modified

| File | Change |
|------|--------|
| `apps/frontend/package.json` | +`lucide-react ^1.14.0` |
| `src/lib/household/HouseholdContext.tsx` | NEW — HouseholdProvider + useHousehold hook |
| `src/components/Household/AccountTypePickerDialog.tsx` | NEW — modal for first-login household setup |
| `src/components/Household/HouseholdBanner.tsx` | NEW — inline banner with "Set up household" CTA |
| `src/components/Layout/MainLayout.tsx` | HouseholdProvider wrap + sign-out section + user email |
| `src/app/current-finances/page.tsx` | HouseholdBanner replaces raw error message |
| `e2e/flows/household-bootstrap.spec.ts` | Already existed; all data-testid attrs now implemented |
| `.squad/decisions/inbox/fenster-login-bootstrap.md` | Design notes |

### Architecture highlights

- **HouseholdContext:** React Context (no Zustand dep needed). Bootstrap on first authenticated render. Reads `v_my_active_household`. Exponential back-off (800ms × 2^attempt, max 3 retries). `runningRef` prevents concurrent runs.
- **Sign-out:** `supabaseBrowser.auth.signOut()` → `router.replace('/login')`. `LogOut` icon from lucide-react.
- **data-testid contract:** `household-banner`, `household-banner-setup`, `account-type-individual`, `account-type-joint`, `account-type-confirm`, `sidebar-signout`, `signed-in-email` — all implemented and stable for Redfoot E2E.

### Lint/typecheck

- `npm run lint`: 0 errors in changed files. Pre-existing errors unchanged.
- `npx tsc --noEmit`: 0 errors in changed files. Pre-existing errors unchanged.

## 2026-05-03: HouseholdProvider + Sign-out Menu Landed — PR #163

**Features:** Implemented `HouseholdProvider` component for household context management and added sign-out menu option in the UI. Enables user to manage active household and logout workflows.

**Merge:** PR #163 rebased on top of #164 (Hockney's RPC), CI green, merged (commit 168171d). Conflict resolution during rebase preserved #163's household context logic.

**Downstream:** PR #166 (Redfoot's comprehensive E2E coverage) depended on #163's household UI, merged successfully after rebase.
