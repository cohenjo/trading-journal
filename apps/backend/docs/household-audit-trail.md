# Household Audit Trail

**Table:** `public.household_audit_log`
**Issue:** [#77 — TJ-024](https://github.com/cohenjo/trading-journal/issues/77)
**Author:** Hockney (Backend Dev)
**Migration:** `supabase/migrations/20260505140000_household_audit_trail.sql`

---

## Overview

Every significant lifecycle event for a household is appended to `household_audit_log`. The table is **append-only**: RLS blocks `UPDATE` and `DELETE` for all roles; `INSERT` is reserved for the service-role client (bypasses RLS). Household owners can `SELECT` their own household's log; ordinary members cannot.

---

## Schema

```sql
household_audit_log (
  id               uuid        PK  DEFAULT gen_random_uuid()
  household_id     uuid        NOT NULL  FK → households(id) ON DELETE CASCADE
  user_id          uuid        NULLABLE  FK → auth.users(id) ON DELETE SET NULL  -- actor
  action           household_audit_action  NOT NULL  -- see enum below
  target_user_id   uuid        NULLABLE  FK → auth.users(id) ON DELETE SET NULL
  target_invite_id uuid        NULLABLE  -- no FK; invite rows may be short-lived
  metadata         jsonb       NOT NULL DEFAULT '{}'
  actor_ip         inet        NULLABLE
  actor_user_agent text        NULLABLE
  created_at       timestamptz NOT NULL DEFAULT now()
)
```

### `household_audit_action` enum

| Value               | Meaning                                              |
|---------------------|------------------------------------------------------|
| `household_created` | First user signed up — household + owner row created |
| `invite_created`    | An invite was sent to an email address               |
| `invite_accepted`   | Invite was redeemed; new member joined               |
| `invite_revoked`    | Sent invite revoked before redemption                |
| `role_changed`      | Member role updated (e.g. viewer → member)           |
| `member_removed`    | Owner administratively removed a member              |
| `member_left`       | Member voluntarily left the household                |
| `household_renamed` | Household display name updated                       |
| `household_deleted` | Household soft-deleted *(deferred — see below)*      |
| `household_restored`| Soft-deleted household restored *(deferred)*         |

### Indexes

| Index                                | Purpose                              |
|--------------------------------------|--------------------------------------|
| `(household_id, created_at DESC)`    | Household history page               |
| `(user_id, created_at DESC)`         | "What did this actor do?" queries    |
| `(action, created_at DESC)`          | Filter by event type / compliance    |

---

## RLS Policies

| Operation | Policy                                                              |
|-----------|---------------------------------------------------------------------|
| SELECT    | `is_household_owner(household_id)` — owners only                   |
| INSERT    | No policy — service-role client bypasses RLS for all writes        |
| UPDATE    | `USING (false)` — unconditionally blocked                          |
| DELETE    | `USING (false)` — unconditionally blocked                          |

---

## Application Helper

**Path:** `apps/frontend/src/lib/household/audit.ts`

### `recordHouseholdEvent(opts)` — low-level

```typescript
import { recordHouseholdEvent } from '@/lib/household/audit';

await recordHouseholdEvent({
  householdId: 'uuid',
  action: 'role_changed',
  // actorUserId: resolved from session when omitted; pass null for system events
  targetUserId: 'target-uuid',
  metadata: { previous_role: 'viewer', new_role: 'member' },
});
```

The helper automatically:
- Resolves `user_id` (actor) from the current Supabase session if `actorUserId` is omitted
- Captures `actor_ip` from `x-forwarded-for` / `x-real-ip` headers
- Captures `actor_user_agent` from the `user-agent` header
- Writes via `createAdminClient()` (service-role) — bypasses RLS

### Convenience wrappers

```typescript
import {
  recordHouseholdCreated,
  recordInviteCreated,
  recordInviteAccepted,
  recordInviteRevoked,
  recordRoleChanged,
  recordMemberRemoved,
  recordMemberLeft,
  recordHouseholdRenamed,
} from '@/lib/household/audit';

// Invite flow (integrate with Fenster's #74)
await recordInviteCreated(householdId, invite.id, invite.email);      // no raw token
await recordInviteAccepted(householdId, newMember.id, invite.id);
await recordInviteRevoked(householdId, invite.id);

// Membership admin (integrate once TJ-022 server actions exist)
await recordRoleChanged(householdId, targetId, 'viewer', 'member');
await recordMemberRemoved(householdId, removedUserId);
await recordMemberLeft(householdId);

// Household management
await recordHouseholdRenamed(householdId, 'Old Name', 'New Name');
```

---

## Security & Privacy Rules

1. **No raw invite tokens** — use `targetInviteId` (UUID) only. Raw tokens must never appear in `metadata`.
2. **No financial data** — no dollar amounts, account numbers, balances, or trade identifiers in `metadata`.
3. **No sensitive PII** — email may be stored for invite audit trail; avoid SSN, tax IDs, etc.
4. **IP masking** — full IP anonymisation (e.g. last-octet zeroing for IPv4) is deferred to a follow-up issue. Current behaviour: stores the raw originating IP.
5. **User deletion** — `actor_user_id` and `target_user_id` foreign keys use `ON DELETE SET NULL`, so audit rows are retained even after a user is deleted.
6. **Household deletion** — `household_id` uses `ON DELETE CASCADE`, so audit rows are removed when a household is hard-deleted. Soft-delete is the standard path (`deleted_at`), which preserves the audit log.

---

## Sample Queries

### Household history (owner view)
```sql
SELECT created_at, action, user_id, target_user_id, target_invite_id, metadata
FROM   household_audit_log
WHERE  household_id = '<uuid>'
ORDER  BY created_at DESC
LIMIT  50;
```

### All invite events for a household
```sql
SELECT *
FROM   household_audit_log
WHERE  household_id = '<uuid>'
  AND  action IN ('invite_created', 'invite_accepted', 'invite_revoked')
ORDER  BY created_at DESC;
```

### Recent actions by a specific user (admin / compliance)
```sql
SELECT household_id, action, target_user_id, metadata, actor_ip, created_at
FROM   household_audit_log
WHERE  user_id = '<actor-uuid>'
ORDER  BY created_at DESC
LIMIT  100;
```

---

## Integration Points

### Fenster's invite flow (#74)

Wire these calls into the invite Server Actions once they land:

```typescript
// In createInvite() action:
await recordInviteCreated(householdId, invite.id, invite.email);

// In acceptInvite() action (after token verification + member insert):
await recordInviteAccepted(householdId, newMember.id, invite.id);

// In revokeInvite() action:
await recordInviteRevoked(householdId, invite.id);
```

### `household_created` (existing DB trigger)

`handle_new_user_household()` in `20260502120000_auto_provision_household_on_signup.sql` fires on `auth.users INSERT`. Optionally call `recordHouseholdCreated()` from the application layer when richer metadata (e.g. sign-up source, referral code) is available.

---

## Deferred / Follow-up Issues

| Item                                     | Status    |
|------------------------------------------|-----------|
| `household_deleted` / `household_restored` events | Deferred — soft-delete flow not yet implemented. Open a follow-up issue when `deleted_at` admin action is built. |
| IP masking / last-octet anonymisation    | Deferred  |
| Audit log retention policy               | Deferred  |
| Audit log UI (admin view)               | Out of scope for this issue — future work |
| Compliance export                        | Out of scope — future work |

---

## Retention Policy

Retention policy is **deferred**. No automated pruning is in place. When compliance requirements are clearer, open a follow-up issue to implement a `pg_cron`-based TTL or archive job.
