# Hockney R11 — Household Audit Trail (TJ-024 / #77)

**Date:** 2026-05-05
**Author:** Hockney (Backend Dev)
**Issue:** #77
**PR:** squad/77-household-audit-trail (feature PR)
**Decision drop PR:** squad/hockney-r11-decision-drop

---

## Context

Issue #77 (TJ-024) requires an append-only audit trail for household lifecycle events to support security forensics and compliance. This is a Wave 3 item under the hosting-migration epic (Keaton-arch R8 sequencing plan).

---

## Schema Decisions

### Table name: `household_audit_log`

Chose `household_audit_log` (not `household_audit_events`) to match the exact table name in issue #77's acceptance criteria and to align with the `_log` naming convention used for append-only tables.

### Column `user_id` (actor) — nullable

`NULL` is a valid value for system-triggered events (e.g., DB trigger fires with no request context). This matches the `auth.users INSERT` trigger pattern already in use.

### FK on `actor` and `target`: `ON DELETE SET NULL`

Audit rows must be retained after user deletion. Setting these to `NULL` on user deletion preserves the audit trail while satisfying GDPR-style "right to erasure" at the FK level. The `household_id` FK uses `ON DELETE CASCADE` — audit lives with the household.

### No FK on `target_invite_id`

Invite rows may be short-lived (expired / purged after acceptance). A FK would risk cascade-deleting audit rows when invites are cleaned up, defeating the purpose of the audit trail.

### RLS: SELECT restricted to **owners only** (not all members)

Issue #77 AC explicitly states "readable by household owners only". This is stricter than other tables (which allow all members to read). Rationale: audit logs may reveal actor IPs and user-agents of members — restrict to owners for security forensics.

### RLS: No INSERT policy for authenticated role

INSERT is blocked for `authenticated` and `anon` roles at the `REVOKE` level. All writes go through the service-role client (`createAdminClient()`), which bypasses RLS. This ensures clients can never self-report audit events.

### `actor_ip` / `actor_user_agent` columns

Added for security forensics (IP tracing, suspicious UA detection). Full IP masking / last-octet anonymisation deferred to a follow-up issue pending privacy requirement clarification.

---

## Event Types Implemented vs Deferred

| Action                | Status      | Notes                                          |
|-----------------------|-------------|------------------------------------------------|
| `household_created`   | ✅ Implemented | DB trigger path; wrapper available for app layer |
| `invite_created`      | ✅ Implemented | Hook point documented for Fenster's #74         |
| `invite_accepted`     | ✅ Implemented | Hook point documented for Fenster's #74         |
| `invite_revoked`      | ✅ Implemented | Hook point documented for Fenster's #74         |
| `role_changed`        | ✅ Implemented | Wrapper available; Server Action TBD (TJ-022)  |
| `member_removed`      | ✅ Implemented | Wrapper available; Server Action TBD (TJ-022)  |
| `member_left`         | ✅ Implemented | Wrapper available                               |
| `household_renamed`   | ✅ Implemented | Wrapper available                               |
| `household_deleted`   | ⏳ Deferred   | Soft-delete flow not yet implemented            |
| `household_restored`  | ⏳ Deferred   | Soft-delete flow not yet implemented            |

---

## Integration Points for Fenster's #74 (invite flow)

Fenster's Wave 3 invite PR (#74) should wire the following calls into its Server Actions:

```typescript
// After inserting invite row:
await recordInviteCreated(householdId, invite.id, invite.email);

// After verifying token + inserting member row:
await recordInviteAccepted(householdId, newMember.id, invite.id);

// After revoking invite:
await recordInviteRevoked(householdId, invite.id);
```

Full integration guide in `apps/backend/docs/household-audit-trail.md`.

---

## Open Follow-ups (not blocking this PR)

1. **`household_deleted` / `household_restored`** — open follow-up issue once soft-delete admin action is built.
2. **IP masking** — deferred pending privacy requirement decision.
3. **Retention policy** — deferred; no automated pruning in place.
4. **Audit log UI** — out of scope for TJ-024.
