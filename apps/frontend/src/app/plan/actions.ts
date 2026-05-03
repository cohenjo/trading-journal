'use server';

import { createClient } from '@/lib/supabase/server';
import type { Plan, PlanData } from '@/components/Plan/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanCreatePayload =
  | PlanData
  | {
      name?: string;
      description?: string | null;
      data: PlanData;
    };

export type PlanUpdatePatch = Partial<{
  name: string;
  description: string | null;
  data: PlanData;
}>;

export type PlanMutationResult =
  | { ok: true; plan: Plan }
  | { ok: false; error: string };

export type PlanDeleteResult = { ok: true } | { ok: false; error: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

const PLAN_COLUMNS = 'id, name, description, data, created_at, updated_at';

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

function parsePlanId(id: number | string): number | null {
  const parsed = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isPlanEnvelope(
  payload: PlanCreatePayload,
): payload is { name?: string; description?: string | null; data: PlanData } {
  return typeof payload === 'object' && payload !== null && 'data' in payload;
}

function normalizeCreatePayload(
  payload: PlanCreatePayload,
): { name: string; description: string | null; data: PlanData } | null {
  const rawName = isPlanEnvelope(payload) ? payload.name : undefined;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'My Plan';
  const description = isPlanEnvelope(payload) ? (payload.description ?? null) : null;
  const data = isPlanEnvelope(payload) ? payload.data : payload;

  if (!data || typeof data !== 'object') return null;
  return { name, description, data };
}

async function getAuthenticatedHouseholdId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;
  return resolveHouseholdId(user.id);
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Returns all plans for the authenticated user's household, newest first.
 */
export async function listPlans(): Promise<Plan[]> {
  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[listPlans] query error:', error.message);
    return [];
  }

  return (data ?? []) as unknown as Plan[];
}

/**
 * Returns one household-scoped plan by ID, or null when not found/unauthorized.
 */
export async function getPlan(id: number | string): Promise<Plan | null> {
  const planId = parsePlanId(id);
  if (!planId) return null;

  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .eq('household_id', householdId)
    .maybeSingle();

  if (error) {
    console.error('[getPlan] query error:', error.message);
    return null;
  }

  return data ? (data as unknown as Plan) : null;
}

/**
 * Creates a plan in the authenticated user's household.
 * Security: household_id is resolved from the session, never caller input.
 */
export async function createPlan(
  payload: PlanCreatePayload,
): Promise<PlanMutationResult> {
  const normalized = normalizeCreatePayload(payload);
  if (!normalized) return { ok: false, error: 'Plan data is required' };

  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return { ok: false, error: 'Not authenticated or no active household' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .insert({
      household_id: householdId,
      name: normalized.name,
      description: normalized.description,
      data: normalized.data,
    })
    .select(PLAN_COLUMNS)
    .single();

  if (error || !data) {
    console.error('[createPlan] insert error:', error?.message ?? 'No row returned');
    return { ok: false, error: 'Failed to create plan. Please try again.' };
  }

  return { ok: true, plan: data as unknown as Plan };
}

/**
 * Updates a household-scoped plan by ID.
 */
export async function updatePlan(
  id: number | string,
  patch: PlanUpdatePatch,
): Promise<PlanMutationResult> {
  const planId = parsePlanId(id);
  if (!planId) return { ok: false, error: 'Invalid plan ID' };
  if (!patch || typeof patch !== 'object') {
    return { ok: false, error: 'Plan update patch is required' };
  }

  const updateValues: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name) return { ok: false, error: 'Name must not be empty' };
    updateValues.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    updateValues.description = patch.description ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'data')) {
    if (!patch.data || typeof patch.data !== 'object') {
      return { ok: false, error: 'Plan data must be an object' };
    }
    updateValues.data = patch.data;
  }

  if (Object.keys(updateValues).length === 0) {
    return { ok: false, error: 'No plan fields to update' };
  }

  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return { ok: false, error: 'Not authenticated or no active household' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .update(updateValues)
    .eq('id', planId)
    .eq('household_id', householdId)
    .select(PLAN_COLUMNS)
    .single();

  if (error || !data) {
    console.error('[updatePlan] update error:', error?.message ?? 'No row returned');
    return { ok: false, error: 'Failed to update plan. Please try again.' };
  }

  return { ok: true, plan: data as unknown as Plan };
}

/**
 * Deletes a household-scoped plan by ID.
 */
export async function deletePlan(id: number | string): Promise<PlanDeleteResult> {
  const planId = parsePlanId(id);
  if (!planId) return { ok: false, error: 'Invalid plan ID' };

  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return { ok: false, error: 'Not authenticated or no active household' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .delete()
    .eq('id', planId)
    .eq('household_id', householdId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[deletePlan] delete error:', error.message);
    return { ok: false, error: 'Failed to delete plan. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Plan not found' };

  return { ok: true };
}

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
