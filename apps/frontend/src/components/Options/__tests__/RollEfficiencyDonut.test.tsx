import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RollEfficiencyDonut from '../roll-efficiency-donut';

describe('RollEfficiencyDonut', () => {
  it("renders Jony's one negative roll example as 0% positive", () => {
    render(<RollEfficiencyDonut positive={0} negative={1} neutral={0} />);

    expect(screen.getByTestId('roll-efficiency-donut')).toBeInTheDocument();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/Neutral = realized P&L within ±\$25/)).toBeInTheDocument();
  });
});
