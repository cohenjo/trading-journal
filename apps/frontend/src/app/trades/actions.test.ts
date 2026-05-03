import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const { mockRevalidatePath } = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createTrade } from './actions';

function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('createTrade', () => {
  it('rejects invalid manual trade payloads', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => table === 'household_members' ? chain({ data: { household_id: 'hh-1' }, error: null }) : chain({ data: null, error: null })),
    });

    const result = await createTrade({ symbol: '', side: 'buy' });
    expect(result.ok).toBe(false);
  });

  it('inserts manual trades with session household and recalculates summary', async () => {
    const manualInsert = chain({ data: { id: 1, symbol: 'SPY' }, error: null });
    const summaryUpsert = chain({ data: null, error: null });
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return chain({ data: { household_id: 'hh-1' }, error: null });
      if (table === 'manualtrade' && from.mock.calls.filter(([t]) => t === 'manualtrade').length === 1) return manualInsert;
      if (table === 'manualtrade') return chain({ data: [{ pnl: '100' }], error: null });
      if (table === 'trade') return chain({ data: [], error: null });
      if (table === 'dailysummary') return summaryUpsert;
      throw new Error(`Unexpected table ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    const result = await createTrade({ timestamp: '2026-05-03T10:00:00Z', symbol: 'spy', side: 'buy', size: 1, entry_price: 10, exit_price: 11, pnl: 100 });

    expect(result.ok).toBe(true);
    expect(manualInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ household_id: 'hh-1', symbol: 'SPY' }));
    expect(summaryUpsert.upsert).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-05-03', total_pnl: 100 }), { onConflict: 'date' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/day/2026-05-03');
  });
});
