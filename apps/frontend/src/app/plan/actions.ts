'use server';

import { createClient } from '@/lib/supabase/server';
import type { Plan } from '@/components/Plan/types';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Looks up the calling user's primary active household_id.
 * household_id must NEVER come from user input — always from the session.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.household_id as string;
}

// ── Server Action ─────────────────────────────────────────────────────────────

/**
 * Returns the most-recently updated plan for the authenticated user's
 * household.
 *
 * Security guarantees:
 * - `household_id` is resolved from the authenticated session; never from
 *   caller input.
 * - Supabase RLS enforces read isolation at the DB layer.
 *
 * @returns The latest plan row, or `null` when none exists yet.
 */
export async function getLatestPlan(): Promise<Plan | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return null;

  const { data, error } = await supabase
    .from('plans')
    .select('id, name, description, data, created_at, updated_at')
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestPlan] query error:', error.message);
    return null;
  }
  if (!data) return null;

  return data as unknown as Plan;
}
