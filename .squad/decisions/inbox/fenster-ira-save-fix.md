# Decision: Finance Snapshot RLS household_id Injection Pattern

**Date:** 2025-05-01  
**Decided by:** Fenster (Backend Dev)  
**Context:** User bug report — "Failed to save changes" when adding IRA investment accounts

## Root Cause

The `finance_snapshots` table had RLS policies enabled with `household_id IS NOT NULL` requirements (from migration `20260430160200_enable_rls_on_public_tables.sql`), but:

1. The table originally had PK `(date)` only — no composite key
2. Backend API endpoints didn't inject `household_id` when creating records
3. RLS policies blocked INSERTs that didn't set `household_id`

Result: Optimistic UI update succeeded → API call failed → refresh cleared state.

## Fix Pattern

### 1. Backend API Pattern (Household-Scoped Endpoints)

All endpoints that write to tables with RLS must:

```python
from app.dependencies import get_current_user_id
from app.services.household_service import get_user_household_id

@router.post("/")
def create_thing(
    data: ThingCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    # Create record with household_id
    thing = Thing(household_id=household_id, ...)
    db.add(thing)
    db.commit()
    return thing
```

### 2. Primary Key Pattern for Multi-Tenant Tables

Tables that store per-household data should use composite PKs:

```sql
-- ❌ BAD: Single-date PK allows household collision
CREATE TABLE snapshots (date DATE PRIMARY KEY, ...);

-- ✅ GOOD: Composite PK ensures household isolation
CREATE TABLE snapshots (
  household_id UUID NOT NULL REFERENCES households(id),
  date DATE NOT NULL,
  PRIMARY KEY (household_id, date)
);
```

### 3. Migration Checklist

When adding `household_id` to an existing table:

1. Add nullable column: `ALTER TABLE t ADD COLUMN household_id UUID`
2. Backfill or delete orphaned rows
3. Make NOT NULL: `ALTER TABLE t ALTER COLUMN household_id SET NOT NULL`
4. Update PK if needed: `DROP CONSTRAINT ... ; ADD PRIMARY KEY (...)`
5. Enable RLS with household policies

## Files Changed

- `apps/backend/app/api/finances.py` — injected `household_id` in all endpoints
- `apps/backend/app/schema/finance_models.py` — updated SQLModel PK
- `supabase/migrations/20260501110927_finance_snapshots_household_pk_fix.sql` — schema fix

## Reuse Guidance

**When adding new household-scoped tables:**
- Start with composite PK `(household_id, ...)` from day 1
- Follow the backend pattern above for all write endpoints
- Test with multiple households to verify isolation

**When retrofitting existing tables:**
- Follow the migration checklist above
- Check for orphaned data first (rows with null household_id)
- Apply to dev → verify → apply to prod

## Related

- Pattern established in PR #133 (dividends + holdings)
- RLS policies: `20260430160200_enable_rls_on_public_tables.sql`
- Household service: `apps/backend/app/services/household_service.py`

## PR

https://github.com/cohenjo/trading-journal/pull/134
