
export const CURRENCY_RATES = {
    'ILS': 1,
    'USD': 3.6,   // ~3.6 ILS per USD
    'GBP': 4.6,   // ~4.6 ILS per GBP
    'EUR': 3.9    // ~3.9 ILS per EUR
} as const;

export type CurrencyCode = keyof typeof CURRENCY_RATES;

export const convertCurrency = (amount: number, from: string = 'ILS', to: string = 'ILS'): number => {
    if (!amount) return 0;
    const fromRate = CURRENCY_RATES[from as CurrencyCode] || 1;
    const toRate = CURRENCY_RATES[to as CurrencyCode] || 1;

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
