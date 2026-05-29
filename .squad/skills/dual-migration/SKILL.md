---
name: dual-migration
description: >
  Pattern for authoring paired Supabase + Alembic migrations in this project.
  Use whenever a schema change requires both a Supabase SQL migration (for prod
  apply via psql) and an Alembic Python migration (for dev chain validity).
author: Hockney
created: 2026-05-29
tags: [migrations, supabase, alembic, schema, postgres, rls]
---

# Dual-Migration Pattern

This project uses **two migration surfaces** for every schema change:

| Surface | File location | Applied by | Purpose |
|---------|--------------|------------|---------|
| Supabase SQL | `supabase/migrations/{ts}_{slug}.sql` | `psql` against `SUPABASE_DIRECT_SESSION_URL` | Production (and CI) |
| Alembic Python | `apps/backend/alembic/versions/{rev}_{slug}.py` | `uv run alembic upgrade head` | Dev chain, local Postgres |

---

## Step 1 — Choose your timestamp / revision

- **Supabase timestamp:** `YYYYMMDDHHMMSS` (e.g. `20260529122500`). Must be greater than the latest file in `supabase/migrations/`.
- **Alembic revision ID:** 12 hex chars (e.g. `c1c2c3c4c5c6`). Use `down_revision = "<current head>"`.

To confirm the current Alembic head:
```bash
# Look at the most recently created file in alembic/versions/
ls -t apps/backend/alembic/versions/*.py | head -1
# Then read its `revision = "..."` line
```

---

## Step 2 — Supabase migration file

```sql
-- Migration: {timestamp}_{slug}
-- Author: {name}
-- Date: {YYYY-MM-DD}
-- Purpose: {description}
-- IDEMPOTENCY: All DDL uses IF NOT EXISTS / DROP POLICY IF EXISTS.

-- TABLE CREATION ORDER: draw the FK dependency DAG first.
-- Parent tables MUST appear before child tables.
-- Example dependency-safe order for the CC pipeline:
--   expense_inbox → expense_categories → credit_card_statements
--   → credit_card_transactions → merchant_category_mappings

create table if not exists public.my_table (
    id          uuid        primary key default gen_random_uuid(),
    amount_ils  numeric(12,2) not null,
    -- ILS shekels (NOT agorot). e.g. 126.00 = ₪126.
    household_id uuid       not null references public.households(id),
    ...
);

comment on column public.my_table.amount_ils is
    'Charge in ILS (shekels, NOT agorot). NUMERIC(12,2).';

-- RLS (household-scoped tables):
alter table public.my_table enable row level security;
revoke all on table public.my_table from anon;
revoke all on table public.my_table from authenticated;
grant select on table public.my_table to authenticated;
grant select, insert, update, delete on table public.my_table to service_role;

drop policy if exists my_table_household_select on public.my_table;
create policy my_table_household_select
    on public.my_table for select to authenticated
    using (public.is_household_member(household_id));

drop policy if exists my_table_service_all on public.my_table;
create policy my_table_service_all
    on public.my_table for all to service_role
    using (true) with check (true);
```

**For global tables** (no household_id, shared taxonomy etc.):
```sql
create policy my_global_table_authenticated_select
    on public.my_global_table for select to authenticated
    using (true);
```

---

## Step 3 — Alembic migration file

```python
"""{slug}

{description}. RLS policies are in the Supabase migration only.

Revision ID: {rev}
Revises: {prev_rev}
Create Date: {datetime}
"""

import sqlalchemy as sa
from alembic import op

revision = "{rev}"
down_revision = "{prev_rev}"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "my_table",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("amount_ils", sa.Numeric(12, 2), nullable=False,
                  comment="ILS shekels (NOT agorot). NUMERIC(12,2)."),
        sa.Column("household_id", sa.UUID(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"]),
        schema="public",
    )
    op.create_index("my_table_household_idx", "my_table", ["household_id"], schema="public")


def downgrade() -> None:
    op.drop_table("my_table", schema="public")
```

**Key Alembic conventions:**
- Always include `schema="public"` in `create_table` / `create_index` calls.
- Use `sa.text("gen_random_uuid()")` for UUID server defaults.
- Use `sa.text("now()")` for timestamp server defaults.
- Partial indexes: `postgresql_where=sa.text("column = 'value'")`.
- Numeric columns: `sa.Numeric(precision, scale)` — e.g. `sa.Numeric(12, 2)` for ILS amounts.
- `downgrade()` must drop tables in **reverse** creation order to avoid FK violations.

---

## Step 4 — SQLModel ORM class

```python
# apps/backend/app/schema/{domain}.py
from decimal import Decimal
from sqlalchemy import Column, Numeric, text
from sqlmodel import Field, SQLModel

class MyTable(SQLModel, table=True):
    __tablename__ = "my_table"

    id: UUID = Field(default=None, primary_key=True,
                     sa_column_kwargs={"server_default": text("gen_random_uuid()")})
    amount_ils: Decimal = Field(
        sa_column=Column(Numeric(12, 2), nullable=False,
                         comment="ILS shekels (NOT agorot). NUMERIC(12,2).")
    )
    household_id: UUID = Field(nullable=False, foreign_key="households.id", index=True)
```

**Register in `apps/backend/alembic/env.py`:**
```python
from app.schema.{domain} import MyTable  # noqa: F401 — register with SQLModel.metadata
```

---

## Step 5 — Apply to prod

```bash
cd apps/backend
set -a && source .env && set +a
psql "$SUPABASE_DIRECT_SESSION_URL" \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    -f ../../supabase/migrations/{timestamp}_{slug}.sql
```

**ALWAYS use `--single-transaction` and `ON_ERROR_STOP=1`.** FK order errors (table created before its parent) roll back cleanly this way.

**Register in schema_migrations:**
```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('{timestamp}', '{slug}',
        ARRAY['CREATE TABLE my_table', 'ALTER TABLE ... ENABLE ROW LEVEL SECURITY', ...])
ON CONFLICT (version) DO NOTHING;
```

**Verify:**
```bash
psql "$SUPABASE_DIRECT_SESSION_URL" -c "\d public.my_table"
psql "$SUPABASE_DIRECT_SESSION_URL" \
    -c "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='{timestamp}';"
```

---

## Common Gotchas

| Gotcha | Fix |
|--------|-----|
| FK error on CREATE TABLE | Draw the dependency DAG; parent tables must come first in the SQL file |
| `NULL != NULL` breaks UNIQUE on nullable FK | Use two partial unique indexes (`WHERE fk IS NULL` / `WHERE fk IS NOT NULL`) |
| Pre-commit hooks reformat Python files | `git add` the reformatted files before re-committing |
| Alembic `down_revision` wrong | Check revision chain: `ls -t alembic/versions/*.py | head -1` then read the `revision` field |
| amount_ils in agorot | Always use shekels with NUMERIC(12,2). Write a column COMMENT to make the convention explicit |
| Tables half-created in prod | `--single-transaction` prevents this; always include it |

---

## RLS Helper Reference

`public.is_household_member(p_household_id uuid) → boolean`
Defined in `supabase/migrations/20260430120100_rls_helpers.sql`.
Returns true when `auth.uid()` is an active member of the given household.

Usage patterns:
```sql
-- Required membership (household_id NOT NULL):
using (public.is_household_member(household_id))

-- Optional membership (household_id nullable):
using (household_id is null or public.is_household_member(household_id))

-- Global table (no household scope):
using (true)
```
