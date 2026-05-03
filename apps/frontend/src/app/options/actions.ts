'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface OptionsRecord {
  year: number;
  amount: number;
}

export type OptionsActionResult =
  | { ok: true; records: OptionsRecord[] }
  | { ok: false; error: string };

interface OptionsIncomeRow {
  year: number | string;
  amount: number | string;
}

/**
 * Looks up the calling user's active household_id from the authenticated
 * session. Caller input must never provide household scope.
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

async function requireHousehold(): Promise<{ ok: true; householdId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return { ok: false, error: 'No active household found for your account' };

  return { ok: true, householdId };
}

function toNumber(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionsRecord(row: OptionsIncomeRow): OptionsRecord {
  return {
    year: Number(row.year),
    amount: toNumber(row.amount),
  };
}

function validateOptionsRecords(payload: unknown): OptionsActionResult {
  if (!Array.isArray(payload)) {
    return { ok: false, error: 'Options records payload must be an array' };
  }

  const seenYears = new Set<number>();
  const records: OptionsRecord[] = [];

  for (const rawRecord of payload) {
    if (!rawRecord || typeof rawRecord !== 'object') {
      return { ok: false, error: 'Each options record must be an object' };
    }

    const record = rawRecord as Record<string, unknown>;
    const year = Number(record.year);
    const amount = Number(record.amount);

    if (!Number.isInteger(year) || year <= 0) {
      return { ok: false, error: 'Each options record year must be a positive integer' };
    }
    if (!Number.isFinite(amount)) {
      return { ok: false, error: 'Each options record amount must be a finite number' };
    }
    if (seenYears.has(year)) {
      return { ok: false, error: `Duplicate options record year: ${year}` };
    }

    seenYears.add(year);
    records.push({ year, amount });
  }

  records.sort((a, b) => a.year - b.year);
  return { ok: true, records };
}

/**
 * Lists historical options income rows for the authenticated user's household.
 * Returns an empty array when unauthenticated or when no active household exists.
 */
export async function listOptionsRecords(): Promise<OptionsRecord[]> {
  const household = await requireHousehold();
  if (!household.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('options_income')
    .select('year, amount')
    .eq('household_id', household.householdId)
    .order('year', { ascending: true });

  if (error) {
    console.error('[listOptionsRecords] query error:', error.message);
    return [];
  }

  return ((data ?? []) as OptionsIncomeRow[]).map(normalizeOptionsRecord);
}

/**
 * Replaces the authenticated household's options income history.
 *
 * This mirrors the legacy FastAPI POST /api/options behavior: the client sends
 * the full record set, which is upserted by year and any omitted years are
 * removed. `household_id` is session-derived and protected by Supabase RLS.
 */
export async function createOptionsRecord(payload: OptionsRecord[]): Promise<OptionsActionResult> {
  const validation = validateOptionsRecords(payload);
  if (!validation.ok) return validation;

  const household = await requireHousehold();
  if (!household.ok) return household;

  const supabase = await createClient();
  const rows = validation.records.map((record) => ({
    household_id: household.householdId,
    year: record.year,
    amount: record.amount,
  }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('options_income')
      .upsert(rows, { onConflict: 'household_id,year' });

    if (upsertError) {
      console.error('[createOptionsRecord] upsert error:', upsertError.message);
      return { ok: false, error: 'Failed to save options income. Please try again.' };
    }

    const retainedYears = validation.records.map((record) => record.year).join(',');
    const { error: deleteError } = await supabase
      .from('options_income')
      .delete()
      .eq('household_id', household.householdId)
      .not('year', 'in', `(${retainedYears})`);

    if (deleteError) {
      console.error('[createOptionsRecord] prune error:', deleteError.message);
      return { ok: false, error: 'Failed to prune old options income records. Please try again.' };
    }
  } else {
    const { error: deleteError } = await supabase
      .from('options_income')
      .delete()
      .eq('household_id', household.householdId);

    if (deleteError) {
      console.error('[createOptionsRecord] delete error:', deleteError.message);
      return { ok: false, error: 'Failed to clear options income. Please try again.' };
    }
  }

  revalidatePath('/options');
  return { ok: true, records: validation.records };
}
