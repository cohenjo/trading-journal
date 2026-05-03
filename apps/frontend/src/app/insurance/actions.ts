'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const INSURANCE_POLICY_TYPES = ['life', 'mortgage', 'health', 'disability', 'other'] as const;
const INSURANCE_POLICY_OWNERS = ['You', 'Partner'] as const;

export type InsurancePolicyType = (typeof INSURANCE_POLICY_TYPES)[number];
export type InsurancePolicyOwner = (typeof INSURANCE_POLICY_OWNERS)[number];

export interface InsurancePolicy {
  id: string;
  owner: InsurancePolicyOwner;
  type: InsurancePolicyType;
  provider: string;
  policy_number: string | null;
  sum_insured: string;
  monthly_premium: number | null;
  beneficiaries: string | null;
  expiry_date: string | null;
  website: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export type InsurancePolicyPayload = {
  owner: InsurancePolicyOwner;
  type: InsurancePolicyType;
  provider: string;
  policy_number?: string | null;
  sum_insured: string;
  monthly_premium?: number | null;
  beneficiaries?: string | null;
  expiry_date?: string | null;
  website?: string | null;
  notes?: string | null;
};

export type InsurancePolicyPatch = Partial<InsurancePolicyPayload>;

export type InsuranceActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

function isPolicyType(value: unknown): value is InsurancePolicyType {
  return typeof value === 'string' && INSURANCE_POLICY_TYPES.includes(value as InsurancePolicyType);
}

function isPolicyOwner(value: unknown): value is InsurancePolicyOwner {
  return typeof value === 'string' && INSURANCE_POLICY_OWNERS.includes(value as InsurancePolicyOwner);
}

function nullableTrim(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePremium(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const premium = Number(value);
  return Number.isFinite(premium) ? premium : null;
}

function normalizePolicy(row: Record<string, unknown>): InsurancePolicy {
  return {
    id: String(row.id),
    owner: isPolicyOwner(row.owner) ? row.owner : 'You',
    type: isPolicyType(row.type) ? row.type : 'other',
    provider: String(row.provider ?? ''),
    policy_number: nullableTrim(row.policy_number as string | null | undefined),
    sum_insured: String(row.sum_insured ?? ''),
    monthly_premium: normalizePremium(row.monthly_premium),
    beneficiaries: nullableTrim(row.beneficiaries as string | null | undefined),
    expiry_date: nullableTrim(row.expiry_date as string | null | undefined),
    website: nullableTrim(row.website as string | null | undefined),
    notes: nullableTrim(row.notes as string | null | undefined),
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function validatePolicyPayload(
  payload: InsurancePolicyPayload | InsurancePolicyPatch,
  options: { partial: boolean },
): InsuranceActionResult<Record<string, string | number | null>> {
  const row: Record<string, string | number | null> = {};

  if ((!options.partial || 'owner' in payload) && !isPolicyOwner(payload.owner)) {
    return { ok: false, error: 'Invalid owner' };
  }
  if (payload.owner !== undefined) row.owner = payload.owner;

  if ((!options.partial || 'type' in payload) && !isPolicyType(payload.type)) {
    return { ok: false, error: 'Invalid policy type' };
  }
  if (payload.type !== undefined) row.type = payload.type;

  if (!options.partial || 'provider' in payload) {
    const provider = typeof payload.provider === 'string' ? payload.provider.trim() : '';
    if (!provider) return { ok: false, error: 'Provider is required' };
    row.provider = provider;
  }

  if (!options.partial || 'sum_insured' in payload) {
    const sumInsured = typeof payload.sum_insured === 'string' ? payload.sum_insured.trim() : '';
    if (!sumInsured) return { ok: false, error: 'Sum insured is required' };
    row.sum_insured = sumInsured;
  }

  if ('policy_number' in payload) row.policy_number = nullableTrim(payload.policy_number);
  if ('monthly_premium' in payload) row.monthly_premium = normalizePremium(payload.monthly_premium);
  if ('beneficiaries' in payload) row.beneficiaries = nullableTrim(payload.beneficiaries);
  if ('expiry_date' in payload) row.expiry_date = nullableTrim(payload.expiry_date);
  if ('website' in payload) row.website = nullableTrim(payload.website);
  if ('notes' in payload) row.notes = nullableTrim(payload.notes);

  return { ok: true, data: row };
}

async function requireHousehold(): Promise<InsuranceActionResult<string>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return { ok: false, error: 'No active household found for your account' };

  return { ok: true, data: householdId };
}

function revalidateInsurancePages(): void {
  revalidatePath('/insurance');
  revalidatePath('/after-i-leave');
}

export async function listInsurancePolicies(
  owner?: InsurancePolicyOwner,
): Promise<InsurancePolicy[]> {
  const household = await requireHousehold();
  if (!household.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from('insurance_policies')
    .select('id, owner, type, provider, policy_number, sum_insured, monthly_premium, beneficiaries, expiry_date, website, notes, created_at, updated_at')
    .eq('household_id', household.data)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (owner) query = query.eq('owner', owner);

  const { data, error } = await query;
  if (error) {
    console.error('[listInsurancePolicies] query error:', error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => normalizePolicy(row));
}

export async function createInsurancePolicy(
  payload: InsurancePolicyPayload,
): Promise<InsuranceActionResult<InsurancePolicy>> {
  const household = await requireHousehold();
  if (!household.ok) return household;

  const validation = validatePolicyPayload(payload, { partial: false });
  if (!validation.ok) return validation;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('insurance_policies')
    .insert({ ...validation.data, household_id: household.data })
    .select('id, owner, type, provider, policy_number, sum_insured, monthly_premium, beneficiaries, expiry_date, website, notes, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('[createInsurancePolicy] insert error:', error?.message);
    return { ok: false, error: 'Failed to create insurance policy. Please try again.' };
  }

  revalidateInsurancePages();
  return { ok: true, data: normalizePolicy(data as Record<string, unknown>) };
}

export async function updateInsurancePolicy(
  id: string,
  patch: InsurancePolicyPatch,
): Promise<InsuranceActionResult<InsurancePolicy>> {
  const policyId = typeof id === 'string' ? id.trim() : '';
  if (!policyId) return { ok: false, error: 'Policy id is required' };

  const household = await requireHousehold();
  if (!household.ok) return household;

  const validation = validatePolicyPayload(patch, { partial: true });
  if (!validation.ok) return validation;
  if (Object.keys(validation.data).length === 0) {
    return { ok: false, error: 'No changes provided' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('insurance_policies')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', policyId)
    .eq('household_id', household.data)
    .is('deleted_at', null)
    .select('id, owner, type, provider, policy_number, sum_insured, monthly_premium, beneficiaries, expiry_date, website, notes, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[updateInsurancePolicy] update error:', error.message);
    return { ok: false, error: 'Failed to update insurance policy. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Policy not found' };

  revalidateInsurancePages();
  return { ok: true, data: normalizePolicy(data as Record<string, unknown>) };
}

export async function deleteInsurancePolicy(
  id: string,
): Promise<InsuranceActionResult<{ id: string }>> {
  const policyId = typeof id === 'string' ? id.trim() : '';
  if (!policyId) return { ok: false, error: 'Policy id is required' };

  const household = await requireHousehold();
  if (!household.ok) return household;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('insurance_policies')
    .delete()
    .eq('id', policyId)
    .eq('household_id', household.data)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[deleteInsurancePolicy] delete error:', error.message);
    return { ok: false, error: 'Failed to delete insurance policy. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Policy not found' };

  revalidateInsurancePages();
  return { ok: true, data: { id: policyId } };
}
