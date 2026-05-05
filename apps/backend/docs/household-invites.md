# Household Invites

**Table:** `public.household_invites`
**Issue:** [#74 — TJ-021](https://github.com/cohenjo/trading-journal/issues/74) (pre-req migration)
**Author:** Hockney (Backend Dev)
**Migration:** `supabase/migrations/20260506200000_household_invites_schema.sql`
**Round:** R12, 2026-05-06

---

## Overview

`household_invites` stores the full invite lifecycle — pending invitations sent by household owners, accepted invites, revocations, and expirations. Rows are **never deleted**: lifecycle is managed through the `status` enum FSM. This design preserves audit history and enables the `household_audit_log.target_invite_id` FK (added in the same migration).

---

## Schema

```sql
household_invites (
  id                    uuid        PK   DEFAULT gen_random_uuid()
  household_id          uuid        NOT NULL  FK → households(id) ON DELETE CASCADE
  invited_email         text        NOT NULL
  invited_by_user_id    uuid        NULLABLE  FK → auth.users(id) ON DELETE SET NULL
  invite_token          text        NOT NULL UNIQUE  -- 64-char hex, 256-bit entropy
  role                  household_role  NOT NULL DEFAULT 'member'
  status                household_invite_status  NOT NULL DEFAULT 'pending'
  expires_at            timestamptz  NOT NULL
  created_at            timestamptz  NOT NULL DEFAULT now()
  updated_at            timestamptz  NOT NULL DEFAULT now()
  accepted_at           timestamptz  NULLABLE
  accepted_by_user_id   uuid        NULLABLE  FK → auth.users(id) ON DELETE SET NULL
  revoked_at            timestamptz  NULLABLE
  revoked_by_user_id    uuid        NULLABLE  FK → auth.users(id) ON DELETE SET NULL
)
```

### `household_invite_status` enum

| Value      | Meaning                                           |
|------------|---------------------------------------------------|
| `pending`  | Invite sent; awaiting acceptance or expiry        |
| `accepted` | Invite redeemed; member joined household          |
| `revoked`  | Owner cancelled invite before redemption          |
| `expired`  | Not yet consumed — enforced at accept time only   |

> `expired` status is NOT automatically applied by a background job in this phase.
> The `accept_invite()` function rejects expired tokens regardless of status.
> A cleanup job or scheduled pg_cron task should transition `pending` rows past
> `expires_at` to `expired` in a future issue.

### `household_role` enum (existing)

`'owner' | 'member' | 'viewer'` — matches `household_members.role`.

### Indexes

| Index name                            | Columns / predicate                                | Purpose                                   |
|---------------------------------------|----------------------------------------------------|-------------------------------------------|
| `household_invites_unique_pending`    | `(household_id, lower(invited_email)) WHERE pending` | Prevent duplicate pending invites per email |
| `household_invites_token_lookup`      | `(invite_token) WHERE pending`                     | Token validation hot path                 |
| `household_invites_household_status`  | `(household_id, status, created_at DESC)`          | Owner invite management dashboard         |
| `household_invites_email_pending`     | `(lower(invited_email)) WHERE pending`             | Invited-user dashboard                    |

---

## Lifecycle

```
Owner creates invite                  → status = 'pending'
  ├── User calls accept_invite(token) → status = 'accepted', member row inserted
  ├── Owner revokes invite            → status = 'revoked'  (UPDATE via Server Action)
  └── expires_at passes (no action)  → token rejected at accept time; status stays 'pending'
                                        (future cleanup job will transition to 'expired')
```

---

## Token Format

- **Generation:** `public.gen_invite_token()` — calls `gen_random_bytes(32)` and hex-encodes to a 64-character string.
- **Entropy:** 256 bits — collision-resistant and brute-force-safe.
- **URL-safe:** Hex chars only (`[0-9a-f]`), no padding, no special characters.
- **Delivery:** Include as a query parameter in the invite link, e.g.:
  `https://app.example.com/invite?token=<64-char-hex>`
- **Secret:** Treat the raw token as a secret. **Never** log it, never store it in `metadata`, never include it in `household_audit_log`. Reference invites by `id` (UUID) in audit entries.

### Expiry policy

**Recommended default:** 7 days from creation. Set `expires_at = now() + interval '7 days'` in the Server Action. The value is caller-controlled — Fenster may expose this as an admin setting in a future issue.

---

## RLS Policies

| Operation | Policy                                                                              |
|-----------|-------------------------------------------------------------------------------------|
| SELECT    | `is_household_owner(household_id)` **OR** `lower(invited_email) = jwt.email AND status = 'pending'` |
| INSERT    | `is_household_owner(household_id)` — only owners can send invites                  |
| UPDATE    | `is_household_owner(household_id)` — only owners can revoke directly               |
| DELETE    | `USING (false)` — unconditionally blocked; use status transitions                  |

> **Note on acceptance:** Invite acceptance uses `accept_invite()` (SECURITY DEFINER),
> which bypasses RLS entirely for the atomic member insert. There is no direct-UPDATE
> policy for accepted users — this is intentional.

---

## Helper Functions

### `public.gen_invite_token() → text`

Generate a fresh URL-safe token. Call once per invite in the `createInvite()` Server Action.

```typescript
// Server Action (Fenster's #74)
const { data: tokenRow } = await supabaseAdmin.rpc('gen_invite_token');
const token = tokenRow as string;
```

Or generate in TypeScript if preferred (see token format above) — the function is provided for convenience and consistency.

### `public.accept_invite(p_token text) → uuid`

Atomically accept a pending, non-expired invite. Returns the invite `id` UUID.

```typescript
// Server Action: acceptInvite(token: string)
const { data: inviteId, error } = await supabase.rpc('accept_invite', {
  p_token: token,
});

if (error) {
  // P0001 → not authenticated
  // P0002 → token invalid, expired, or already used
  throw new Error(error.message);
}

// Emit audit event — REQUIRED after successful accept
await recordInviteAccepted(householdId, newMemberId, inviteId);
```

**Error codes:**

| Code   | Meaning                                              |
|--------|------------------------------------------------------|
| P0001  | Caller is not authenticated (`auth.uid()` is null)   |
| P0002  | Token not found, already accepted, revoked, or expired |

**Idempotency:** If the user is already a household member, the `INSERT ... ON CONFLICT DO NOTHING` clause makes the membership insert a no-op. The invite is still marked accepted.

---

## Integration Plan for Fenster's #74

Fenster owns the Server Actions and UI. Wire these calls in each action:

### `createInvite(householdId, email, role, expiresInDays = 7)`

```typescript
// 1. Generate token
const token = await supabase.rpc('gen_invite_token');

// 2. Insert invite
const { data: invite } = await supabaseAdmin.from('household_invites').insert({
  household_id: householdId,
  invited_email: email,
  invited_by_user_id: session.user.id,
  invite_token: token,
  role,
  expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
}).select('id').single();

// 3. Audit — no raw token
await recordInviteCreated(householdId, invite.id, email);

// 4. Send invite email with link: /invite?token=<token>
```

### `acceptInvite(token: string)`

```typescript
const { data: inviteId } = await supabase.rpc('accept_invite', { p_token: token });
// resolve householdId and newMemberId from session / inviteId for audit
await recordInviteAccepted(householdId, session.user.id, inviteId);
```

### `revokeInvite(inviteId: string)`

```typescript
await supabaseAdmin.from('household_invites')
  .update({
    status: 'revoked',
    revoked_at: new Date().toISOString(),
    revoked_by_user_id: session.user.id,
  })
  .eq('id', inviteId)
  .eq('status', 'pending');   // guard: only revoke pending invites

await recordInviteRevoked(householdId, inviteId);
```

---

## Audit Trail Integration

See [`household-audit-trail.md`](./household-audit-trail.md) for the full helper API.

| Server Action     | Audit call                                          |
|-------------------|-----------------------------------------------------|
| `createInvite`    | `recordInviteCreated(householdId, inviteId, email)` |
| `acceptInvite`    | `recordInviteAccepted(householdId, memberId, inviteId)` |
| `revokeInvite`    | `recordInviteRevoked(householdId, inviteId)`        |

**Security reminder:** Pass `inviteId` (UUID) to audit helpers — never the raw `invite_token`.

---

## Audit Log FK

`household_audit_log.target_invite_id` now carries a soft FK (`NOT VALID`, `ON DELETE SET NULL`) to `household_invites(id)`, added in the R12 migration. This supersedes the R11 "no FK: short-lived" comment — invite rows are kept indefinitely via status FSM.

---

## Security Notes

1. **Token secrecy:** The `invite_token` is a shared secret. Treat it like a password-reset token. Never log it.
2. **Email matching:** The `invited_select` RLS policy matches `lower(invited_email) = lower(jwt.email)`. If the user signs in with a different email than the one invited, they cannot see the invite row via RLS — they can only accept it with the token (which `accept_invite()` validates without email verification, by design: token possession is the access control).
3. **Race conditions:** `accept_invite()` uses `FOR UPDATE` on the invite row to prevent double-acceptance under concurrent requests.
4. **Revoked invite UX:** Fenster should check `status = 'pending'` when rendering the accept page and show a clear error for revoked/expired tokens.

---

## Deferred Items

| Item                                         | Status      |
|----------------------------------------------|-------------|
| Automated expiry job (pending → expired)     | Deferred — open follow-up with pg_cron |
| Email notification on invite                 | Deferred — #74 scope                  |
| Invite rate limiting (max N per household)   | Deferred — application-layer guard     |
| `VALIDATE CONSTRAINT` on audit FK            | Deferred — run after initial deploy verifies no orphan rows |
