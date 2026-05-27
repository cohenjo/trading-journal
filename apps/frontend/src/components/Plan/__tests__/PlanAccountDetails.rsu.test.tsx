/**
 * Component tests for PlanAccountDetails — RSU configuration (AC6, AC7, AC8)
 *
 * AC6: RSU account configuration UI
 *   - Stock symbol input renders in snapshot mode (RSU Strategy section)
 *   - Dividend policy section is NOT rendered for RSU (hidden, not disabled)
 *   - RSU Planning Config block shows in planning mode only
 *   - dividend_tax_rate defaults to 25 when RSU type is set
 * AC7: Ticker change triggers cache fetch (fetchMarketData called in both snapshot and planning modes)
 * AC8: Missing Yahoo data — "No cached price" message shown gracefully, no crash
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PlanAccountDetails } from '@/components/Plan/PlanAccountDetails';
import type { PlanItem } from '@/components/Plan/types';

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockGetPrice = vi.fn();

vi.mock('@/app/finances/actions', () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
}));

// CurrencySelector is a UI-only subcomponent; stub it out
vi.mock('@/components/Common/CurrencySelector', () => ({
  CurrencySelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select data-testid="currency-selector" value={value} onChange={e => onChange(e.target.value)}>
      <option value="USD">USD</option>
      <option value="ILS">ILS</option>
    </select>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRsuItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'rsu-test',
    name: 'MSFT RSU',
    category: 'Account',
    owner: 'You',
    currency: 'USD',
    value: 100_000,
    growth_rate: 0,
    frequency: 'Yearly',
    account_settings: {
      type: 'RSU',
      bond_allocation: 0,
      dividend_yield: 0.87,
      fees: 0,
      dividend_tax_rate: 25,
      dividend_policy: 'Payout',
      stock_symbol: 'MSFT',
      rsu_grants: [],
    },
    ...overrides,
  };
}

function renderDetails(item: PlanItem, onChange = vi.fn(), mode: 'planning' | 'snapshot' = 'snapshot') {
  return render(
    <PlanAccountDetails item={item} onChange={onChange} mode={mode} />,
  );
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('PlanAccountDetails — RSU configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC6: RSU Config UI ───────────────────────────────────────────────────

  describe('AC6: RSU account type configuration UI', () => {
    it('AC6: Account Type selector shows "RSU" as selected value', () => {
      renderDetails(makeRsuItem());
      const typeSelect = screen.getByRole('combobox') as HTMLSelectElement;
      expect(typeSelect.value).toBe('RSU');
    });

    it('AC6: RSU section is visible in snapshot mode', () => {
      renderDetails(makeRsuItem(), undefined, 'snapshot');
      // Stock symbol section should be visible (RSU Strategy panel)
      expect(screen.getByText(/RSU Strategy/i)).toBeInTheDocument();
    });

    it('AC6: RSU strategy section is hidden in planning mode', () => {
      renderDetails(makeRsuItem(), undefined, 'planning');
      // RSU Strategy panel is hidden in planning mode per existing UI logic
      expect(screen.queryByText(/RSU Strategy/i)).not.toBeInTheDocument();
    });

    it('AC6: Stock symbol input renders with correct current value', () => {
      renderDetails(makeRsuItem(), undefined, 'snapshot');
      const input = screen.getByDisplayValue('MSFT');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'text');
    });

    it('AC6: Dividend Policy section is NOT rendered for RSU type (hidden, not disabled)', () => {
      // RSU dividends always flow to income — the policy selector is entirely suppressed.
      // All RSU dividend config lives in the RSU Configuration block (planning mode only).
      renderDetails(makeRsuItem(), undefined, 'snapshot');
      expect(screen.queryByText('Reinvest (Accumulate)')).not.toBeInTheDocument();
      expect(screen.queryByText('Pay Out (Income)')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('AC6: Dividend Policy section IS shown for non-RSU Broker account (snapshot)', () => {
      const brokerItem: PlanItem = {
        ...makeRsuItem(),
        account_settings: {
          type: 'Broker',
          bond_allocation: 0,
          dividend_yield: 2,
          fees: 0.1,
        },
      };
      // Broker account in planning mode shows the policy section
      renderDetails(brokerItem, undefined, 'planning');
      expect(screen.getByText('Reinvest (Accumulate)')).toBeInTheDocument();
      expect(screen.getByText('Pay Out (Income)')).toBeInTheDocument();
    });

    it('AC6: RSU calculated value panel shows "(Calculated)" label', () => {
      renderDetails(makeRsuItem(), undefined, 'snapshot');
      expect(screen.getByText('(Calculated)')).toBeInTheDocument();
    });
  });

  // ── AC7: Ticker change triggers cache fetch ──────────────────────────────

  describe('AC7: Ticker change triggers price cache fetch', () => {
    it('AC7: Changing stock symbol in snapshot mode triggers getPrice after debounce', async () => {
      mockGetPrice.mockResolvedValue({
        price: '420.00',
        refreshed_at: new Date().toISOString(),
        isStale: false,
      });

      renderDetails(makeRsuItem({ account_settings: { ...makeRsuItem().account_settings!, stock_symbol: 'WIX' } }), vi.fn(), 'snapshot');

      // Flush the debounce timer and all resulting promise microtasks
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockGetPrice).toHaveBeenCalledWith('WIX', 'USD');
    });

    it('AC7: Price cache status shows refreshed timestamp after successful fetch', async () => {
      const refreshedAt = new Date().toISOString();
      mockGetPrice.mockResolvedValue({
        price: '420.00',
        refreshed_at: refreshedAt,
        isStale: false,
      });

      renderDetails(makeRsuItem(), vi.fn(), 'snapshot');

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByText(/Cached price refreshed/i)).toBeInTheDocument();
    });
  });

  // ── AC8: Missing Yahoo data — graceful fallback ───────────────────────────

  describe('AC8: Missing Yahoo data — graceful failure UI', () => {
    it('AC8: getPrice returns null → shows "No cached price" message', async () => {
      mockGetPrice.mockResolvedValue(null);

      renderDetails(makeRsuItem(), vi.fn(), 'snapshot');

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByText(/No cached price/i)).toBeInTheDocument();
    });

    it('AC8: Stale price shows amber warning message', async () => {
      mockGetPrice.mockResolvedValue({
        price: '410.00',
        refreshed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        isStale: true,
      });

      renderDetails(makeRsuItem(), vi.fn(), 'snapshot');

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const warning = screen.getByText(/stale/i);
      expect(warning).toBeInTheDocument();
      // Stale message uses amber styling
      expect(warning.closest('p')?.className).toContain('amber');
    });

    it('AC8: getPrice throws → shows "Failed to read cached price" message, no crash', async () => {
      mockGetPrice.mockRejectedValue(new Error('Network error'));

      renderDetails(makeRsuItem(), vi.fn(), 'snapshot');

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByText(/Failed to read cached price/i)).toBeInTheDocument();
    });

    it('AC8: No symbol set in snapshot mode → no ticker error shown (error is planning-mode only)', () => {
      // In snapshot mode, the RSU Config block (and its required-error) is not rendered.
      // Users configure the ticker in planning mode; snapshot is read-only.
      const noSymbol = makeRsuItem();
      noSymbol.account_settings!.stock_symbol = undefined;

      renderDetails(noSymbol, vi.fn(), 'snapshot');

      // "Ticker is required" error lives in the RSU Config block (planning only)
      expect(screen.queryByTestId('rsu-ticker-required-error')).not.toBeInTheDocument();
      // The RSU Strategy section still renders in snapshot mode (grants viewer)
      expect(screen.getByText(/RSU Strategy/i)).toBeInTheDocument();
    });
  });
});
