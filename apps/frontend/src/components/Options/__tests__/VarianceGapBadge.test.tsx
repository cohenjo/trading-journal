import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VarianceGapBadge from '../variance-gap-badge';

describe('VarianceGapBadge', () => {
  it("renders Jony's worked example with warning gap styling", () => {
    render(<VarianceGapBadge cumulativeCashFlow="2700" cumulativeRealizedPnl="1000" gap="1700" asOf="2026-03-31T00:00:00Z" />);

    expect(screen.getByText('+$2,700')).toBeInTheDocument();
    expect(screen.getByText('+$1,000')).toBeInTheDocument();
    const gap = screen.getByText('+$1,700');
    expect(gap).toBeInTheDocument();
    expect(gap.parentElement).toHaveClass('text-amber-200');
  });
});
