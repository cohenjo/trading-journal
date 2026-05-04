import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EfficiencyGauges from '../efficiency-gauges';

const baseData = {
  rocaR_pct: '19.3750',
  marginUtilization_pct: '25.00',
  marginSource: 'synthetic' as const,
  marginAsOf: '2025-01-31T22:35:00Z',
  marginUsed: '5000',
  marginAvailable: '15000',
  isStale: true,
};

describe('EfficiencyGauges', () => {
  it('renders live gauge values, stale badges, source pill, and needles', () => {
    render(<EfficiencyGauges data={baseData} />);

    expect(screen.getByTestId('efficiency-gauges')).toBeInTheDocument();
    expect(screen.getByText('19.38%')).toBeInTheDocument();
    expect(screen.getByText('25.00%')).toBeInTheDocument();
    expect(screen.getAllByText('Stale')).toHaveLength(2);
    expect(screen.getByText('synthetic')).toBeInTheDocument();
    expect(screen.getByTestId('return-on-capital-at-risk-needle')).toBeInTheDocument();
    expect(screen.getByTestId('margin-utilization-needle')).toBeInTheDocument();
  });

  it('renders first-sync empty state when both gauges are null', () => {
    render(<EfficiencyGauges data={{ ...baseData, rocaR_pct: null, marginUtilization_pct: null }} />);

    expect(screen.getByText('Waiting for first sync — see /options/setup')).toBeInTheDocument();
  });
});
