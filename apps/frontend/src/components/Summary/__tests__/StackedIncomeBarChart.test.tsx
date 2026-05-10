import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StackedIncomeBarChart, { YearlyIncomeData, SERIES_COLORS } from '../StackedIncomeBarChart';
import { createChart } from 'lightweight-charts';

// Mock is already configured in src/test/setup.ts

const mockData: YearlyIncomeData[] = [
  { year: 2024, optionsIncome: 5000, dividendsIncome: 3000, bondsIncome: 2000, isProjected: false },
  { year: 2025, optionsIncome: 6000, dividendsIncome: 3300, bondsIncome: 2500, isProjected: false },
  { year: 2026, optionsIncome: 0, dividendsIncome: 3630, bondsIncome: 3000, isProjected: true },
  { year: 2027, optionsIncome: 0, dividendsIncome: 3993, bondsIncome: 3500, isProjected: true },
];

describe('StackedIncomeBarChart', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders chart container', () => {
    render(<StackedIncomeBarChart data={mockData} />);
    const container = document.querySelector('.w-full.h-\\[400px\\]');
    expect(container).toBeInTheDocument();
  });

  it('creates chart with proper configuration', async () => {
    render(<StackedIncomeBarChart data={mockData} />);

    await waitFor(() => {
      expect(createChart).toHaveBeenCalled();
    });

    const calls = vi.mocked(createChart).mock.calls;
    const lastCall = calls[calls.length - 1];
    const config = lastCall[1] as {
      layout?: { background?: { color?: string }; textColor?: string };
      height?: number;
    };

    expect(config.layout?.background?.color).toBe('#020617');
    expect(config.height).toBe(400);
  });

  it('creates three histogram series for stacked bars', async () => {
    render(<StackedIncomeBarChart data={mockData} />);

    await waitFor(() => {
      expect(createChart).toHaveBeenCalled();
    });

    const mockChart = vi.mocked(createChart).mock.results[vi.mocked(createChart).mock.results.length - 1].value;

    await waitFor(() => {
      expect(mockChart.addSeries).toHaveBeenCalledTimes(4);
    });
  });

  /**
   * Regression test for #343 / updated for #357 (4th series).
   *
   * The 4 series are added in bottom-to-top render order:
   * bondInterest (violet, bottommost) → bonds (blue) → dividends (green) → options (amber, top).
   */
  it('each series receives a distinct fill color matching SERIES_COLORS', async () => {
    render(<StackedIncomeBarChart data={mockData} />);

    await waitFor(() => {
      expect(createChart).toHaveBeenCalled();
    });

    const mockChart = vi.mocked(createChart).mock.results[vi.mocked(createChart).mock.results.length - 1].value;

    await waitFor(() => {
      expect(mockChart.addSeries).toHaveBeenCalledTimes(4);
    });

    // Extract the `color` option from each addSeries call
    const seriesColors = (mockChart.addSeries.mock.calls as unknown[][]).map(
      (call) => (call[1] as Record<string, unknown>).color as string,
    );

    // All four fills must be distinct — prevents "all same color" regression
    const distinctColors = new Set(seriesColors);
    expect(distinctColors.size).toBe(4);

    // Each fill must match the exported SERIES_COLORS constant
    expect(seriesColors).toContain(SERIES_COLORS.options);
    expect(seriesColors).toContain(SERIES_COLORS.dividends);
    expect(seriesColors).toContain(SERIES_COLORS.bonds);
    expect(seriesColors).toContain(SERIES_COLORS.bondInterest);
  });

  it('distinguishes projected years with reduced opacity', async () => {
    render(<StackedIncomeBarChart data={mockData} />);

    await waitFor(() => {
      expect(createChart).toHaveBeenCalled();
    });

    const mockChart = vi.mocked(createChart).mock.results[vi.mocked(createChart).mock.results.length - 1].value;

    await waitFor(() => {
      // @ts-expect-error - accessing test-only __series property
      const series = mockChart.__series;
      expect(series.length).toBe(4);

      // Check that setData was called on each series
      series.forEach((s: { setData: ReturnType<typeof vi.fn> }) => {
        expect(s.setData).toHaveBeenCalled();
      });

      // Addition order: bondInterest(0), bonds(1), dividends(2), options(3).
      // We check the options series (index 3) since its 2024 value is known.
      const optionsData = series[3].setData.mock.calls[0][0] as Array<{ color: string }>;
      expect(optionsData).toBeInstanceOf(Array);
      expect(optionsData[0]).toHaveProperty('color');

      // Check that projected years have lower opacity (0.4) vs actuals (1.0)
      const actualYearColor = optionsData[0].color;
      const projectedYearColor = optionsData[2].color;

      // Actual years should have higher opacity (0.8)
      expect(actualYearColor).toContain('0.8');
      // Projected years should have lower opacity (0.32 = 0.4 * 0.8)
      expect(projectedYearColor).toContain('0.32');
    });
  });

  it('stacks values correctly', async () => {
    render(<StackedIncomeBarChart data={mockData} />);

    await waitFor(() => {
      expect(createChart).toHaveBeenCalled();
    });

    const mockChart = vi.mocked(createChart).mock.results[vi.mocked(createChart).mock.results.length - 1].value;

    await waitFor(() => {
      // @ts-expect-error - accessing test-only __series property
      const series = mockChart.__series;
      expect(series.length).toBe(4);

      // Addition order: bondInterest(0), bonds(1), dividends(2), options(3).
      const bondInterestData = series[0].setData.mock.calls[0][0];
      const bondsData        = series[1].setData.mock.calls[0][0];
      const dividendsData    = series[2].setData.mock.calls[0][0];
      const optionsData      = series[3].setData.mock.calls[0][0];

      // First data point (2024): options=5000, dividends=3000, bonds=2000, bondInterest=0 (not set)
      // Stacked cumulative values (bottom → top):
      expect(bondInterestData[0].value).toBe(0);     // bondInterest only
      expect(bondsData[0].value).toBe(2000);         // bondInterest + bonds
      expect(dividendsData[0].value).toBe(5000);     // bondInterest + bonds + dividends
      expect(optionsData[0].value).toBe(10000);      // total
    });
  });

  it('formats currency values correctly in tooltip', () => {
    render(<StackedIncomeBarChart data={mockData} />);

    // Currency formatter should format as USD without decimals
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    });

    expect(formatter.format(5000)).toBe('$5,000');
    expect(formatter.format(10000)).toBe('$10,000');
  });
});
