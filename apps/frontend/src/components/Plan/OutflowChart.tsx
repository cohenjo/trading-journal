import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = [
    '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', // Rose/Red (Expenses)
    '#94a3b8', '#64748b', '#475569', '#334155', // Slate (Taxes)
    '#818cf8', '#6366f1', '#4f46e5', '#4338ca', // Indigo (Savings)
    '#2dd4bf', '#14b8a6', '#0d9488' // Teal
];

interface Props {
    projection: any[];
}

export const OutflowChart: React.FC<Props> = ({ projection }) => {
    const { chartData, keys } = useMemo(() => {
        if (!projection || projection.length === 0) return { chartData: [], keys: [] };

        const allKeys = new Set<string>();

        const chartData = projection.map(p => {
            const point: any = { year: p.year };

            // Expenses
            p.expense_details?.forEach((exp: any) => {
                const name = exp.name || 'Unknown Expense';
                const amount = exp.value ?? 0;
                if (amount > 0) {
                    point[name] = (point[name] || 0) + amount;
                    allKeys.add(name);
                }
            });

            // Taxes
            if (p.tax_paid && p.tax_paid > 0) {
                point['Taxes'] = (point['Taxes'] || 0) + p.tax_paid;
                allKeys.add('Taxes');
            }

            // Net Savings
            let totalSavings = 0;
            p.savings_details?.forEach((s: any) => {
                totalSavings += (s.value ?? 0);
            });
            if (totalSavings > 0) {
                point['Net Savings'] = (point['Net Savings'] || 0) + totalSavings;
                allKeys.add('Net Savings');
            }

            return point;
        });

        // Ensure Taxes and Net Savings are visually ordered predictably if possible.
        // We'll just use the Set order, but we can sort the keys.
        const sortedKeys = Array.from(allKeys).sort((a, b) => {
            if (a === 'Net Savings') return 1;
            if (b === 'Net Savings') return -1;
            if (a === 'Taxes') return 1;
            if (b === 'Taxes') return -1;
            return a.localeCompare(b);
        });

        return {
            chartData,
            keys: sortedKeys
        };
    }, [projection]);

    if (chartData.length === 0) return null;

    return (
        <div className="w-full h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis
                        dataKey="year"
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        tickLine={{ stroke: '#475569' }}
                    />
                    <YAxis
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        tickLine={{ stroke: '#475569' }}
                        tickFormatter={(val) => \`\${(val / 1000).toFixed(0)}k\`}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                        itemStyle={{ color: '#f8fafc' }}
                        formatter={(value: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(value)}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
                    />
                    <Legend
                        wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
                    />
                    {keys.map((key, index) => {
                        // Dynamically assign color based on type if possible, or fallback to standard array
                        let color = COLORS[index % COLORS.length];
                        if (key === 'Taxes') color = '#94a3b8';
                        if (key === 'Net Savings') color = '#6366f1';

                        return (
                            <Area
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stackId="1"
                                stroke={color}
                                fill={color}
                                fillOpacity={0.6}
                            />
                        );
                    })}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
