import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockMaybeSingleHousehold = vi.fn();
const mockSnapshotOrder = vi.fn();
const mockPlanMaybeSingle = vi.fn();
const mockSnapshotUpdateDateEq = vi.fn();
const mockPlanUpdateIdEq = vi.fn();
const mockStorageUpload = vi.fn();
const mockStorageRemove = vi.fn();
const mockComputeInsert = vi.fn();
const mockComputeInsertSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { deletePensionReport, getPensionDashboard, listPensionReports, uploadPensionPdf } from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const PENSION_ID = 'pension::you::makif::12345';

function makeSupabaseMock() {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'household_members') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingleHousehold };
      }
      if (table === 'finance_snapshots') {
        return {
          select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), order: mockSnapshotOrder })),
          update: vi.fn(() => ({ eq: vi.fn().mockReturnThis().mockImplementationOnce(function firstEq(this: unknown) { return this; }).mockImplementationOnce(mockSnapshotUpdateDateEq) })),
        };
      }
      if (table === 'plans') {
        return {
          select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: mockPlanMaybeSingle })),
          update: vi.fn(() => ({ eq: vi.fn().mockReturnThis().mockImplementationOnce(function firstEq(this: unknown) { return this; }).mockImplementationOnce(mockPlanUpdateIdEq) })),
        };
      }
      if (table === 'compute_jobs') {
        const computeChain = {
          insert: mockComputeInsert,
          select: vi.fn().mockReturnThis(),
          single: mockComputeInsertSingle,
        };
        mockComputeInsert.mockReturnValue(computeChain);
        return computeChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({ upload: mockStorageUpload, remove: mockStorageRemove })),
    },
  };
}

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
  mockMaybeSingleHousehold.mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
}

function pensionSnapshot(date: string, value: number, extraItems: Array<Record<string, unknown>> = []) {
  return {
    date,
    household_id: MOCK_HOUSEHOLD_ID,
    net_worth: value,
    total_assets: value,
    total_liabilities: 0,
    data: {
      items: [
        {
          id: PENSION_ID,
          category: 'Investments',
          name: 'Makif — Fund',
          value,
          type: 'Pension',
          owner: 'You',
          currency: 'ILS',
          details: {
            pension_identity: PENSION_ID,
            pension_product: 'Makif',
            pension_fund_name: 'Fund',
            pension_display_name: 'Makif — Fund',
            deposits: 1000,
            earnings: 50,
            fees: 5,
            insurance_fees: 2,
          },
        },
        ...extraItems,
      ],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabaseMock());
  mockPlanMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockSnapshotUpdateDateEq.mockResolvedValue({ error: null });
  mockPlanUpdateIdEq.mockResolvedValue({ error: null });
  mockStorageUpload.mockResolvedValue({ error: null });
  mockStorageRemove.mockResolvedValue({ error: null });
  mockComputeInsertSingle.mockResolvedValue({ data: { id: 'job-123' }, error: null });
});

describe('uploadPensionPdf', () => {
  it('uploads a PDF under the household prefix and enqueues the parser job', async () => {
    authOk();
    const file = new File(['%PDF-1.7'], 'quarterly report.pdf', { type: 'application/pdf' });

    await expect(uploadPensionPdf(file, 'Rita')).resolves.toMatchObject({ jobId: 'job-123' });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${MOCK_HOUSEHOLD_ID}/.+-quarterly-report\\.pdf$`)),
      file,
      expect.objectContaining({ contentType: 'application/pdf', upsert: false }),
    );
    expect(mockComputeInsert).toHaveBeenCalledWith({
      household_id: MOCK_HOUSEHOLD_ID,
      job_type: 'pension_pdf_parse',
      payload: expect.objectContaining({
        household_id: MOCK_HOUSEHOLD_ID,
        owner: 'Rita',
        filename: 'quarterly report.pdf',
        storage_path: expect.stringMatching(new RegExp(`^${MOCK_HOUSEHOLD_ID}/`)),
      }),
    });
  });

  it('rejects non-PDF uploads before Storage is called', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await expect(uploadPensionPdf(file)).rejects.toThrow('Only PDF pension reports can be uploaded.');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});

describe('listPensionReports', () => {
  it('returns empty data when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(listPensionReports()).resolves.toEqual({ status: 'success', reports: [], snapshots: [] });
  });

  it('builds snapshot summaries from pension items only', async () => {
    authOk();
    mockSnapshotOrder.mockResolvedValue({ data: [pensionSnapshot('2026-01-31', 100_000, [{ id: 'cash', category: 'Savings', type: 'Cash', value: 10_000 }])], error: null });
    const result = await listPensionReports();
    expect(result.reports).toEqual([]);
    expect(result.snapshots[0]).toMatchObject({ date: '2026-01-31', total_value: 100_000, account_count: 1 });
    expect(result.snapshots[0].accounts[0]).toMatchObject({ id: PENSION_ID, owner: 'You', deposits: 1000 });
  });
});

describe('getPensionDashboard', () => {
  it('returns dashboard history and active accounts from snapshots', async () => {
    authOk();
    mockSnapshotOrder.mockResolvedValue({ data: [pensionSnapshot('2026-01-31', 100_000), pensionSnapshot('2026-02-28', 102_000)], error: null });
    mockPlanMaybeSingle.mockResolvedValue({ data: { id: 1, data: { items: [{ id: PENSION_ID, name: 'Makif — Fund', category: 'Asset', owner: 'You', value: 102_000, growth_rate: 0.05, frequency: 'Yearly', account_settings: { type: 'Pension', pension_identity: PENSION_ID, starting_age: 67, draw_income: true, divide_rate: 200 }, details: { pension_identity: PENSION_ID } }], milestones: [{ owner: 'You', name: 'Retirement', date: '2040-01-01', type: 'Retirement' }], settings: { birthYear: 1980 } } }, error: null });
    const result = await getPensionDashboard();
    expect(result.history[1][PENSION_ID]).toBe(102_000);
    expect(result.accounts[0]).toMatchObject({ id: PENSION_ID, product_name: 'Makif', fund_name: 'Fund' });
    expect(result.accounts[0]?.details?.draw_income).toBe(true);
    expect(result.milestones[0]).toMatchObject({ owner: 'You', year: 2040 });
    expect(result.projections.length).toBeGreaterThan(0);
  });
});

describe('deletePensionReport', () => {
  it('removes the pension from snapshots and the latest plan', async () => {
    authOk();
    mockSnapshotOrder.mockResolvedValue({ data: [pensionSnapshot('2026-01-31', 100_000, [{ id: 'cash', category: 'Savings', type: 'Cash', value: 20_000 }])], error: null });
    mockPlanMaybeSingle.mockResolvedValue({ data: { id: 7, data: { items: [{ id: PENSION_ID, name: 'Makif — Fund', category: 'Asset', owner: 'You', value: 100_000, growth_rate: 0.05, frequency: 'Yearly', account_settings: { type: 'Pension', pension_identity: PENSION_ID }, details: { pension_identity: PENSION_ID } }, { id: 'rent', name: 'Rent', category: 'Expense', owner: 'You', value: 1000, growth_rate: 0, frequency: 'Monthly' }], milestones: [], settings: {} } }, error: null });
    await expect(deletePensionReport(PENSION_ID)).resolves.toEqual({ ok: true });
    expect(mockSnapshotUpdateDateEq).toHaveBeenCalledWith('date', '2026-01-31');
    expect(mockPlanUpdateIdEq).toHaveBeenCalledWith('id', 7);
  });

  it('rejects an empty id without querying snapshots', async () => {
    const result = await deletePensionReport('   ');
    expect(result.ok).toBe(false);
    expect(mockSnapshotOrder).not.toHaveBeenCalled();
  });
});
