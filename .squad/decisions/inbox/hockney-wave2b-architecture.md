# Wave 2b Architecture — Mock/File Storage to DB Migration Recipe

**Date:** 2026-05-01  
**Author:** Hockney (Backend Dev)  
**PR:** #129  
**Issues:** #119 (holdings), #120 (dividends)

## Summary

Established the canonical pattern for migrating features from mock/file storage to real DB tables with household-scoped RLS. This recipe ensures consistency across future backend migrations.

## The Pattern

When migrating a feature from in-memory mock or file storage (CSV/XLSX) to a real DB table:

### 1. Migration Script

Create a migration following the naming convention: `YYYYMMDDHHMMSS_wave{X}_feature_name.sql`

**Template:**
```sql
-- Migration: YYYYMMDDHHMMSS_wave{X}_feature_name
-- Author: {agent name}
-- Purpose: Migrate {feature} from {mock/file} storage to DB table
-- Issues: #{issue_number}

-- ============================================================
-- Create table with household_id FK
-- ============================================================
create table if not exists public.{table_name} (
  id {type} primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  -- feature-specific columns
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz  -- soft-delete
);

-- Index for household queries
create index if not exists {table}_household_id_idx 
  on public.{table_name} (household_id);

-- Trigger for updated_at
drop trigger if exists trg_{table}_update_timestamp on public.{table_name};
create trigger trg_{table}_update_timestamp
  before update on public.{table_name}
  for each row execute function public.tg_update_timestamp();

-- Enable RLS
alter table public.{table_name} enable row level security;

-- RLS policies: household-scoped pattern
drop policy if exists {table}_select on public.{table_name};
create policy {table}_select on public.{table_name} 
  for select to authenticated
  using (household_id is not null and public.is_household_member(household_id));

drop policy if exists {table}_insert on public.{table_name};
create policy {table}_insert on public.{table_name} 
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists {table}_update on public.{table_name};
create policy {table}_update on public.{table_name} 
  for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

drop policy if exists {table}_delete on public.{table_name};
create policy {table}_delete on public.{table_name} 
  for delete to authenticated
  using (household_id is not null and public.is_household_writer(household_id));
```

**Key Principles:**
- Always use `IF EXISTS` / `IF NOT EXISTS` for idempotency
- Always include `household_id` FK with index
- Always add audit columns (created_at, updated_at, deleted_at)
- Always add `updated_at` trigger
- Always enable RLS with household-scoped policies
- Use soft-delete (`deleted_at`) for data retention

### 2. SQLModel Schema

Create a new schema file in `apps/backend/app/schema/{feature}_models.py`:

```python
from datetime import date
from uuid import UUID
from typing import Optional
from sqlmodel import Field, SQLModel

class {Feature}(SQLModel, table=True):
    """Description of the feature."""
    
    __tablename__ = "{table_name}"
    
    id: {type} = Field(primary_key=True)
    household_id: UUID = Field(foreign_key="households.id", nullable=False)
    # feature-specific fields
    created_at: Optional[date] = Field(default=None)
    updated_at: Optional[date] = Field(default=None)
    deleted_at: Optional[date] = Field(default=None)

class {Feature}Create(SQLModel):
    """Request model for creating."""
    # feature-specific fields (no household_id - injected by API)

class {Feature}Update(SQLModel):
    """Request model for updating."""
    # Optional feature-specific fields
```

### 3. API Endpoints

Update the API router in `apps/backend/app/api/{feature}.py`:

```python
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.{feature}_models import {Feature}, {Feature}Create, {Feature}Update
from app.services.household_service import get_user_household_id

router = APIRouter()

@router.get("/{feature}s", response_model=list[{Feature}])
def list_{feature}s(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """List all {feature}s for the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    statement = (
        select({Feature})
        .where({Feature}.household_id == household_id)
        .where({Feature}.deleted_at.is_(None))
    )
    results = db.exec(statement).all()
    return list(results)

@router.post("/{feature}s", response_model={Feature})
def create_{feature}(
    item: {Feature}Create,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Create a new {feature} in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    db_item = {Feature}(**item.model_dump(), household_id=household_id)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@router.put("/{feature}s/{id}", response_model={Feature})
def update_{feature}(
    id: str,
    updates: {Feature}Update,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Update a {feature}."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    db_item = db.get({Feature}, id)
    if not db_item or db_item.deleted_at is not None:
        raise HTTPException(status_code=404, detail="{Feature} not found")
    
    if db_item.household_id != household_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    update_data = updates.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_item, key, value)
    
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@router.delete("/{feature}s/{id}")
def delete_{feature}(
    id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Soft-delete a {feature}."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    db_item = db.get({Feature}, id)
    if not db_item or db_item.deleted_at is not None:
        raise HTTPException(status_code=404, detail="{Feature} not found")
    
    if db_item.household_id != household_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from datetime import datetime
    db_item.deleted_at = datetime.now().date()
    db.add(db_item)
    db.commit()
    
    return {"status": "deleted", "id": id}
```

**Key Principles:**
- Always use `get_current_user_id` dependency (NOT legacy HS256 auth)
- Always fetch household_id via `household_service.get_user_household_id()`
- Always check household_id match on update/delete
- Always filter by `deleted_at.is_(None)` on reads
- Always use soft-delete (set deleted_at, don't hard delete)
- Return 403 for household mismatch (not 404)

### 4. Service Layer (if applicable)

If the feature has a service layer, update CRUD operations to accept `household_id`:

```python
def get_all_{feature}s(db: Session, household_id: UUID, filter_param: str = None):
    statement = select({Feature}).order_by({Feature}.name)
    statement = statement.where({Feature}.household_id == household_id)
    if filter_param:
        statement = statement.where({Feature}.filter_column == filter_param)
    return db.exec(statement).all()

def create_{feature}(db: Session, item: {Feature}Create, household_id: UUID):
    db_item = {Feature}.from_orm(item)
    db_item.household_id = household_id
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def update_{feature}(db: Session, id: str, updates: {Feature}Update, household_id: UUID):
    db_item = db.get({Feature}, id)
    if not db_item or db_item.household_id != household_id:
        return None
    # ... update logic
    return db_item

def delete_{feature}(db: Session, id: str, household_id: UUID):
    db_item = db.get({Feature}, id)
    if not db_item or db_item.household_id != household_id:
        return False
    db.delete(db_item)  # or soft-delete
    db.commit()
    return True
```

**Key Principle:** Service functions take `household_id` as explicit parameter (don't fetch inside service). This keeps service layer testable and composable.

### 5. Household Service Helper

If not already created, add `apps/backend/app/services/household_service.py`:

```python
from uuid import UUID
from typing import Optional
from sqlmodel import Session, select
from app.schema.household_models import HouseholdMember

def get_user_household_id(db: Session, user_id: UUID) -> Optional[UUID]:
    """Get the household_id for the given user.
    
    Returns the household_id of the first active membership found.
    """
    statement = (
        select(HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user_id)
        .where(HouseholdMember.left_at.is_(None))
        .limit(1)
    )
    result = db.exec(statement).first()
    return result
```

### 6. Migration Application

Apply the migration to both dev and prod:

```bash
# Link to dev
cd /path/to/repo
supabase link --project-ref {dev_ref}
supabase db push --linked

# Link to prod
supabase link --project-ref {prod_ref}
supabase db push --linked
```

### 7. Testing

Run backend tests to ensure no regressions:

```bash
cd apps/backend
DATABASE_URL="sqlite:///:memory:" uv run pytest tests/ -v --tb=short
```

Expected: Same baseline as main (no new failures).

## Applied Examples

### Holdings (#119)
- Migrated from `bonds_mock.py` (in-memory) + XLSX file
- Created `bond_holdings` table with household_id
- Full CRUD API with authentication
- Soft-delete via `deleted_at`

### Dividends (#120)
- Migrated from `dividends_xlsx.py` file storage
- Updated existing `dividend_positions` table (household_id already present)
- Added household_id to service layer CRUD operations
- Deprecated 3 legacy XLSX endpoints

## RLS Pattern Reference

The canonical household-scoped RLS pattern:

```sql
-- SELECT: any household member can read
CREATE POLICY {table}_select ON {table} FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));

-- INSERT: only household writers (owner/member, not viewer)
CREATE POLICY {table}_insert ON {table} FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- UPDATE: only household writers
CREATE POLICY {table}_update ON {table} FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));

-- DELETE: only household writers (or use soft-delete and block hard deletes)
CREATE POLICY {table}_delete ON {table} FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));
```

Helper functions used:
- `public.is_household_member(household_id)` — checks if auth.uid() is an active member
- `public.is_household_writer(household_id)` — checks if auth.uid() is owner or member (not viewer)

These functions are defined in `20260430120100_rls_helpers.sql` migration.

## Decision

**Adopt this pattern for all future mock/file → DB migrations.** The next feature migration should follow this recipe verbatim.

**Benefits:**
- Consistent RLS security model
- Testable service layer (household_id as parameter)
- Reusable household helper
- Idempotent migrations
- Audit trail via soft-delete
- Clear deprecation path for legacy endpoints

**When to deviate:**
- Reference/market data tables (no household_id, read-only for authenticated)
- Owner-private tables (use `owner_user_id` instead of `household_id`)
- Tables with different isolation model (consult team first)
