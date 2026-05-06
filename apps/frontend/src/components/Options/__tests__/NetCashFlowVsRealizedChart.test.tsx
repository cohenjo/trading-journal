import { render, screen, waitFor } from '@testing-library/react';
import Decimal from 'decimal.js';
import { createChart } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import NetCashFlowVsRealizedChart, { buildOptionsChartSeries } from '../net-cash-flow-vs-realized-chart';
import type { MonthlyMetric } from '@/types/options';

const months: MonthlyMetric[] = [
  { accountId: 'DU1', periodStart: '2026-01-01', periodEnd: '2026-01-31', cashFlow: '3000', realizedPnl: '0', cumulativeCashFlow: '3000', cumulativeRealizedPnl: '0', varianceGap: '3000', cumulativeVarianceGap: '3000', tradeCount: 1, rollCount: 0, rollPositiveCount: 0, rollNegativeCount: 1, rollNeutralCount: 0, rollEfficiencyPct: null, lastComputedAt: '2026-01-31T00:00:00Z' },
  { accountId: 'DU1', periodStart: '2026-02-01', periodEnd: '2026-02-28', cashFlow: '200', realizedPnl: '-1000', cumulativeCashFlow: '3200', cumulativeRealizedPnl: '-1000', varianceGap: '1200', cumulativeVarianceGap: '4200', tradeCount: 2, rollCount: 1, rollPositiveCount: 0, rollNegativeCount: 1, rollNeutralCount: 0, rollEfficiencyPct: '0', lastComputedAt: '2026-02-28T00:00:00Z' },
  { accountId: 'DU1', periodStart: '2026-03-01', periodEnd: '2026-03-31', cashFlow: '-500', realizedPnl: '2000', cumulativeCashFlow: '2700', cumulativeRealizedPnl: '1000', varianceGap: '-2500', cumulativeVarianceGap: '1700', tradeCount: 1, rollCount: 0, rollPositiveCount: 0, rollNegativeCount: 0, rollNeutralCount: 0, rollEfficiencyPct: null, lastComputedAt: '2026-03-31T00:00:00Z' },
];

describe('NetCashFlowVsRealizedChart', () => {
  it('computes the Israeli flat 25% tax line with Decimal precision', () => {
    const series = buildOptionsChartSeries(months);
    expect(series.at(-1)?.taxEstimate).toBe(new Decimal(1000).times('0.25').toFixed(2));
    expect(series.at(1)?.taxEstimate).toBe('0.00');
  });

  it('renders with seeded data and tooltip values', async () => {
    render(<NetCashFlowVsRealizedChart months={months} />);

    await waitFor(() => expect(screen.getByTestId('net-cash-flow-chart')).toBeInTheDocument());
    expect(screen.getByText(/Net Cash Flow vs Realized P&L/i)).toBeInTheDocument();
    expect(screen.getByTestId('options-chart-tooltip')).toHaveTextContent('Variance gap');
  });

  it('creates dual Y-axes: left for cash flow, right for cumulative P&L', async () => {
    render(<NetCashFlowVsRealizedChart months={months} />);

    await waitFor(() => expect(screen.getByTestId('net-cash-flow-chart')).toBeInTheDocument());

    const calls = vi.mocked(createChart).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const chartOptions = calls[calls.length - 1][1] as {
      leftPriceScale?: { visible?: boolean };
      rightPriceScale?: { borderColor?: string };
    };
    // Left axis must be explicitly enabled for the cash-flow histogram
    expect(chartOptions?.leftPriceScale?.visible).toBe(true);
    // Right axis must be configured for the cumulative P&L line (blue border)
    expect(chartOptions?.rightPriceScale?.borderColor).toBe('#60a5fa');
  });

  it('tooltip labels axis direction for each series', async () => {
    render(<NetCashFlowVsRealizedChart months={months} />);

    await waitFor(() => expect(screen.getByTestId('options-chart-tooltip')).toBeInTheDocument());
    const tooltip = screen.getByTestId('options-chart-tooltip');
    expect(tooltip).toHaveTextContent('Cash Flow (←)');
    expect(tooltip).toHaveTextContent('Cumulative P&L (→)');
  });
});
