# Decision: TJ-005 Migration Strategy (Hockney)

**Author:** Hockney (Backend Dev)  
**Date:** 2026-04-30  
**Issue:** TJ-005 / GH #58  
**Status:** Partial — 3 of 5 migrations ready; 2 await user decisions

---

## Decisions Made

### 1. Nullable FKs first, NOT NULL enforced via follow-up migration

`household_id` and `owner_user_id` are added as nullable columns. This is intentional: existing rows cannot satisfy NOT NULL without a backfill. The constraint will be tightened in a TJ-006 follow-up migration after backfill. This pattern matches how `households.created_by` was handled.

### 2. backtesttrade excluded from owner_user_id

`backtesttrade` does not receive a direct `owner_user_id` column. Visibility is inherited from the parent `backtestrun` via `run_id` FK. RLS on `backtesttrade` will use a subquery: `EXISTS (SELECT 1 FROM backtestrun r WHERE r.id = backtesttrade.run_id AND r.owner_user_id = auth.uid())`. This is consistent with McManus's classification doc.

### 3. trading_account_config split deferred (130300 is sketch-only)

Three options (A: table split, B: dual FK + column-level grants, C: Supabase Vault) are documented side-by-side in migration `130300`. No code is executed. **Jony + Rabin must decide** before implementation. Preference noted: Option A is the cleanest relational approach; Option C is the most secure.

### 4. public.user retirement is a separate decision gate

Migration `130400` is authored but marked DESTRUCTIVE. It must not run until:
- All app code is off local auth
- User accounts are migrated to auth.users
- Alembic model is updated to not auto-create the table
This gate is documented in the migration header and the GH #58 comment.

### 5. tg_update_timestamp trigger uses DROP + CREATE (not CREATE OR REPLACE on trigger)

PostgreSQL does not support `CREATE OR REPLACE TRIGGER`. Migrations use `DROP TRIGGER IF EXISTS` followed by `CREATE TRIGGER` for idempotency, consistent with the pattern Rabin used in `120200`.

---

## Open Questions (Blocked on User)

1. **trading_account_config split**: Option A, B, or C? (See GH #58 comment)
2. **user table retirement timing**: When is auth migration complete?

---

*For Scribe: merge into `.squad/decisions.md` under "Database / Migrations" section.*
