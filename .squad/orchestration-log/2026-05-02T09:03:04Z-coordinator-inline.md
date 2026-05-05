# Orchestration Log: 2026-05-02T09:03:04Z

**Agent:** Coordinator (inline fix, not a spawn)
**Requested by:** Hockney's blocked PR

## What Happened

1. After Hockney fixed shadow DB issue, second bug surfaced: double-insert of household_members.
2. Root cause: `trg_households_add_creator` (existing trigger on public.households) already inserts owner row.
3. Coordinator made targeted edits to `handle_new_user_household()` and backfill (removed redundant inserts).
4. Committed a57cd74, CI passed, PR merged squash to main.

## Outcomes

- Resolves household provisioning chain bug.
- Establishes trigger ownership pattern: each trigger owns one side effect, no duplication.
- PR #142 now clean.

## Decisions Logged

- When chaining triggers: never duplicate work downstream trigger already does.
