'use client';
import React, { useMemo } from 'react';

// Color Mapping
const COLORS = [
    '#f472b6', '#c084fc', '#818cf8', '#60a5fa', '#34d399', '#facc15'
];

interface Props {
    data: any | null;
    prevData: any | null;
    currentYear: number;
    minYear: number;
    maxYear: number;
    onChangeYear: (year: number) => void;
    settings: any; // User settings for ages
}

export const PlanDetailsPane: React.FC<Props> = ({ data, prevData, currentYear, minYear, maxYear, onChangeYear, settings }) => {

    // Ages
    const primaryBirthYear = settings?.primaryUser?.birthYear || 1980;
    const spouseBirthYear = settings?.spouse?.birthYear;

    const primaryAge = currentYear - primaryBirthYear;
    const spouseAge = spouseBirthYear ? currentYear - spouseBirthYear : null;

    // Changes
    const changeNetWorth = useMemo(() => {
        if (!data || !prevData) return 0;
        return data.net_worth - prevData.net_worth;
    }, [data, prevData]);

    const investGrowth = useMemo(() => {
        if (!data || !prevData) return 0;
        // Approximation: Growth = Change in Net Worth - Net Savings
        // Net Savings = Income - Expenses - Tax
        // Actually surplus/deficit is stored?
        // Let's use simpler: Total Liquid Change - (Surplus/Deficit)
        // Note: Surplus is already net flow.
        const liquidChange = data.liquid_assets - prevData.liquid_assets;
        const netFlow = (data.income - data.tax_paid - data.expenses);
        return liquidChange - netFlow;
    }, [data, prevData]);

    if (!data) return <div className="p-6 text-slate-500">Select a year on the chart</div>;

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: settings?.mainCurrency || 'USD', maximumFractionDigits: 0 }).format(val);
    const formatPercent = (val: number) => new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 }).format(val);

    return (
        <div className="flex flex-col h-full bg-slate-950 border-l border-slate-800 w-full md:w-[350px]">
            {/* Header / Slider */}
            <div className="p-6 border-b border-slate-800">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex gap-4 items-center">
                        <div className="flex items-center gap-2 text-slate-300">
                            <span className="text-xl">☺ {primaryAge}</span>
                            {spouseAge && <span className="text-xl opacity-60">☺ {spouseAge}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xl font-mono text-slate-200">
                        📅 {currentYear}
                    </div>
                </div>

                <input
                    type="range"
                    min={minYear}
                    max={maxYear}
                    value={currentYear}
                    onChange={(e) => onChangeYear(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
            </div>

            {/* Metrics List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-sm">

                {/* Net Worth Block */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-blue-400 font-medium">Net Worth</span>
                        <span className="text-slate-100 font-bold text-lg">{formatCurrency(data.net_worth)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-blue-500/70">Change in Net Worth</span>
                        <span className={changeNetWorth >= 0 ? "text-green-400" : "text-red-400"}>
                            {changeNetWorth > 0 ? '+' : ''}{formatCurrency(changeNetWorth)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500">Liquid Net Worth</span>
                        <span className="text-slate-300">{formatCurrency(data.liquid_net_worth)}</span>
                    </div>
                </div>

                {/* Cash Flow Block */}
                <div className="space-y-3 pt-4 border-t border-slate-800/50">
                    <div className="flex justify-between items-center">
                        <span className="text-slate-100 font-medium">Withdrawals</span>
                        <span className="text-slate-100">{formatCurrency(data.withdrawals)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500">Withdrawal Rate</span>
                        <span className="text-slate-300">
                            {data.liquid_assets > 0 ? formatPercent(data.withdrawals / data.liquid_assets) : '0%'}
                        </span>
                    </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-800/50">
                    <div className="flex justify-between items-center">
                        <span className="text-emerald-400 font-medium">Income</span>
                        <span className="text-slate-100">{formatCurrency(data.income)}</span>
                    </div>
                    {data.total_dividend_income > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-emerald-500/70">Current Annual Dividends</span>
                            <span className="text-slate-300">{formatCurrency(data.total_dividend_income)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center">
                        <span className="text-emerald-600/70">Taxable Income</span>
                        <span className="text-slate-300">{formatCurrency(data.taxable_income)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500">Taxes</span>
                        <span className="text-slate-300">{formatCurrency(data.tax_paid)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500">Effective Tax Rate</span>
                        <span className="text-slate-300">
                            {data.income > 0 ? formatPercent(data.tax_paid / data.income) : '0%'}
                        </span>
                    </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-800/50">
                    <div className="flex justify-between items-center">
                        <span className="text-orange-400 font-medium">Expenses</span>
                        <span className="text-slate-100">{formatCurrency(data.expenses)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-orange-500/70">Spending</span>
                        <span className="text-slate-300">{formatCurrency(data.expenses)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-fuchsia-400 font-medium">Savings Rate</span>
                        <span className="text-slate-300">
                            {data.income > 0 ? formatPercent((data.income - data.tax_paid - data.expenses) / data.income) : '0%'}
                        </span>
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-800/50">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-slate-100 font-medium">Investment Growth</span>
                        <span className={investGrowth >= 0 ? "text-green-400" : "text-red-400"}>
                            {investGrowth > 0 ? '+' : ''}{formatCurrency(investGrowth)}
                        </span>
                    </div>
                </div>

                {/* Account Allocation Mini-Viz */}
                <div className="pt-4 border-t border-slate-800/50">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Portfolio Allocations</h4>
                    <div className="space-y-2">
                        {data.accounts.map((acc: any, i: number) => (
                            acc.value > 0 && (
                                <div key={acc.name} className="group">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-slate-400 truncate w-2/3">{acc.name}</span>
                                        <span className="text-slate-300">{formatCurrency(acc.value)}</span>
                                    </div>
                                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{
                                                width: `${data.liquid_assets > 0 && acc.value > 0 ? Math.min(100, (acc.value / data.liquid_assets) * 100) : 0}%`,
                                                backgroundColor: COLORS[i % COLORS.length]
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};
