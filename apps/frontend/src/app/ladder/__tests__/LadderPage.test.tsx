/**
 * Tests for the Bond Ladder page — Issue #356.
 * Verifies that bond_holdings data renders correctly in the Bond Holdings table.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bond, RungData, IncomePoint, DistributionRow } from '@/components/Ladder/types';

// --- mock server actions -------------------------------------------------------
vi.mock('../actions', () => ({
  getLadderOverview: vi.fn(),
  getLadderIncome: vi.fn(),
  addLadderBond: vi.fn(),
  updateLadderRung: vi.fn(),
}));

// next/navigation must be mocked before importing the page
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Ladder sub-components are not under test here; keep them lightweight
vi.mock('@/components/Ladder/Ladder', () => ({
  Ladder: () => <div data-testid="ladder-stub" />,
}));
vi.mock('@/components/Ladder/ExpectedIncomeChart', () => ({
  ExpectedIncomeChart: () => <div data-testid="income-chart-stub" />,
}));

import { getLadderOverview, getLadderIncome } from '../actions';
import LadderPageWrapper from '../page';

// ---------------------------------------------------------------------------

function makeRung(year: number): RungData {
  return {
    id: String(year),
    year,
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    target_amount: 20_000,
    current_amount: 0,
  };
}

function makeBond(id: string, opts: Partial<Bond> = {}): Bond {
  return {
    id,
    issuer: `Issuer ${id}`,
    currency: 'USD',
    face_value: 10_000,
    coupon_rate: 0.0425,       // stored as decimal (4.25 %)
    coupon_frequency: 'SEMI_ANNUAL',
    maturity_date: `2030-${id.padStart(2, '0')}-01`,
    rung_id: '2030',
    ...opts,
  };
}

/** Build 18 distinct bonds with sequential maturity dates. */
function make18Bonds(): Bond[] {
  return Array.from({ length: 18 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0');
    return makeBond(String(i + 1), { maturity_date: `2030-${month}-15` });
  });
}

const EMPTY_INCOME: { ok: true; data: { income_series: IncomePoint[]; distributions: DistributionRow[] } } = {
  ok: true,
  data: { income_series: [], distributions: [] },
};

// ---------------------------------------------------------------------------

describe('LadderPage — Bond Holdings table (#356)', () => {
  it('renders the Bond Holdings section heading', async () => {
    (getLadderOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { rungs: [makeRung(2030)], bonds: make18Bonds() },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INCOME);

    const { findByTestId } = render(<LadderPageWrapper />);
    const section = await findByTestId('bond-holdings-section');
    expect(section).toBeDefined();
    expect(section.textContent).toContain('Bond Holdings');
  });

  it('renders all 18 bonds in the table', async () => {
    (getLadderOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { rungs: [makeRung(2030)], bonds: make18Bonds() },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INCOME);

    render(<LadderPageWrapper />);
    const table = await screen.findByTestId('bond-holdings-table');
    const rows = within(table).getAllByRole('row');
    // 1 header row + 18 data rows
    expect(rows).toHaveLength(19);
  });

  it('sorts bonds by maturity_date ASC', async () => {
    const bonds = [
      makeBond('late', { maturity_date: '2035-12-01' }),
      makeBond('early', { maturity_date: '2029-01-01' }),
      makeBond('mid', { maturity_date: '2032-06-15' }),
    ];
    (getLadderOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { rungs: [makeRung(2030)], bonds },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INCOME);

    render(<LadderPageWrapper />);
    const table = await screen.findByTestId('bond-holdings-table');
    const rows = within(table).getAllByRole('row').slice(1); // skip header
    expect(rows[0].textContent).toContain('2029-01-01');
    expect(rows[1].textContent).toContain('2032-06-15');
    expect(rows[2].textContent).toContain('2035-12-01');
  });

  it('displays coupon_rate as percentage string, not raw decimal', async () => {
    const bond = makeBond('b1', { coupon_rate: 0.0425 });
    (getLadderOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { rungs: [makeRung(2030)], bonds: [bond] },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INCOME);

    render(<LadderPageWrapper />);
    const couponCell = await screen.findByTestId('coupon-b1');
    // Should show "4.25%" not "425.00%"
    expect(couponCell.textContent).toBe('4.25%');
  });

  it('shows empty state when there are no bonds', async () => {
    (getLadderOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { rungs: [makeRung(2030)], bonds: [] },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INCOME);

    render(<LadderPageWrapper />);
    const emptyState = await screen.findByTestId('bond-holdings-empty');
    expect(emptyState.textContent).toContain('No bonds yet');
    expect(screen.queryByTestId('bond-holdings-table')).toBeNull();
  });
});
