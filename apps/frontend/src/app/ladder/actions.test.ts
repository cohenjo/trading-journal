import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { addLadderBond, getLadderOverview, updateLadderRung } from './actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
});

function householdQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
  };
}

/** bond_holdings query chain used by fetchHoldingBonds — returns empty list by default. */
function holdingsQuery(rows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
}

describe('ladder Server Actions', () => {
  it('loads overview using aggregate bond face values for rung current amounts', async () => {
    const rungs = [{ id: '2037', year: 2037, start_date: '2037-01-01', end_date: '2037-12-31', target_amount: 20_000, current_amount: 0 }];
    const bonds = [{ id: 'B1', ticker: null, issuer: 'Bond 1', currency: 'USD', face_value: 100_000, coupon_rate: 0.04, coupon_frequency: 'SEMI_ANNUAL', maturity_date: '2037-06-30', rung_id: '2037' }];
    let bondsCall = 0;
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'bond_holdings') return holdingsQuery();
        if (table === 'ladder_rungs') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: rungs, error: null }) };
        if (table === 'ladder_bonds') {
          bondsCall += 1;
          if (bondsCall === 1) return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: bonds, error: null }) };
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ rung_id: '2037', current_amount: '100000' }], error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
    const result = await getLadderOverview();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rungs.find((rung) => rung.id === '2037')?.current_amount).toBe(100_000);
  });

  it('adds a bond scoped to the authenticated household and synthesized rung', async () => {
    const rungUpsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'bond-2037-test-issuer', ticker: null, issuer: 'Test Issuer', currency: 'USD', face_value: 2_500, coupon_rate: 0.05, coupon_frequency: 'ANNUAL', maturity_date: '2037-12-31', rung_id: '2037' }, error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_rungs') return { upsert: rungUpsert };
        if (table === 'ladder_bonds') return { insert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
    const result = await addLadderBond({ issuer: 'Test Issuer', currency: 'USD', face_value: 2_500, coupon_rate: 0.05, coupon_frequency: 'ANNUAL', issue_date: '2036-01-01', maturity_date: '2037-12-31' });
    expect(result.ok).toBe(true);
    expect(rungUpsert).toHaveBeenCalledWith(expect.objectContaining({ household_id: MOCK_HOUSEHOLD_ID, id: '2037' }), expect.objectContaining({ onConflict: 'household_id,id', ignoreDuplicates: true }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ household_id: MOCK_HOUSEHOLD_ID, id: 'bond-2037-test-issuer', rung_id: '2037' }));
  });

  it('fans out aggregate rung updates across the selected years', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_rungs') return { upsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
    const result = await updateLadderRung('3Y-2034', { target_amount: 90_000 });
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: '2034', target_amount: 30_000 }), expect.objectContaining({ onConflict: 'household_id,id' }));
    expect(upsert).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: '2036', target_amount: 30_000 }), expect.objectContaining({ onConflict: 'household_id,id' }));
  });
});
