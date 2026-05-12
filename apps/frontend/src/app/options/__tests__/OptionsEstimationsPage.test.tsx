/**
 * Tests for OptionsEstimationsPage (#429)
 *
 * Covers:
 *  - Summary tiles render baseline average and growth rate
 *  - History table renders actual years
 *  - Loading and error states
 *  - Settings changes propagate to SettingsContext
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReactNode } from 'react';
import { SettingsProvider } from '../../settings/SettingsContext';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/currency', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
}));

vi.mock('../../../components/Options/OptionsEstimationChart', () => ({
  default: () => <div data-testid="mock-options-chart" />,
}));

vi.mock('../../../components/Options/OptionsEstimationSettings', () => ({
  default: ({ params, onChange }: { params: { growth_rate: number; final_year: number }; onChange: (p: { growth_rate: number; final_year: number }) => void }) => (
    <div data-testid="mock-options-settings">
      <button
        onClick={() => onChange({ growth_rate: 0.05, final_year: 2070 })}
        data-testid="change-settings-btn"
      >
        Change Settings
      </button>
      <span data-testid="current-growth">{params.growth_rate}</span>
    </div>
  ),
}));

const mockGetOptionsYearlyCashFlow = vi.fn();
const mockGetOptionsIncomeEstimation = vi.fn();

vi.mock('../actions', () => ({
  getOptionsYearlyCashFlow: (...args: unknown[]) => mockGetOptionsYearlyCashFlow(...args),
  getOptionsIncomeEstimation: (...args: unknown[]) => mockGetOptionsIncomeEstimation(...args),
}));

import OptionsEstimationsPage from '../estimations/page';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithSettings(ui: ReactNode) {
  return render(<SettingsProvider>{ui}</SettingsProvider>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OptionsEstimationsPage (#429)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOptionsYearlyCashFlow.mockResolvedValue([
      { year: 2023, amount: 12000, isProjected: false },
      { year: 2024, amount: 15000, isProjected: false },
    ]);
    mockGetOptionsIncomeEstimation.mockResolvedValue({
      baselineAverage: 13500,
      growthRate: 0.02,
      projections: [
        { year: 2027, expectedIncome: 13770, isProjected: true },
        { year: 2028, expectedIncome: 14045, isProjected: true },
      ],
    });
  });

  it('renders page heading', async () => {
    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });
    expect(screen.getByText('Options Income Estimations')).toBeInTheDocument();
  });

  it('renders summary tiles with baseline and growth rate after load', async () => {
    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });

    await waitFor(() => {
      expect(screen.getByTestId('options-baseline-tile')).toBeInTheDocument();
      expect(screen.getByTestId('options-growth-tile')).toBeInTheDocument();
    });

    // baseline formatted with our mock formatCurrency
    expect(screen.getByTestId('options-baseline-tile')).toHaveTextContent('13500.00');
    // growth rate from default settings (2%)
    expect(screen.getByTestId('options-growth-tile')).toHaveTextContent('2.0%');
  });

  it('renders historical years in table', async () => {
    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });

    await waitFor(() => {
      expect(screen.getByText('2023')).toBeInTheDocument();
      expect(screen.getByText('2024')).toBeInTheDocument();
    });
  });

  it('renders chart component', async () => {
    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });
    await waitFor(() => expect(screen.getByTestId('mock-options-chart')).toBeInTheDocument());
  });

  it('shows error message when getOptionsYearlyCashFlow rejects', async () => {
    mockGetOptionsYearlyCashFlow.mockRejectedValue(new Error('DB error'));

    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load options cash flow/i)).toBeInTheDocument();
      expect(screen.getByText(/DB error/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no historical data', async () => {
    mockGetOptionsYearlyCashFlow.mockResolvedValue([]);

    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });

    await waitFor(() => {
      expect(screen.getByText(/No historical options cash flow data found/i)).toBeInTheDocument();
    });
  });

  it('displays loading indicators while actuals fetch is in flight', () => {
    // Never-resolving promise keeps the component in the loading state indefinitely.
    mockGetOptionsYearlyCashFlow.mockReturnValue(new Promise(() => {}));

    // Do NOT wrap in act so we observe the synchronous initial render.
    render(
      <SettingsProvider>
        <OptionsEstimationsPage />
      </SettingsProvider>,
    );

    // Both placeholders are rendered while isLoading is true.
    expect(screen.getByText(/Loading chart data/i)).toBeInTheDocument();
    expect(screen.getByText(/Loading history/i)).toBeInTheDocument();
    // The history table header must not appear yet.
    expect(screen.queryByText('Yearly Cash Flow History')).not.toBeInTheDocument();
  });

  it('re-fetches estimation with updated params when growth rate setting changes', async () => {
    await act(async () => { renderWithSettings(<OptionsEstimationsPage />); });

    // Initial fetch uses default settings (2% growth, finalYear 2064).
    expect(mockGetOptionsIncomeEstimation).toHaveBeenCalledTimes(1);
    expect(mockGetOptionsIncomeEstimation).toHaveBeenCalledWith({
      growthRate: 0.02,
      finalYear: 2064,
    });

    // The mock settings panel fires onChange({ growth_rate: 0.05, final_year: 2070 }).
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-settings-btn'));
    });

    // A second estimation fetch must be triggered with the new params.
    await waitFor(() => {
      expect(mockGetOptionsIncomeEstimation).toHaveBeenCalledTimes(2);
      expect(mockGetOptionsIncomeEstimation).toHaveBeenLastCalledWith({
        growthRate: 0.05,
        finalYear: 2070,
      });
    });

    // Growth tile must reflect the new rate immediately.
    expect(screen.getByTestId('options-growth-tile')).toHaveTextContent('5.0%');
  });
});
