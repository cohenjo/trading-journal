
export const CURRENCY_RATES = {
    'ILS': 1,
    'USD': 3,
    'EUR': 3.5
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

export const formatCurrency = (amount: number, currency: string = 'USD', compact: boolean = false): string => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        maximumFractionDigits: compact ? 0 : 2,
        notation: compact ? 'compact' : 'standard'
    }).format(amount);
};
