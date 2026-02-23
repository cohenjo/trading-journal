import React from 'react';

interface Props {
    value: string;
    onChange: (currency: string) => void;
    className?: string;
}

const CURRENCIES = [
    { code: 'ILS', symbol: '₪', label: 'ILS (₪)' },
    { code: 'USD', symbol: '$', label: 'USD ($)' },
    { code: 'EUR', symbol: '€', label: 'EUR (€)' },
];

export const CurrencySelector: React.FC<Props> = ({ value, onChange, className }) => {
    return (
        <select
            value={value || 'ILS'}
            onChange={(e) => onChange(e.target.value)}
            className={`bg-slate-900 border-slate-700 rounded p-2 text-white text-sm ${className}`}
        >
            {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                    {c.label}
                </option>
            ))}
        </select>
    );
};
