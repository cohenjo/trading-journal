/**
 * Tests for PlanAccountDetails — RSU configuration surface
 *
 * Covers:
 *  - Ticker field shows required validation when empty (Wix-style RSU)
 *  - Dividend yield displays the stored auto value (MSFT-style RSU)
 *  - Dividend policy selector is hidden for RSU type
 *  - Dividend tax rate defaults to 25 for new RSU accounts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { PlanAccountDetails } from '../PlanAccountDetails';
import type { PlanItem } from '../types';

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockGetPrice = vi.fn();
vi.mock('@/app/finances/actions', () => ({
    getPrice: (...args: unknown[]) => mockGetPrice(...args),
}));

vi.mock('@/components/Common/CurrencySelector', () => ({
    CurrencySelector: ({
        value,
        onChange,
    }: {
        value: string;
        onChange: (v: string) => void;
    }) => (
        <select
            data-testid="currency-selector"
            value={value}
            onChange={e => onChange(e.target.value)}
        />
    ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a PlanItem with `type: 'RSU'` and any account_settings overrides.
 * Mirrors a freshly-created RSU account entry in the financial plan.
 */
function makeRsuItem(
    settingsOverrides: Partial<NonNullable<PlanItem['account_settings']>> = {},
    itemOverrides: Partial<PlanItem> = {},
): PlanItem {
    return {
        id: 'rsu-test-1',
        name: 'Wix RSU',
        category: 'Account',
        owner: 'test-user',
        value: 0,
        growth_rate: 7,
        currency: 'USD',
        frequency: 'Yearly',
        account_settings: {
            type: 'RSU',
            bond_allocation: 0,
            dividend_yield: 0,
            fees: 0,
            ...settingsOverrides,
        },
        ...itemOverrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanAccountDetails — RSU', () => {
    beforeEach(() => {
        // Default: price cache has no data yet — avoids async noise
        mockGetPrice.mockResolvedValue(null);
    });

    describe('Ticker validation', () => {
        it('shows ticker required error and red border when stock_symbol is empty (Wix-style new account)', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: undefined })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const tickerInput = screen.getByTestId('rsu-ticker-input');
            expect(tickerInput).toBeInTheDocument();
            expect(tickerInput).toHaveClass('border-red-500/60');

            const error = screen.getByTestId('rsu-ticker-required-error');
            expect(error).toBeInTheDocument();
            expect(error).toHaveTextContent('Ticker is required');
        });

        it('hides required error and uses normal border when ticker is set', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'WIX' })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const tickerInput = screen.getByTestId('rsu-ticker-input');
            expect(tickerInput).toHaveValue('WIX');
            expect(tickerInput).not.toHaveClass('border-red-500/60');

            expect(screen.queryByTestId('rsu-ticker-required-error')).not.toBeInTheDocument();
        });
    });

    describe('Dividend yield — auto display', () => {
        it('shows auto-fetched dividend yield for MSFT-style RSU (0.87%)', () => {
            // Pre-populate dividend_yield as the worker would have stored it
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT', dividend_yield: 0.87 })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const autoYield = screen.getByTestId('rsu-dividend-yield-auto');
            expect(autoYield).toBeInTheDocument();
            expect(autoYield).toHaveTextContent('0.87%');
            expect(autoYield).toHaveTextContent('auto-updated by worker');
        });

        it('shows 0.00% for Wix RSU (no dividend distribution)', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'WIX', dividend_yield: 0 })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const autoYield = screen.getByTestId('rsu-dividend-yield-auto');
            expect(autoYield).toHaveTextContent('0.00%');
        });

        it('does not render the RSU Config section in snapshot mode', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT', dividend_yield: 0.87 })}
                    onChange={vi.fn()}
                    mode="snapshot"
                />,
            );

            // RSU Planning Config section is planning-mode only
            expect(screen.queryByTestId('rsu-dividend-yield-auto')).not.toBeInTheDocument();
        });
    });

    describe('Dividend policy — locked for RSU', () => {
        it('does not render Accumulate/Payout radio selectors for RSU type', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT' })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            expect(screen.queryByText('Reinvest (Accumulate)')).not.toBeInTheDocument();
            expect(screen.queryByText('Pay Out (Income)')).not.toBeInTheDocument();
        });

        it('shows Accumulate/Payout selectors for non-RSU Broker account', () => {
            const brokerItem: PlanItem = {
                ...makeRsuItem(),
                account_settings: {
                    type: 'Broker',
                    bond_allocation: 0,
                    dividend_yield: 2,
                    fees: 0.1,
                },
            };
            render(
                <PlanAccountDetails
                    item={brokerItem}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            expect(screen.getByText('Reinvest (Accumulate)')).toBeInTheDocument();
            expect(screen.getByText('Pay Out (Income)')).toBeInTheDocument();
        });
    });

    describe('Dividend tax rate — RSU default 25%', () => {
        it('shows 25 as the default dividend tax rate for a new RSU account (no tax rate set)', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT', dividend_tax_rate: undefined })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const taxInput = screen.getByTestId('rsu-dividend-tax-rate');
            expect(taxInput).toBeInTheDocument();
            expect(taxInput).toHaveValue(25);
        });

        it('preserves an explicitly-set tax rate (e.g. 30%) without overriding to 25', () => {
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT', dividend_tax_rate: 30 })}
                    onChange={vi.fn()}
                    mode="planning"
                />,
            );

            const taxInput = screen.getByTestId('rsu-dividend-tax-rate');
            expect(taxInput).toHaveValue(30);
        });

        it('auto-sets dividend_policy to Payout and dividend_tax_rate to 25 when type changes to RSU', async () => {
            const onChange = vi.fn();
            render(
                <PlanAccountDetails
                    item={makeRsuItem({ stock_symbol: 'MSFT', dividend_tax_rate: undefined, dividend_policy: undefined })}
                    onChange={onChange}
                    mode="planning"
                />,
            );

            await waitFor(() => {
                expect(onChange).toHaveBeenCalledWith(
                    expect.objectContaining({
                        account_settings: expect.objectContaining({
                            dividend_policy: 'Payout',
                            dividend_tax_rate: 25,
                        }),
                    }),
                );
            });
        });
    });
});
