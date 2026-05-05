'use server';

/**
 * Household Audit Trail — server-side helper
 *
 * Records lifecycle events for a household into `household_audit_log`.
 * All writes go through the service-role client so they bypass RLS
 * (the table has no authenticated INSERT policy by design).
 *
 * SECURITY CONTRACT
 * -----------------
 * • Never pass raw invite tokens in `metadata` — callers must hash or omit.
 * • Never pass financial amounts or account numbers in `metadata`.
 * • IP and user-agent are resolved from Next.js request headers
 *   (available in Server Actions and Route Handlers via `next/headers`).
 *   Masking / anonymisation is deferred to a follow-up issue.
 *
 * INTEGRATION POINTS FOR FENSTER'S #74 (invite flow)
 * ----------------------------------------------------
 * When the invite Server Actions land, call:
 *   recordHouseholdEvent({ householdId, action: 'invite_created',
 *     targetInviteId: invite.id,
 *     metadata: { email: invite.email }   // no raw token
 *   })
 *   recordHouseholdEvent({ householdId, action: 'invite_accepted',
 *     targetUserId: newMember.id,
 *     targetInviteId: invite.id,
 *     metadata: {}
 *   })
 *   recordHouseholdEvent({ householdId, action: 'invite_revoked',
 *     targetInviteId: invite.id,
 *     metadata: {}
 *   })
 *
 * HOOK INTO EXISTING FLOWS
 * ------------------------
 * • household_created: already emitted from the DB trigger
 *   `handle_new_user_household()`. Optionally call from application layer after
 *   bootstrap if you need richer metadata (e.g. sign-up source).
 * • member_removed / role_changed: call from the household admin Server Action
 *   once it is implemented (TJ-022 dependency).
 * • member_left: call from the "leave household" Server Action.
 * • household_renamed: call from the rename Server Action.
 * • household_deleted / household_restored: TODO — soft-delete flow not yet
 *   implemented. Track in follow-up issue.
 */

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HouseholdAuditAction =
  | 'household_created'
  | 'invite_created'
  | 'invite_accepted'
  | 'invite_revoked'
  | 'role_changed'
  | 'member_removed'
  | 'member_left'
  | 'household_renamed'
  | 'household_deleted'
  | 'household_restored';

export interface RecordHouseholdEventOptions {
  /** The household this event belongs to. */
  householdId: string;
  /** The action that occurred. */
  action: HouseholdAuditAction;
  /**
   * Actor who triggered the event.
   * When omitted, the helper resolves it from the current Supabase session.
   * Pass `null` explicitly to record a system/trigger-fired event with no actor.
   */
  actorUserId?: string | null;
  /** Affected user (e.g., the invited / removed member). */
  targetUserId?: string | null;
  /** Affected invite UUID — do NOT pass the raw token, only the UUID row id. */
  targetInviteId?: string | null;
  /**
   * Contextual details (before/after diff, new name, etc.).
   *
   * ⚠️  Callers MUST redact:
   *   - financial amounts, account numbers, balances
   *   - raw invite tokens (use `targetInviteId` for the UUID instead)
   *   - any PII beyond what is strictly necessary for forensics
   */
  metadata?: Record<string, unknown>;
}

export type RecordHouseholdEventResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helper: extract actor context from Next.js request headers
// ---------------------------------------------------------------------------

async function resolveActorContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip') ??
      null;
    const userAgent = h.get('user-agent') ?? null;
    return { ip, userAgent };
  } catch {
    // headers() throws outside request scope (e.g., background jobs).
    return { ip: null, userAgent: null };
  }
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Appends a lifecycle event to `household_audit_log`.
 *
 * Uses the service-role client — bypasses RLS. Must only be called from
 * Server Actions, Route Handlers, or server-side scripts.
 *
 * @returns `{ ok: true, id }` on success, `{ ok: false, error }` on failure.
 */
export async function recordHouseholdEvent(
  opts: RecordHouseholdEventOptions,
): Promise<RecordHouseholdEventResult> {
  const {
    householdId,
    action,
    actorUserId,
    targetUserId = null,
    targetInviteId = null,
    metadata = {},
  } = opts;

  // Resolve actor from session when not explicitly provided
  let resolvedActorId: string | null = actorUserId ?? null;
  if (actorUserId === undefined) {
    try {
      const userClient = await createClient();
      const {
        data: { user },
      } = await userClient.auth.getUser();
      resolvedActorId = user?.id ?? null;
    } catch {
      resolvedActorId = null;
    }
  }

  const { ip, userAgent } = await resolveActorContext();

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('household_audit_log')
    .insert({
      household_id: householdId,
      user_id: resolvedActorId,
      action,
      target_user_id: targetUserId,
      target_invite_id: targetInviteId,
      metadata,
      actor_ip: ip,
      actor_user_agent: userAgent,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[audit] Failed to record household event', {
      action,
      householdId,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, id: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Record that a household was just created (supplements the DB trigger). */
export async function recordHouseholdCreated(
  householdId: string,
  actorUserId?: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'household_created',
    actorUserId,
    metadata: {},
  });
}

/** Record that an invite was sent. Pass invite UUID, NOT the raw token. */
export async function recordInviteCreated(
  householdId: string,
  inviteId: string,
  inviteeEmail: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'invite_created',
    targetInviteId: inviteId,
    // Store only the email for traceability; no raw token.
    metadata: { invitee_email: inviteeEmail },
  });
}

/** Record that a member accepted an invite. */
export async function recordInviteAccepted(
  householdId: string,
  newMemberId: string,
  inviteId: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'invite_accepted',
    targetUserId: newMemberId,
    targetInviteId: inviteId,
    metadata: {},
  });
}

/** Record that an invite was revoked before redemption. */
export async function recordInviteRevoked(
  householdId: string,
  inviteId: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'invite_revoked',
    targetInviteId: inviteId,
    metadata: {},
  });
}

/** Record a member role change. */
export async function recordRoleChanged(
  householdId: string,
  targetUserId: string,
  previousRole: string,
  newRole: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'role_changed',
    targetUserId,
    metadata: { previous_role: previousRole, new_role: newRole },
  });
}

/** Record that an owner removed a member. */
export async function recordMemberRemoved(
  householdId: string,
  removedUserId: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'member_removed',
    targetUserId: removedUserId,
    metadata: {},
  });
}

/** Record that a member voluntarily left the household. */
export async function recordMemberLeft(
  householdId: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'member_left',
    metadata: {},
  });
}

/** Record a household rename. */
export async function recordHouseholdRenamed(
  householdId: string,
  previousName: string,
  newName: string,
): Promise<RecordHouseholdEventResult> {
  return recordHouseholdEvent({
    householdId,
    action: 'household_renamed',
    // names are not considered financial data — safe to store
    metadata: { previous_name: previousName, new_name: newName },
  });
}

// TODO: recordHouseholdDeleted / recordHouseholdRestored — defer until soft-delete
// flow is implemented (no existing action; track in follow-up issue).
