/**
 * Unit tests for the plan/latest Server Action (getLatestPlan).
 *
 * Verifies:
 *  1. Returns the latest plan ordered by updated_at desc.
 *  2. Returns null when no plan exists (not an error).
 *  3. Returns null when not authenticated.
 *  4. Returns null when user has no active household.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock infrastructure ──────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { getLatestPlan } from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

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
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'plans') return fluentChain({ data: null, error: null });
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestPlan();
    expect(result).toBeNull();
  });

  it('returns the latest plan ordered by updated_at desc', async () => {
    authOk();

    const planRow = {
      id: 7,
      name: 'Retirement Plan',
      description: 'Long-term plan',
      data: { items: [], milestones: [], settings: {} },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-06-15T12:00:00Z',
    };

    const plansChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: planRow, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'plans') return plansChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestPlan();
    expect(result).not.toBeNull();
    expect(result?.id).toBe(7);
    expect(result?.name).toBe('Retirement Plan');
    // Verify ordering
    expect(plansChain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(plansChain.limit).toHaveBeenCalledWith(1);
  });

  it('returns null and logs error on DB failure', async () => {
    authOk();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
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
