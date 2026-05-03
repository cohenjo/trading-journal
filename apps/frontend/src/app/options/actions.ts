'use server';

import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface OptionsRecord {
  year: number;
  amount: number;
}

export interface OptionsProjectionInput {
  growth_rate: number;
  cutoff_year: number;
  final_year: number;
}

export interface OptionsProjectionPoint {
  year: number;
  amount: number;
  type: 'historical' | 'projected';
}

export interface OptionsProjectionResult {
  data: OptionsProjectionPoint[];
}

export type OptionsActionResult =
  | { ok: true; records: OptionsRecord[] }
  | { ok: false; error: string };

interface OptionsIncomeRow {
  year: number | string;
  amount: number | string;
}

interface OptionsProjectionRecord {
  year: number;
  amount: Decimal;
}

const MIN_PROJECTION_YEAR = 1900;
const MAX_PROJECTION_YEAR = 2200;
const MAX_PROJECTION_YEARS = 200;
const MIN_GROWTH_RATE = -1;
const MAX_GROWTH_RATE = 10;

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

function normalizeProjectionRecord(row: OptionsIncomeRow): OptionsProjectionRecord {
  return {
    year: Number(row.year),
    amount: new Decimal(String(row.amount)),
  };
}

function assertValidProjectionInput(input: OptionsProjectionInput): void {
  if (!Number.isFinite(input.growth_rate)) {
    throw new Error('Options projection growth_rate must be finite');
  }
  if (input.growth_rate <= MIN_GROWTH_RATE || input.growth_rate > MAX_GROWTH_RATE) {
    throw new Error('Options projection growth_rate is outside the supported range');
  }
  if (!Number.isInteger(input.cutoff_year) || !Number.isInteger(input.final_year)) {
    throw new Error('Options projection years must be integers');
  }
  if (
    input.cutoff_year < MIN_PROJECTION_YEAR ||
    input.cutoff_year > MAX_PROJECTION_YEAR ||
    input.final_year < MIN_PROJECTION_YEAR ||
    input.final_year > MAX_PROJECTION_YEAR
  ) {
    throw new Error('Options projection years are outside the supported range');
  }
}

function decimalToResponseNumber(value: Decimal): number {
  return value.toDecimalPlaces(10).toNumber();
}

function calculateOptionsProjection(
  historicalRecords: OptionsProjectionRecord[],
  input: OptionsProjectionInput,
): OptionsProjectionResult {
  assertValidProjectionInput(input);

  if (historicalRecords.length === 0) return { data: [] };

  const historical = [...historicalRecords].sort((a, b) => a.year - b.year);
  const total = historical.reduce((sum, record) => sum.plus(record.amount), new Decimal(0));
  const baseAmount = total.dividedBy(historical.length);

  const historicalPoints: OptionsProjectionPoint[] = historical.map((record) => ({
    year: record.year,
    amount: decimalToResponseNumber(record.amount),
    type: 'historical',
  }));

  if (baseAmount.lessThanOrEqualTo(0)) return { data: historicalPoints };

  const lastHistoricalYear = historical[historical.length - 1]?.year;
  if (lastHistoricalYear === undefined || input.final_year <= lastHistoricalYear) {
    return { data: historicalPoints };
  }
  if (input.final_year - lastHistoricalYear > MAX_PROJECTION_YEARS) {
    throw new Error('Options projection horizon exceeds the supported range');
  }

  const points: OptionsProjectionPoint[] = [...historicalPoints];
  const growthFactor = new Decimal(1).plus(input.growth_rate);
  let cutoffValue: Decimal | null = null;

  for (let year = lastHistoricalYear + 1; year <= input.final_year; year += 1) {
    let currentAmount: Decimal;

    if (year <= input.cutoff_year) {
      const yearsFromLastHistorical = year - lastHistoricalYear;
      currentAmount = baseAmount.times(growthFactor.pow(yearsFromLastHistorical));
      if (year === input.cutoff_year) cutoffValue = currentAmount;
    } else {
      cutoffValue ??= baseAmount;
      currentAmount = cutoffValue;
    }

    points.push({
      year,
      amount: decimalToResponseNumber(currentAmount),
      type: 'projected',
    });
  }

  return { data: points };
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
 * Projects options income for the authenticated household using the legacy
 * FastAPI formula: average historical income compounds until cutoff_year, then
 * stays flat through final_year. Monetary math stays in Decimal until response
 * serialization to match the prior JSON shape consumed by the UI.
 */
export async function getOptionsProjection(input: OptionsProjectionInput): Promise<OptionsProjectionResult> {
  const household = await requireHousehold();
  if (!household.ok) return { data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('options_income')
    .select('year, amount')
    .eq('household_id', household.householdId)
    .order('year', { ascending: true });

  if (error) {
    console.error('[getOptionsProjection] query error:', error.message);
    return { data: [] };
  }

  const historical = ((data ?? []) as OptionsIncomeRow[]).map(normalizeProjectionRecord);
  return calculateOptionsProjection(historical, input);
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
