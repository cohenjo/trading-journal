import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getOptionsMonthlyMetrics, getUserAccountsWithOptionsEnabled } from './actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

function householdQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
});

describe('options dashboard actions', () => {
  it('returns empty monthly metrics when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    await expect(getOptionsMonthlyMetrics(2026)).resolves.toEqual([]);
  });

  it('reads cooked monthly metrics without touching legacy options_income', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        account_id: 'DU123',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        cash_flow_total: '2700.00',
        realized_pnl_total: '1000.00',
        cash_flow_cumulative: '2700.00',
        realized_pnl_cumulative: '1000.00',
        variance_gap: '1700.00',
        variance_gap_cumulative: '1700.00',
        trade_count: 4,
        roll_count: 1,
        roll_positive_count: 0,
        roll_negative_count: 1,
        roll_neutral_count: 0,
        roll_efficiency_pct: '0.00',
        last_computed_at: '2026-03-31T00:00:00Z',
      }],
      error: null,
    });
    const metricsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order,
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_dashboard_monthly') return metricsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    const result = await getOptionsMonthlyMetrics(2026, 'DU123');

    expect(result).toEqual([{ accountId: 'DU123', periodStart: '2026-03-01', periodEnd: '2026-03-31', cashFlow: '2700.00', realizedPnl: '1000.00', cumulativeCashFlow: '2700.00', cumulativeRealizedPnl: '1000.00', varianceGap: '1700.00', cumulativeVarianceGap: '1700.00', tradeCount: 4, rollCount: 1, rollPositiveCount: 0, rollNegativeCount: 1, rollNeutralCount: 0, rollEfficiencyPct: '0.00', lastComputedAt: '2026-03-31T00:00:00Z' }]);
    expect(from).not.toHaveBeenCalledWith('options_income');
    expect(metricsQuery.eq).toHaveBeenCalledWith('account_id', 'DU123');
  });

  it('lists options-enabled trading accounts for the filter', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 7, name: 'IBKR Main', account_type: 'IBKR', account_id: 'DU777', linked_account_id: null }],
      error: null,
    });
    const accountsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order,
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'trading_account_config') return accountsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    await expect(getUserAccountsWithOptionsEnabled()).resolves.toEqual([{ id: '7', label: 'IBKR Main (DU777)', accountId: 'DU777', accountType: 'IBKR' }]);
    expect(accountsQuery.eq).toHaveBeenCalledWith('compute_options_income', true);
  });
});
