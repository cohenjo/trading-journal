/**
 * e2e/helpers/household.ts
 *
 * Seed / cleanup helpers for household state in E2E tests.
 *
 * Two helpers:
 *   ensureNoHousehold(userId)       — removes user from any household (for first-login tests)
 *   ensureHousehold(userId, type)   — guarantees the user has a household of the given type
 *
 * Both helpers require SUPABASE_SERVICE_ROLE_KEY (service-role admin client).
 * If env is not set (e.g. CI without secrets), helpers return null and the
 * calling test must skip via test.skip().
 *
 * Security: the service-role key is read from env and NEVER logged.
 */

import { getAdminClient } from '../fixtures/admin';

export type HouseholdType = 'individual' | 'joint';

/**
 * Returns true when the service-role environment is fully configured.
 * Use this to gate tests that need admin DB access.
 */
export function hasServiceRoleEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Removes the user from their current household.
 *
 * If the user is the sole member, wipes household data (finance_snapshots,
 * trade) before deleting the household row itself (cascade-safe).
 * If the household has other members, only removes this user's membership row.
 *
 * Returns the householdId that was cleared, or null if the user had none.
 * Silently returns null when service-role env is absent (use hasServiceRoleEnv() to gate).
 */
export async function ensureNoHousehold(userId: string): Promise<string | null> {
  if (!hasServiceRoleEnv()) return null;

  const admin = getAdminClient();

  const { data: memberRow } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!memberRow?.household_id) return null;

  const householdId = memberRow.household_id as string;

  // Check how many members share this household
  const { count } = await admin
    .from('household_members')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', householdId);

  if ((count ?? 0) <= 1) {
    // Sole member: wipe household data before removing the household row
    await Promise.allSettled([
      admin.from('finance_snapshots').delete().eq('household_id', householdId),
      admin.from('trade').delete().eq('household_id', householdId),
    ]);
    await admin.from('households').delete().eq('id', householdId);
  } else {
    // Multi-member: only remove this user's membership
    await admin
      .from('household_members')
      .delete()
      .eq('user_id', userId)
      .eq('household_id', householdId);
  }

  return householdId;
}

/**
 * Ensures the user has an active household of the given type.
 *
 * - If a household already exists, updates its type field if needed.
 * - If none exists, inserts a new household row and adds the user as 'owner'.
 *
 * Returns the householdId (existing or newly created).
 * Silently returns null when service-role env is absent.
 */
export async function ensureHousehold(
  userId: string,
  type: HouseholdType = 'individual',
): Promise<string | null> {
  if (!hasServiceRoleEnv()) return null;

  const admin = getAdminClient();

  const { data: existing } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.household_id) {
    const householdId = existing.household_id as string;
    await admin
      .from('households')
      .update({ type })
      .eq('id', householdId);
    return householdId;
  }

  // Create a new household
  const { data: household, error: createErr } = await admin
    .from('households')
    .insert({ created_by: userId, type })
    .select('id')
    .single();

  if (createErr || !household) {
    throw new Error(
      `[household] Failed to create household for user ${userId}: ${createErr?.message}`,
    );
  }

  const householdId = household.id as string;

  const { error: memberErr } = await admin.from('household_members').insert({
    household_id: householdId,
    user_id: userId,
    role: 'owner',
  });

  if (memberErr) {
    throw new Error(
      `[household] Failed to add member ${userId} to household ${householdId}: ${memberErr.message}`,
    );
  }

  return householdId;
}
