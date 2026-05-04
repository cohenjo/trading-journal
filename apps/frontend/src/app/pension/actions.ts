'use server';

import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { enqueueComputeJob } from '@/lib/compute-jobs';
import type {
  PensionAccount,
  PensionAccountDetails,
  PensionDashboardResponse,
  PensionReportFile,
  PensionReportsResponse,
  PensionSnapshotAccount,
  PensionSnapshotSummary,
  PensionSeriesPoint,
} from '@/components/Pension/pensionTypes';
import type { Plan, PlanItem } from '@/components/Plan/types';

const PENSION_ID_PREFIX = 'pension::';
const SPOUSE_OWNER_ALIASES = new Set(['spouse', 'rita']);
const PENSION_UPLOAD_BUCKET = 'pension-uploads';
const MAX_PENSION_UPLOAD_BYTES = 10 * 1024 * 1024;
const EMPTY_DASHBOARD: PensionDashboardResponse = {
  status: 'success',
  history: [],
  projections: [],
  accounts: [],
  milestones: [],
};

interface FinanceSnapshotRow {
  date: string;
  household_id?: string;
  data: FinanceSnapshotData;
  net_worth?: number;
  total_assets?: number;
  total_liabilities?: number;
}

interface FinanceSnapshotData {
  items?: PensionFinanceItem[];
  total_savings?: number;
  total_investments?: number;
  total_assets?: number;
  total_liabilities?: number;
  [key: string]: unknown;
}

interface PensionFinanceItem {
  id?: string | number;
  category?: string;
  name?: string;
  value?: number | string | null;
  type?: string;
  owner?: string;
  currency?: string;
  details?: PensionAccountDetails | null;
  account_settings?: Partial<PlanItem['account_settings']> & Record<string, unknown>;
  [key: string]: unknown;
}

interface PlanRow {
  id: number | string;
  data: Plan['data'];
  updated_at?: string;
}

interface PensionMilestoneLike {
  owner?: string;
  name?: string;
  date?: string;
  type?: string;
  details?: { age?: number | string | null };
}

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

async function getAuthenticatedHouseholdId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;
  return resolveHouseholdId(user.id);
}

function sanitizeStorageFilename(filename: string): string {
  const sanitized = filename
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return sanitized || 'pension-report.pdf';
}

function validatePensionPdf(file: File): void {
  if (file.size > MAX_PENSION_UPLOAD_BYTES) {
    throw new Error('Pension PDF must be 10MB or smaller.');
  }
  const hasPdfName = file.name.toLocaleLowerCase().endsWith('.pdf');
  const hasPdfType = file.type === 'application/pdf' || file.type === '';
  if (!hasPdfName || !hasPdfType) {
    throw new Error('Only PDF pension reports can be uploaded.');
  }
}

/** Uploads a pension PDF to private Storage and enqueues the parser worker. */
export async function uploadPensionPdf(
  file: File,
  owner = 'You',
): Promise<{ jobId: string; storagePath: string }> {
  validatePensionPdf(file);
  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) throw new Error('Not authenticated');

  const storagePath = `${householdId}/${randomUUID()}-${sanitizeStorageFilename(file.name)}`;
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from(PENSION_UPLOAD_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload pension PDF.');
  }

  try {
    const jobId = await enqueueComputeJob('pension_pdf_parse', {
      household_id: householdId,
      storage_path: storagePath,
      owner,
      filename: file.name,
    });
    return { jobId, storagePath };
  } catch (error) {
    await supabase.storage.from(PENSION_UPLOAD_BUCKET).remove([storagePath]);
    throw error;
  }
}

function safeFloat(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function slugifyPensionPart(value: string): string {
  const normalized = safeText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/[\s/]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'unknown';
}

function buildPensionIdentity(
  owner: string,
  productName: string,
  fundName: string,
  accountNumber?: string | null,
): string {
  return [
    PENSION_ID_PREFIX.replace(/:+$/u, ''),
    slugifyPensionPart(owner),
    slugifyPensionPart(productName),
    accountNumber || slugifyPensionPart(fundName),
  ].join('::');
}

function getPensionIdentity(item: PensionFinanceItem | PlanItem): string | null {
  const candidate = item as PensionFinanceItem;
  const details = (candidate.details ?? {}) as PensionAccountDetails;
  const accountSettings = (candidate.account_settings ?? {}) as Record<string, unknown>;
  const rawId = safeText(candidate.id);

  if (rawId.startsWith(PENSION_ID_PREFIX)) return rawId;

  const storedIdentity = safeText(details.pension_identity) || safeText(accountSettings.pension_identity);
  if (storedIdentity) return storedIdentity;

  const owner = safeText(candidate.owner);
  const productName = safeText(details.pension_product);
  const fundName = safeText(details.pension_fund_name) || safeText(candidate.name);
  const accountNumber = safeText(details.account_number) || null;

  if (!owner || !productName) return null;
  return buildPensionIdentity(owner, productName, fundName, accountNumber);
}

function isPensionItem(item: PensionFinanceItem): boolean {
  return item.type === 'Pension';
}

function isPensionPlanItem(item: PlanItem): boolean {
  return item.account_settings?.type === 'Pension';
}

function recalculateSnapshot(snapshot: FinanceSnapshotRow): FinanceSnapshotRow {
  const items = Array.isArray(snapshot.data.items) ? snapshot.data.items : [];
  const totalSavings = items
    .filter((item) => item.category === 'Savings')
    .reduce((sum, item) => sum + safeFloat(item.value), 0);
  const totalInvestments = items
    .filter((item) => item.category === 'Investments')
    .reduce((sum, item) => sum + safeFloat(item.value), 0);
  const assetsCategoryTotal = items
    .filter((item) => item.category === 'Assets')
    .reduce((sum, item) => sum + safeFloat(item.value), 0);
  const totalLiabilities = items
    .filter((item) => item.category === 'Liabilities')
    .reduce((sum, item) => sum + safeFloat(item.value), 0);
  const totalAssets = totalSavings + totalInvestments + assetsCategoryTotal;

  return {
    ...snapshot,
    net_worth: totalAssets - totalLiabilities,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    data: {
      ...snapshot.data,
      items,
      total_savings: totalSavings,
      total_investments: totalInvestments,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
    },
  };
}

function latestActivePensions(snapshots: FinanceSnapshotRow[], plan: PlanRow | null): Map<string, PensionAccount> {
  const currentAccounts = new Map<string, PensionAccount>();
  if (snapshots.length === 0) return currentAccounts;

  const planByIdentity = new Map<string, PlanItem>();
  for (const item of plan?.data?.items ?? []) {
    if (!isPensionPlanItem(item)) continue;
    const identity = getPensionIdentity(item);
    if (identity) planByIdentity.set(identity, item);
  }

  const latestSnapshot = snapshots[snapshots.length - 1];
  for (const pensionItem of latestSnapshot.data.items ?? []) {
    if (!isPensionItem(pensionItem)) continue;
    const identity = getPensionIdentity(pensionItem);
    if (!identity) continue;

    const details: PensionAccountDetails = { ...(pensionItem.details ?? {}) };
    const planItem = planByIdentity.get(identity);
    if (planItem?.account_settings) {
      for (const field of ['starting_age', 'draw_income', 'divide_rate'] as const) {
        if (field in planItem.account_settings && !(field in details)) {
          details[field] = planItem.account_settings[field];
        }
      }
    }

    const displayName = safeText(details.pension_display_name) || safeText(pensionItem.name) || 'Unknown Pension';
    currentAccounts.set(identity, {
      id: identity,
      series_id: identity,
      owner: safeText(pensionItem.owner) || 'Unknown',
      name: displayName,
      product_name: safeText(details.pension_product) || 'Unknown Product',
      fund_name: safeText(details.pension_fund_name) || 'Unknown Pension Fund',
      display_name: displayName,
      value: safeFloat(pensionItem.value),
      details,
    });
  }

  return currentAccounts;
}

function isSpouseOwner(owner: string): boolean {
  return SPOUSE_OWNER_ALIASES.has(safeText(owner).toLocaleLowerCase());
}

function ownerBirthYear(settings: Record<string, unknown>, owner: string): number {
  const primaryUser = settings.primaryUser as Record<string, unknown> | undefined;
  const spouse = settings.spouse as Record<string, unknown> | undefined;
  const primaryBirthYear = Math.trunc(safeFloat(settings.birthYear ?? primaryUser?.birthYear ?? 1980));
  if (isSpouseOwner(owner)) return Math.trunc(safeFloat(spouse?.birthYear ?? primaryBirthYear));
  return primaryBirthYear;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildPensionDashboardPayload(snapshots: FinanceSnapshotRow[], plan: PlanRow | null): PensionDashboardResponse {
  const currentAccounts = latestActivePensions(snapshots, plan);
  const activeSeriesIds = [...currentAccounts.keys()];
  const history: PensionSeriesPoint[] = [];
  const historicalAccounts = new Map<string, number>();

  for (const snapshot of snapshots) {
    const point: PensionSeriesPoint = { date: snapshot.date.slice(0, 10) };
    for (const pensionItem of snapshot.data.items ?? []) {
      if (!isPensionItem(pensionItem)) continue;
      const seriesId = getPensionIdentity(pensionItem);
      if (!seriesId || !currentAccounts.has(seriesId)) continue;
      const value = safeFloat(pensionItem.value);
      point[seriesId] = value;
      historicalAccounts.set(seriesId, value);
    }
    for (const [seriesId, value] of historicalAccounts) {
      if (currentAccounts.has(seriesId) && point[seriesId] === undefined) point[seriesId] = value;
    }
    history.push(point);
  }

  const projections: PensionSeriesPoint[] = [];
  const milestones: PensionDashboardResponse['milestones'] = [];
  const retirementYears: Record<string, number> = { You: 2045, Rita: 2045, Spouse: 2045 };
  const userSettings = (plan?.data?.settings ?? {}) as Record<string, unknown>;

  for (const milestone of (plan?.data?.milestones ?? []) as PensionMilestoneLike[]) {
    const isRetirement = milestone.type === 'Retirement' || safeText(milestone.name).includes('Retirement');
    if (!isRetirement) continue;
    const owner = milestone.owner ?? 'You';
    if (milestone.date) {
      const year = Number.parseInt(milestone.date.slice(0, 4), 10);
      if (!Number.isFinite(year)) continue;
      retirementYears[owner] = year;
      milestones.push({ owner, name: milestone.name ?? 'Retirement', date: milestone.date, year });
    } else if (milestone.details?.age != null) {
      const year = ownerBirthYear(userSettings, owner) + Math.trunc(safeFloat(milestone.details.age));
      retirementYears[owner] = year;
      milestones.push({ owner, name: milestone.name ?? 'Retirement', date: `${year}-01-01`, year });
    }
  }

  if (history.length > 0 && activeSeriesIds.length > 0) {
    let currentDate = addMonths(new Date(`${history[history.length - 1].date}T00:00:00.000Z`), 1);
    const maxYear = Math.max(...Object.values(retirementYears));
    const monthlyRate = 0.0386 / 12;
    const currentProjectionValues = new Map<string, number>();

    for (const seriesId of activeSeriesIds) {
      currentProjectionValues.set(seriesId, safeFloat(history[history.length - 1][seriesId] ?? currentAccounts.get(seriesId)?.value));
    }

    while (currentDate.getUTCFullYear() <= maxYear) {
      const point: PensionSeriesPoint = { date: formatDate(currentDate) };
      for (const seriesId of activeSeriesIds) {
        const account = currentAccounts.get(seriesId);
        if (!account) continue;
        const owner = account.owner || 'You';
        const startingAge = Math.trunc(safeFloat(account.details?.starting_age ?? 67));
        const retirementYear = Math.max(
          ownerBirthYear(userSettings, owner) + startingAge,
          retirementYears[owner] ?? retirementYears.You ?? 2045,
        );
        const currentValue = currentProjectionValues.get(seriesId) ?? 0;
        if (currentDate.getUTCFullYear() <= retirementYear) {
          const deposits = safeFloat(account.details?.deposits ?? account.details?.monthly_contribution);
          currentProjectionValues.set(seriesId, currentValue * (1 + monthlyRate) + deposits);
        }
        point[seriesId] = currentProjectionValues.get(seriesId) ?? currentValue;
      }
      projections.push(point);
      currentDate = addMonths(currentDate, 1);
    }
  }

  return { status: 'success', history, projections, accounts: [...currentAccounts.values()], milestones };
}

function buildSnapshotSummary(snapshot: FinanceSnapshotRow): PensionSnapshotSummary | null {
  const pensionItems = (snapshot.data.items ?? []).filter(isPensionItem);
  if (pensionItems.length === 0) return null;
  const accounts: PensionSnapshotAccount[] = pensionItems.map((item) => {
    const details = item.details ?? {};
    return {
      id: getPensionIdentity(item) || safeText(item.id),
      owner: safeText(item.owner) || 'Unknown',
      name: safeText(details.pension_display_name) || safeText(item.name) || 'Unknown',
      value: safeFloat(item.value),
      deposits: safeFloat(details.deposits),
      earnings: safeFloat(details.earnings),
      fees: safeFloat(details.fees),
      insurance_fees: safeFloat(details.insurance_fees),
    };
  });
  return {
    date: snapshot.date.slice(0, 10),
    total_value: accounts.reduce((sum, account) => sum + account.value, 0),
    account_count: accounts.length,
    accounts,
  };
}

function removePensionIdentity<T extends PensionFinanceItem | PlanItem>(items: T[], pensionId: string): { items: T[]; changed: boolean } {
  const filteredItems = items.filter((item) => getPensionIdentity(item) !== pensionId);
  return { items: filteredItems, changed: filteredItems.length !== items.length };
}

async function fetchSnapshots(householdId: string): Promise<FinanceSnapshotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('date, household_id, data, net_worth, total_assets, total_liabilities')
    .eq('household_id', householdId)
    .order('date', { ascending: true });
  if (error) {
    console.error('[pension actions] snapshots query error:', error.message);
    return [];
  }
  return (data ?? []) as unknown as FinanceSnapshotRow[];
}

async function fetchLatestPlan(householdId: string): Promise<PlanRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plans')
    .select('id, data, updated_at')
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[pension actions] plan query error:', error.message);
    return null;
  }
  return (data as unknown as PlanRow | null) ?? null;
}

/** Lists pension history from household-scoped snapshots; PDF upload parsing remains on FastAPI. */
export async function listPensionReports(): Promise<PensionReportsResponse> {
  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return { status: 'success', reports: [], snapshots: [] };
  const snapshots = await fetchSnapshots(householdId);
  const snapshotSummaries = snapshots
    .map(buildSnapshotSummary)
    .filter((snapshot): snapshot is PensionSnapshotSummary => snapshot !== null);
  return { status: 'success', reports: [] satisfies PensionReportFile[], snapshots: snapshotSummaries };
}

/** Returns pension dashboard history, projections, active accounts, and milestones. */
export async function getPensionDashboard(): Promise<PensionDashboardResponse> {
  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return EMPTY_DASHBOARD;
  const [snapshots, plan] = await Promise.all([fetchSnapshots(householdId), fetchLatestPlan(householdId)]);
  return buildPensionDashboardPayload(snapshots, plan);
}

/** Removes a pension account from all household snapshots and the latest plan. */
export async function deletePensionReport(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const pensionId = typeof id === 'string' ? id.trim() : '';
  if (!pensionId) return { ok: false, error: 'Pension ID must not be empty' };
  const householdId = await getAuthenticatedHouseholdId();
  if (!householdId) return { ok: false, error: 'Not authenticated' };

  const supabase = await createClient();
  const snapshots = await fetchSnapshots(householdId);
  for (const snapshot of snapshots) {
    const currentItems = Array.isArray(snapshot.data.items) ? snapshot.data.items : [];
    const result = removePensionIdentity(currentItems, pensionId);
    if (!result.changed) continue;
    const updatedSnapshot = recalculateSnapshot({ ...snapshot, data: { ...snapshot.data, items: result.items } });
    const { error } = await supabase
      .from('finance_snapshots')
      .update({ data: updatedSnapshot.data, net_worth: updatedSnapshot.net_worth, total_assets: updatedSnapshot.total_assets, total_liabilities: updatedSnapshot.total_liabilities })
      .eq('household_id', householdId)
      .eq('date', snapshot.date);
    if (error) {
      console.error('[deletePensionReport] snapshot update error:', error.message);
      return { ok: false, error: 'Failed to delete pension from snapshots.' };
    }
  }

  const plan = await fetchLatestPlan(householdId);
  if (plan) {
    const result = removePensionIdentity(plan.data.items ?? [], pensionId);
    if (result.changed) {
      const { error } = await supabase
        .from('plans')
        .update({ data: { ...plan.data, items: result.items } })
        .eq('household_id', householdId)
        .eq('id', plan.id);
      if (error) {
        console.error('[deletePensionReport] plan update error:', error.message);
        return { ok: false, error: 'Failed to delete pension from plan.' };
      }
    }
  }
  return { ok: true };
}
