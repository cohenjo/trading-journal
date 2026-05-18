/**
 * Cash Flow page — component tests
 *
 * Covers:
 *   1. Default render — yearly mode active (aria-pressed="true")
 *   2. Click monthly toggle — monthly pill becomes active, summary values ÷12
 *   3. Toggle persists across year-slider change
 *   4. A11y — both toggle buttons have aria-pressed and are keyboard-focusable
 *   5. Empty plan — no-plan UI rendered, toggle is not present
 *
 * Mock strategy:
 *   - All server actions mocked to resolve immediately with canned data
 *   - CashFlowSankey mocked to a lightweight stub
 *   - useSettings mocked to return USD + birthYear 1990
 *   - next/link mocked to plain <a>
 *   - Fake timers used to control the 300 ms simulation debounce
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import CashFlowPage from '../page';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/app/plan/actions', () => ({
  getLatestPlan: vi.fn(),
  runPlanSimulation: vi.fn(),
}));

vi.mock('@/app/finances/actions', () => ({
  getLatestFinanceSnapshot: vi.fn(),
}));

vi.mock('@/app/dividends/actions', () => ({
  getDividendSummary: vi.fn(),
}));

vi.mock('@/app/ladder/actions', () => ({
  getLadderIncome: vi.fn(),
}));

vi.mock('@/app/settings/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      mainCurrency: 'USD',
      primaryUser: { birthYear: 1990 },
      spouse: null,
    },
  }),
}));

vi.mock('@/components/CashFlow/CashFlowSankey', () => ({
  CashFlowSankey: () => <div data-testid="sankey-mock" />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Helpers & fixtures ────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

const CANNED_PLAN = {
  id: 1,
  name: 'Test Plan',
  data: { items: [], milestones: [], settings: {} },
};

const CANNED_PROJECTION = [
  {
    year: CURRENT_YEAR,
    age: CURRENT_YEAR - 1990,
    income: 120_000,
    expenses: 36_000,
    tax_paid: 12_000,
    withdrawals: 0,
    net_worth: 500_000,
    liquid_assets: 200_000,
    liquid_net_worth: 200_000,
    income_details: [{ name: 'Salary', type: 'income', value: 120_000 }],
    expense_details: [{ name: 'Living', type: 'Living', value: 36_000 }],
    savings_details: [],
    withdrawal_details: [],
    total_dividend_income: 0,
    accounts: [],
    milestones_hit: [],
  },
];

// Lazily import mocked functions so vi.fn() instances are accessible
import { getLatestPlan, runPlanSimulation } from '@/app/plan/actions';
import { getLatestFinanceSnapshot } from '@/app/finances/actions';
import { getDividendSummary } from '@/app/dividends/actions';
import { getLadderIncome } from '@/app/ladder/actions';

async function mountPage() {
  render(<CashFlowPage />);
  // Wait for the initial data load to complete (loading spinner disappears)
  await waitFor(
    () => expect(screen.queryByText(/loading cash flow/i)).not.toBeInTheDocument(),
    { timeout: 3000 },
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CashFlowPage — monthly/yearly toggle and display mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getLatestPlan as ReturnType<typeof vi.fn>).mockResolvedValue(CANNED_PLAN);
    (getLatestFinanceSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { items: [] } });
    (getDividendSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      total_forward_annual: 5_000,
      by_account: { ibkr: 5_000, schwab: 0, ira: 0 },
    });
    (getLadderIncome as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    (runPlanSimulation as ReturnType<typeof vi.fn>).mockResolvedValue(CANNED_PROJECTION);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Default render — yearly mode ────────────────────────────────────────

  it('renders with yearly mode active by default (aria-pressed="true" on Yearly button)', async () => {
    await mountPage();

    const yearlyBtn = screen.getByRole('button', { name: /yearly/i });
    const monthlyBtn = screen.getByRole('button', { name: /monthly/i });

    expect(yearlyBtn).toBeInTheDocument();
    expect(monthlyBtn).toBeInTheDocument();
    expect(yearlyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // ── 2. Click monthly toggle — values divide by 12 ─────────────────────────

  it('switching to monthly divides summary card values by 12', async () => {
    await mountPage();

    // Wait for projection to load (300 ms debounce fires, runPlanSimulation resolves)
    // Yearly total inflow = income ($120K) + withdrawals ($0) = $120K
    await waitFor(
      () => expect(screen.getByText(/\$120,000/)).toBeInTheDocument(),
      { timeout: 2000 },
    );

    const monthlyBtn = screen.getByRole('button', { name: /monthly/i });
    fireEvent.click(monthlyBtn);

    // Monthly value = $120K / 12 = $10K
    expect(screen.getByText(/\$10,000/)).toBeInTheDocument();

    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /yearly/i })).toHaveAttribute('aria-pressed', 'false');
  });

  // ── 3. Toggle persists across year-slider change ───────────────────────────

  it('monthly mode persists after moving the year slider', async () => {
    await mountPage();

    // Switch to monthly
    const monthlyBtn = screen.getByRole('button', { name: /monthly/i });
    fireEvent.click(monthlyBtn);
    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'true');

    // Move the year slider
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: String(CURRENT_YEAR + 1) } });

    // Monthly should still be active
    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /yearly/i })).toHaveAttribute('aria-pressed', 'false');
  });

  // ── 4. A11y — aria-pressed and keyboard-focusable ─────────────────────────

  it('toggle buttons have aria-pressed and tabIndex (keyboard-focusable)', async () => {
    await mountPage();

    const group = screen.getByRole('group', { name: /display mode/i });
    expect(group).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: /(yearly|monthly)/i });
    expect(buttons).toHaveLength(2);

    buttons.forEach(btn => {
      expect(btn).toHaveAttribute('aria-pressed');
      // Default tabIndex for buttons is 0 (focusable); tabIndex must not be -1
      expect(btn.tabIndex).not.toBe(-1);
    });
  });

  // ── 5. Empty plan — no-plan UI; toggle not rendered ───────────────────────

  it('shows no-plan UI and does not render the toggle when getLatestPlan returns null', async () => {
    (getLatestPlan as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await mountPage();

    // Loading completes with plan=null → no-plan UI appears
    expect(screen.getByText(/no financial plan yet/i)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /yearly/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /monthly/i })).not.toBeInTheDocument();
  });
});
