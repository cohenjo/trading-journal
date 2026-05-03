/**
 * Unit tests for plan Server Actions.
 *
 * Verifies household scoping, auth guards, and CRUD persistence behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock infrastructure ──────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import {
  createPlan,
  deletePlan,
  getLatestPlan,
  getPlan,
  listPlans,
  updatePlan,
} from './actions';
import { createClient } from '@/lib/supabase/server';
import type { PlanData } from '@/components/Plan/types';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const HOUSEHOLD_ROW = { household_id: MOCK_HOUSEHOLD_ID };

const EMPTY_PLAN_DATA: PlanData = { items: [], milestones: [], settings: {} };

// ── Helpers ───────────────────────────────────────────────────────────────────

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

/** Builds a fluent chain that terminates with maybeSingle() returning `result`. */
function fluentChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function householdChain() {
  return fluentChain({ data: HOUSEHOLD_ROW, error: null });
}

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Retirement Plan',
    description: 'Long-term plan',
    data: EMPTY_PLAN_DATA,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-06-15T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Auth / access control ─────────────────────────────────────────────────────

describe('getLatestPlan — auth guards', () => {
  it('returns null when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getLatestPlan();
    expect(result).toBeNull();
  });

  it('returns null when user has no active household', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue(fluentChain({ data: null, error: null })),
    });

    const result = await getLatestPlan();
    expect(result).toBeNull();
  });
});

// ── Plan retrieval ────────────────────────────────────────────────────────────

describe('getLatestPlan — retrieval', () => {
  it('returns null when no plan exists', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return fluentChain({ data: null, error: null });
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestPlan();
    expect(result).toBeNull();
  });

  it('returns the latest plan ordered by updated_at desc', async () => {
    authOk();
    const row = planRow();
    const plansChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return plansChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestPlan();
    expect(result).not.toBeNull();
    expect(result?.id).toBe(7);
    expect(result?.name).toBe('Retirement Plan');
    expect(plansChain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(plansChain.limit).toHaveBeenCalledWith(1);
  });

  it('returns null and logs error on DB failure', async () => {
    authOk();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return fluentChain({ data: null, error: { message: 'RLS violation' } });
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestPlan();
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[getLatestPlan]'),
      expect.stringContaining('RLS violation'),
    );
    consoleSpy.mockRestore();
  });
});

describe('listPlans', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(listPlans()).resolves.toEqual([]);
  });

  it('lists household-scoped plans ordered by updated_at desc', async () => {
    authOk();
    const rows = [planRow({ id: 2 }), planRow({ id: 1 })];
    const listChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return listChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await listPlans();
    expect(result).toEqual(rows);
    expect(listChain.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(listChain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });
});

describe('getPlan', () => {
  it('returns null for invalid IDs', async () => {
    await expect(getPlan('not-a-number')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('gets a single household-scoped plan by ID', async () => {
    authOk();
    const row = planRow({ id: 42 });
    const getChain = fluentChain({ data: row, error: null });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return getChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getPlan(42);
    expect(result).toEqual(row);
    expect(getChain.eq).toHaveBeenCalledWith('id', 42);
    expect(getChain.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });
});

// ── Plan mutations ────────────────────────────────────────────────────────────

describe('createPlan', () => {
  it('returns an auth error when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await createPlan(EMPTY_PLAN_DATA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
  });

  it('creates a plan with session-derived household_id and default name', async () => {
    authOk();
    const row = planRow({ name: 'My Plan' });
    const singleMock = vi.fn().mockResolvedValue({ data: row, error: null });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return { insert: insertMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createPlan(EMPTY_PLAN_DATA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(row);
    expect(insertMock).toHaveBeenCalledWith({
      household_id: MOCK_HOUSEHOLD_ID,
      name: 'My Plan',
      description: null,
      data: EMPTY_PLAN_DATA,
    });
  });

  it('honors explicit name and description payload fields', async () => {
    authOk();
    const row = planRow({ name: 'Custom Plan', description: 'Scenario A' });
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return { insert: insertMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createPlan({
      name: '  Custom Plan  ',
      description: 'Scenario A',
      data: EMPTY_PLAN_DATA,
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Custom Plan', description: 'Scenario A' }),
    );
  });
});

describe('updatePlan', () => {
  it('validates IDs and empty patches before querying', async () => {
    await expect(updatePlan(0, { data: EMPTY_PLAN_DATA })).resolves.toEqual({
      ok: false,
      error: 'Invalid plan ID',
    });
    await expect(updatePlan(1, {})).resolves.toEqual({
      ok: false,
      error: 'No plan fields to update',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('updates only provided fields within the active household', async () => {
    authOk();
    const updated = planRow({ id: 7, name: 'New Name' });
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    const updateMock = vi.fn().mockReturnValue(updateChain);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return { update: updateMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await updatePlan(7, { name: '  New Name  ', data: EMPTY_PLAN_DATA });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(updated);
    expect(updateMock).toHaveBeenCalledWith({ name: 'New Name', data: EMPTY_PLAN_DATA });
    expect(updateChain.eq).toHaveBeenCalledWith('id', 7);
    expect(updateChain.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });
});

describe('deletePlan', () => {
  it('deletes by ID within the active household', async () => {
    authOk();
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 7 }, error: null }),
    };
    const deleteMock = vi.fn().mockReturnValue(deleteChain);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return { delete: deleteMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deletePlan(7);
    expect(result).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 7);
    expect(deleteChain.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });

  it('returns not found when no deleted row is returned', async () => {
    authOk();
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdChain();
        if (table === 'plans') return { delete: vi.fn().mockReturnValue(deleteChain) };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    await expect(deletePlan(7)).resolves.toEqual({ ok: false, error: 'Plan not found' });
  });
});
