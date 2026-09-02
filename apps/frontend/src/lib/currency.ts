
export const DEFAULT_CURRENCY_RATES = {
    'ILS': 1,
    'USD': 3.6,   // fallback ILS per USD
    'GBP': 4.6,   // fallback ILS per GBP
    'EUR': 3.9    // fallback ILS per EUR
} as const;

export const CURRENCY_RATES = DEFAULT_CURRENCY_RATES;
export const FALLBACK_CURRENCY_RATES = DEFAULT_CURRENCY_RATES;

export type CurrencyCode = string;

let activeRates: Record<string, number> = { ...DEFAULT_CURRENCY_RATES };

export const setDynamicCurrencyRates = (rates: Record<string, number>): void => {
    activeRates = { ...DEFAULT_CURRENCY_RATES, ...rates };
};

export const getActiveCurrencyRates = (): Record<string, number> => {
    return { ...activeRates };
};

export const resetCurrencyRates = (): void => {
    activeRates = { ...DEFAULT_CURRENCY_RATES };
};

export const convertCurrency = (
    amount: number,
    from: string = 'ILS',
    to: string = 'ILS',
    customRates?: Record<string, number>
): number => {
    if (!amount) return 0;
    const rates = customRates || activeRates;
    const fromRate = rates[from] || rates[from?.toUpperCase?.()] || DEFAULT_CURRENCY_RATES[from as keyof typeof DEFAULT_CURRENCY_RATES] || 1;
    const toRate = rates[to] || rates[to?.toUpperCase?.()] || DEFAULT_CURRENCY_RATES[to as keyof typeof DEFAULT_CURRENCY_RATES] || 1;

    // Convert to ILS (Base) then to Target
    const inILS = amount * fromRate;
    return inILS / toRate;
};

/**
 * Formats a monetary amount as a localised currency string.
 *
 * Broker sub-unit codes (ILA = Israeli agorot, GBp = pence) are normalised
 * to their ISO parents (ILS, GBP) before being passed to Intl.NumberFormat.
 * Without this step, Intl throws RangeError for non-ISO codes.
 */
export const formatCurrency = (amount: number, currency: string = 'USD', compact: boolean = false): string => {
    // Normalise broker sub-unit codes to ISO 4217 before Intl call.
    const isoCode = currency === 'ILA' ? 'ILS'
        : currency === 'GBp' ? 'GBP'
        : currency.toUpperCase();

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: isoCode,
        maximumFractionDigits: compact ? 0 : 2,
        notation: compact ? 'compact' : 'standard'
    }).format(amount);
};
