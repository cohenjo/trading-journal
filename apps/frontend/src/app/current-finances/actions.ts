'use server';

import { createClient } from '@/lib/supabase/server';
import type { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinanceMetrics {
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

/** Shape stored in the `data` jsonb column and returned to the client. */
export interface SnapshotData {
  items: FinanceItem[];
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

export type SaveSnapshotResult =
  | { success: true }
  | { success: false; error: string };

export type GetSnapshotResult =
  | { success: true; data: SnapshotData | null }
  | { success: false; error: string };

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

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Upserts a finance snapshot for today into `finance_snapshots`.
 *
 * Security guarantees:
 * - `household_id` is resolved from the authenticated session; never from caller input.
 * - Supabase RLS (`is_household_writer`) enforces write isolation at the DB layer.
 */
export async function saveFinanceSnapshot(
  items: FinanceItem[],
  metrics: FinanceMetrics,
): Promise<SaveSnapshotResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate inputs before hitting the DB
  if (!Array.isArray(items)) {
    return { success: false, error: 'Invalid payload: items must be an array' };
  }
  if (
    typeof metrics.net_worth !== 'number' ||
    typeof metrics.total_assets !== 'number' ||
    typeof metrics.total_liabilities !== 'number' ||
    typeof metrics.total_savings !== 'number' ||
    typeof metrics.total_investments !== 'number'
  ) {
    return { success: false, error: 'Invalid payload: all metric fields must be numbers' };
  }

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { success: false, error: 'No active household found for your account' };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const snapshotData: SnapshotData = { items, ...metrics };

  const { error: upsertError } = await supabase.from('finance_snapshots').upsert(
    {
      date: today,
      household_id: householdId,
      data: snapshotData,
      net_worth: metrics.net_worth,
      total_assets: metrics.total_assets,
      total_liabilities: metrics.total_liabilities,
    },
    { onConflict: 'date' },
  );

  if (upsertError) {
    console.error('[saveFinanceSnapshot] upsert error:', upsertError.message);
    return { success: false, error: 'Failed to save snapshot. Please try again.' };
  }

  return { success: true };
}

/**
 * Fetches the most-recent finance snapshot for the authenticated user's household.
 * Returns `{ data: null }` when no snapshot exists yet (not an error).
 */
export async function getLatestFinanceSnapshot(): Promise<GetSnapshotResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestFinanceSnapshot] query error:', error.message);
    return { success: false, error: 'Failed to load snapshot. Please refresh.' };
  }

  return { success: true, data: (data?.data as SnapshotData) ?? null };
}
