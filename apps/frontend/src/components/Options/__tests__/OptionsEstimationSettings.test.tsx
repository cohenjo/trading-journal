import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OptionsEstimationSettings from '../OptionsEstimationSettings';
import type { OptionsProjectionParams } from '../OptionsEstimationSettings';

const defaultParams: OptionsProjectionParams = {
  growth_rate: 0.02,
  final_year: 2064,
};

describe('OptionsEstimationSettings', () => {
  it('renders growth rate and final year fields with correct initial values', () => {
    const onChange = vi.fn();
    render(<OptionsEstimationSettings params={defaultParams} onChange={onChange} />);

    expect(screen.getByText('Projection Settings')).toBeInTheDocument();

    const growthInput = screen.getByDisplayValue('2.0') as HTMLInputElement;
    expect(growthInput).toBeInTheDocument();

    const finalYearInput = screen.getByDisplayValue('2064') as HTMLInputElement;
    expect(finalYearInput).toBeInTheDocument();
  });

  it('calls onChange with updated growth_rate when field changes', () => {
    const onChange = vi.fn();
    render(<OptionsEstimationSettings params={defaultParams} onChange={onChange} />);

    const growthInput = screen.getByDisplayValue('2.0');
    fireEvent.change(growthInput, { target: { value: '3.0' } });

    expect(onChange).toHaveBeenCalledOnce();
    const called = onChange.mock.calls[0][0] as OptionsProjectionParams;
    expect(called.growth_rate).toBeCloseTo(0.03, 5);
    expect(called.final_year).toBe(2064);
  });

  it('calls onChange with updated final_year when field changes', () => {
    const onChange = vi.fn();
    render(<OptionsEstimationSettings params={defaultParams} onChange={onChange} />);

    const finalYearInput = screen.getByDisplayValue('2064');
    fireEvent.change(finalYearInput, { target: { value: '2070' } });

    expect(onChange).toHaveBeenCalledOnce();
    const called = onChange.mock.calls[0][0] as OptionsProjectionParams;
    expect(called.final_year).toBe(2070);
    expect(called.growth_rate).toBe(0.02);
  });

  it('renders helper text explaining the growth rate formula', () => {
    const onChange = vi.fn();
    render(<OptionsEstimationSettings params={defaultParams} onChange={onChange} />);

    expect(screen.getByText(/3-year baseline average/i)).toBeInTheDocument();
  });
});
