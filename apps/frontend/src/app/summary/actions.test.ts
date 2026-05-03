import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getLatestMonthSummary, getMonthSummary } from './actions';

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

function chain(result: unknown) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

beforeEach(() => vi.resetAllMocks());

describe('summary actions', () => {
  it('returns null latest month when unauthenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    await expect(getLatestMonthSummary()).resolves.toBeNull();
  });

  it('returns latest summary month scoped to household', async () => {
    authOk();
    const summaryChain = chain({ data: { date: '2026-05-03' }, error: null });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return chain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'dailysummary') return summaryChain;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    await expect(getLatestMonthSummary()).resolves.toEqual({ year: 2026, month: 5 });
    expect(summaryChain.eq).toHaveBeenCalledWith('household_id', 'hh-1');
    expect(summaryChain.order).toHaveBeenCalledWith('date', { ascending: false });
  });

  it('returns month summaries ordered by date', async () => {
    authOk();
    const summaryChain = chain({
      data: [{ date: '2026-05-01', total_pnl: '12.5', winning_trades: 1, losing_trades: 0, win_rate: '1', avg_win: '12.5', avg_loss: '0' }],
      error: null,
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => table === 'household_members'
        ? chain({ data: { household_id: 'hh-1' }, error: null })
        : summaryChain),
    });

    const result = await getMonthSummary(2026, 5);
    expect(result[0].total_pnl).toBe(12.5);
    expect(summaryChain.gte).toHaveBeenCalledWith('date', '2026-05-01');
    expect(summaryChain.lt).toHaveBeenCalledWith('date', '2026-06-01');
  });
});
