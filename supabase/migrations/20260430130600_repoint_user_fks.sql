-- Migration: 20260430130600_repoint_user_fks
-- Created: 2026-04-30
-- Author: McManus (Data Architecture) — addresses Decision #4 supplementary (2026-04-30)
--
-- PURPOSE: Repoint any FOREIGN KEY constraints that referenced public."user"(id)
-- to instead reference auth.users(id) directly, per Decision #4.
--
-- FK AUDIT RESULT (grep of supabase/migrations/ on 2026-04-30):
--   Pattern searched: public\.user\b, FOREIGN KEY.*"user", REFERENCES "user",
--                     REFERENCES public\.user
--   Result: NO Supabase migration file contains a FOREIGN KEY constraint
--   definition pointing to public."user"(id).
--   The public.user table was a leaf node in the migration graph —
--   no other migration declared an FK referencing it.
--
--   Audit column pattern (created_by / updated_by): The 20260430130000 migration
--   adds only created_at, updated_at, deleted_at — no created_by/updated_by
--   reference columns exist in the current migration chain. No FK repoints needed.
--
-- DECISION: No ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT operations required.
-- This file is retained for sequence consistency and to document the audit result.
--
-- FUTURE: If broker integrations or audit trail columns referencing auth.users(id)
-- are added later, insert a new migration at 20260430130700 or later — do NOT
-- edit this file.

-- (intentionally a no-op; prevents empty-file parse errors in some migration tools)
select 1;

-- end of migration
