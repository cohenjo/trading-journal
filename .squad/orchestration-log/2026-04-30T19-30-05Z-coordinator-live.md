# Orchestration Log: Coordinator (Live Apply)

**Date:** 2026-04-30 19:30:05Z  
**Agent:** Coordinator  
**Mode:** Sync (live apply)  
**Task:** Re-run 115000 baseline + 150000 sharing RLS on live DEV+PROD  

## What Happened

- Applied baseline legacy schema (115000) to live DEV+PROD environments
- Applied sharing RLS migrations (150000) to live DEV+PROD environments
- Dropped legacy `is_household_member`/`is_household_owner` (param `hid`) before reapply
- Dropped params due to renamed-param conflict: new signature uses `p_household_id`
- Reapplied all helpers with consolidated signature

## Outcome

- **DEV (zvbwgxdgxwgduhhzdwjj):** 5 helpers deployed with `p_household_id` signature
- **PROD (jaesiklybkbmzpgipvea):** 5 helpers deployed with `p_household_id` signature
- All RLS policies active and enforced on both environments
- No data loss; parameters renamed cleanly

## Related Migrations

- 115000: baseline_legacy_schema
- 130000–130300: household bootstrap + RLS
- 150000: sharing_rls_policies
