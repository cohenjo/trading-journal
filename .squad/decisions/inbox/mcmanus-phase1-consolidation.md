# McManus — Phase 1 Schema Consolidation Decisions

**Date:** 2026-04-30  
**Author:** McManus (Data Architecture)  
**Context:** Resolving 4 user-pending decisions from coordinator inbox on PR #85

---

## Decision #1 — Hard-delete allowed for household owners

**Implements:** User decision "Hard-delete OK"  
**Migration:** `20260430130500_relax_delete_policies.sql`

Dropped `USING (false)` DELETE policies (`households_no_hard_delete`, `household_members_no_hard_delete`) and replaced with owner-only hard-delete using `is_household_owner()`. The `household_role` enum has no 'admin' value — 'owner' is the administrative equivalent. `deleted_at`/`left_at` columns retained for soft-delete UX but not enforced as a DB constraint.

---

## Decision #2 — Enum stays `household_role`

**Implements:** User decision "Enum stays household_role"  
**No migration needed** — implementation was already correct.  
**Doc fix:** `docs/design-hosting/sections/06-data-architecture.md` corrected from `household_member_role` to `household_role`.

---

## Decision #3 — Drop trading_account_secrets; config is household-only

**Implements:** User decision "DROP public.trading_account_secrets"  
**Migration:** `20260430130300_drop_trading_account_secrets.sql` (replaces sketch)

- `trading_account_secrets` never created (sketch was commented out) — `DROP IF EXISTS` is idempotent
- Dropped credential columns from `trading_account_config`: `app_key`, `app_secret`, `account_hash`, `tokens_path`
- Added `household_id` FK + audit columns + tg_update_timestamp trigger to `trading_account_config`
- Enabled RLS: member read/insert/update, household owner hard-delete

---

## Decision #4 — public.user → public.user_profile

**Implements:** User decision "public.user → public.user_profile"  
**Migrations:** `20260430130400_user_to_user_profile.sql` + `20260430130600_repoint_user_fks.sql`

- `DROP TABLE public."user" CASCADE` (no FK constraint casualties found in migration chain)
- `CREATE TABLE public.user_profile (id uuid PK REFERENCES auth.users ON DELETE CASCADE, display_name, default_household_id, ui_preferences jsonb, filter_prefs jsonb, created_at, updated_at)`
- RLS: owner-only (`id = auth.uid()`) for SELECT/INSERT/UPDATE/DELETE
- `handle_new_auth_user()` trigger on `auth.users` AFTER INSERT: `SECURITY DEFINER + SET search_path = public, auth` (anti-CVE pattern); `ON CONFLICT DO NOTHING` for idempotency
- Backfill: `INSERT INTO user_profile (id) SELECT id FROM auth.users ON CONFLICT DO NOTHING`
- FK audit result: zero FK constraints in migration chain referencing `public.user(id)` — no repoints needed (documented in 20260430130600)
- Any SQLAlchemy/Alembic-managed FKs must be removed from Alembic history before deploying to a live environment

---

## Routing note

These decisions affect:
- **Redfoot** (pgTAP, PR #88): needs tests for 5 new/replaced DELETE policies and `user_profile` owner policies
- **Hockney**: `trading_account_config` SQLAlchemy model should remove `app_key`, `app_secret`, `account_hash`, `tokens_path` fields and add `household_id`; `User` model should be replaced with `UserProfile`
- **Rabin**: `is_household_owner()` helper is now load-bearing for DELETE policies — ensure helper is covered in the pgTAP suite

_Do NOT run Scribe — coordinator will batch consolidate later._
