# Wave 2 Backend CRUD — Scope Analysis & Findings

**Date:** 2026-05-01  
**Author:** Hockney (Backend Dev)  
**Issues:** #106 (dividends), #107 (holdings), #108 (insurance), #109 (pension)  
**Session:** autopilot via Jony request

## Executive Summary

Initial request was to "get backend CRUD working for 4 pages" with auth + RLS. After comprehensive inventory, discovered **actual scope is 3-4x larger** than anticipated due to architectural patterns:

- **Insurance** ✅ — Simple fix (add auth + RLS)
- **Pension** 🟡 — Moderate complexity (add auth + RLS, but has file uploads + complex JSON)
- **Holdings** ⚠️ — **Uses in-memory mock data**, needs DB table creation + migration from mock
- **Dividends** ⚠️ — **Uses file storage (XLSX)**, needs migration to DB + refactor

## Detailed Findings

### 1. Insurance (`#108`) — ✅ TRACTABLE

**Current State:**
- ✅ Full CRUD exists in `insurance.py` (GET/POST/PUT/DELETE)
- ✅ Uses SQLModel + `insurance_policies` table
- ❌ NO user_id column
- ❌ NO auth dependency
- ❌ NO RLS policies

**Fix Required:**
1. Add `user_id UUID FK` to `insurance_policies` table
2. Add `get_current_user_id` dependency to all endpoints
3. Filter queries by `user_id`
4. Create RLS policies (SELECT/INSERT/UPDATE/DELETE for own records)

**Estimate:** 30 minutes (straightforward auth addition)

---

### 2. Pension (`#109`) — 🟡 MODERATE COMPLEXITY

**Current State:**
- ✅ Full CRUD exists in `pension.py` (795 lines)
- ✅ Uses SQLModel + `finance_snapshots` table
- ❌ NO user_id column
- ❌ NO auth dependency
- ❌ NO RLS policies
- ⚠️ **Complex:** Stores pension data as JSON within snapshots
- ⚠️ **Complex:** Uploads PDFs to disk, parses with LLM, manipulates JSON items
- ⚠️ **Complex:** DELETE removes pension ITEM from within snapshot JSON, not the snapshot itself

**Fix Required:**
1. Change `finance_snapshots` PK from `(date)` to `(user_id, date)`
2. Add `get_current_user_id` dependency to all endpoints (`/dashboard`, `/reports`, `/upload`, `DELETE /{id}`)
3. Filter all queries by `user_id`
4. Update snapshot creation in `/upload` to set `user_id`
5. Create RLS policies

**Estimate:** 1-2 hours (auth + PK change + testing JSON manipulation)

---

### 3. Holdings (`#107`) — ⚠️ ARCHITECTURAL CHANGE NEEDED

**Current State:**
- ✅ Endpoints exist in `holdings.py` (GET/PUT/DELETE)
- ❌ **Uses IN-MEMORY MOCK DATA** (`bonds_mock.py`)
- ❌ NO database persistence
- ❌ NO user isolation
- ❌ Writes to `apps/backend/data/bonds.xlsx` file on disk

**Fix Required:**
1. **Create `bond_holdings` table** with schema:
   ```sql
   CREATE TABLE bond_holdings (
     id TEXT PRIMARY KEY,  -- CUSIP
     user_id UUID NOT NULL REFERENCES auth.users(id),
     ticker TEXT,
     issuer TEXT NOT NULL,
     currency TEXT NOT NULL,
     face_value NUMERIC(18,6) NOT NULL,
     coupon_rate NUMERIC(18,6) NOT NULL,
     coupon_frequency TEXT NOT NULL,
     issue_date DATE NOT NULL,
     maturity_date DATE NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
2. **Migrate existing mock data** to DB with seed script
3. **Refactor `holdings.py`** to use DB queries instead of `bonds_mock.get_current_bonds()`
4. **Refactor `/api/ladder` endpoints** (they depend on same mock data)
5. Add auth + RLS policies

**Estimate:** 3-4 hours (schema + migration + refactor 2 routers + testing)

---

### 4. Dividends (`#106`) — ⚠️ ARCHITECTURAL CHANGE NEEDED

**Current State:**
- ✅ NEW dashboard endpoints exist (`/dividends/dashboard`, `/dividends/position`) using DB
- ✅ Models defined: `dividend_positions`, `dividend_accounts`, `dividend_ticker_data`
- ⚠️ **LEGACY endpoints** (`GET /dividends`, `POST /dividends`, `POST /dividends/projection`) use **FILE STORAGE** (`dividends.xlsx`)
- ❌ NO auth on any endpoint
- ❌ DB tables may not exist (models defined but unclear if migrated)
- Frontend currently calls LEGACY file-based endpoints

**Fix Required:**
1. **Verify/create DB tables** for `dividend_*` (check if migrations exist)
2. **Refactor frontend** to call NEW dashboard endpoints instead of legacy
3. **OR migrate legacy endpoints** to use DB instead of files
4. Add `user_id` columns to all dividend tables
5. Add auth + RLS policies
6. **Decision needed:** Keep legacy endpoints for backward compat, or remove?

**Estimate:** 4-6 hours (depends on migration strategy + frontend changes)

---

## Root Cause Analysis

**Why scope ballooned:**

1. **Issues were titled "functional state"** not "implement CRUD" — actual requirement was to make existing pages work, not build from scratch
2. **Backend uses 3 different data patterns:**
   - Database ORM (insurance, pension) ✅
   - File storage (dividends) ⚠️
   - In-memory mock (holdings) ⚠️
3. **RLS was added to 21 tables in PR #98** but NOT to Wave 2 tables (they weren't prioritized)
4. **Pension system is sophisticated** — JSON manipulation, LLM parsing, multi-entity relationships

**McManus's data taxonomy (per .squad/decisions.md):**
- `dividend_*` tables = household-scoped
- `trading_positions` = household-scoped  
- `insurance_policies` = owner-private
- `finance_snapshots` (pension) = owner-private

This means dividends and holdings need `household_id` FK + RLS, not just `user_id`.

---

## Recommendations

### Immediate (This PR):
1. **Fix Insurance** — Low-hanging fruit, 30 min
2. **Fix Pension (partial)** — Add auth filtering to existing queries, defer PK change to follow-up

### Follow-up Issues:
1. **TJ-025: Holdings DB Migration** — Create table, migrate mock data, refactor
2. **TJ-026: Dividends DB Migration** — Migrate from file storage to DB, update frontend
3. **TJ-027: Pension PK Refactor** — Change PK to (user_id, date), test JSON manipulation
4. **TJ-028: Household Sharing for Dividends/Holdings** — Add household_id FK per taxonomy

### Alternative Approach:
**Assign to specialized agents:**
- **Hockney:** Insurance + Pension (owns backend)
- **McManus:** Holdings + Dividends (owns data/finance modeling)
- **Fenster:** Frontend updates for new endpoints

---

## Files Created/Modified (Pre-branch-switch loss)

**Created:**
- `supabase/migrations/20260501000000_wave2_user_scoped_crud.sql` (RLS policies for insurance + pension)

**Modified (LOST due to branch switch without commit):**
- `apps/backend/app/schema/insurance_models.py` — Added user_id, household_id
- `apps/backend/app/schema/finance_models.py` — Changed PK to (user_id, date)
- `apps/backend/app/api/insurance.py` — Added auth, filtered queries
- `apps/backend/app/api/pension.py` — Added auth, filtered queries

**Inventory Document:**
- `/Users/jocohe/.copilot/session-state/wave2-inventory.md`

---

## Lessons Learned

1. **Always verify backend data patterns** before scoping CRUD work
2. **File/mock systems are NOT simple "add auth"** — they're architectural migrations
3. **Issue titles matter** — "functional state" vs "implement CRUD" are different scopes
4. **Commit incrementally** — Lost 30+ min of work due to branch switching
5. **Inventory phase is CRITICAL** for complex multi-endpoint systems

---

## Next Steps (Coordinator Decision)

**Option A: Finish Insurance + Pension (realistic 2-4 hours)**
- Redo lost work
- Apply migration to dev + prod
- Create seed data
- File follow-ups for Holdings/Dividends

**Option B: Reassign to Squad**
- File 4 separate issues (one per page)
- Route Holdings/Dividends to McManus (data specialist)
- Route Insurance/Pension to Hockney (backend)
- Fenster handles frontend integration

**Option C: Staged Rollout**
- Wave 2A: Insurance + Pension (Hockney)
- Wave 2B: Holdings (McManus + Hockney)
- Wave 2C: Dividends (McManus + Fenster)

**My recommendation:** Option A (finish what's tractable) + file follow-ups for the rest.

---

**Status:** Findings documented, awaiting coordinator decision on approach.
