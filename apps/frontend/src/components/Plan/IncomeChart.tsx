import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = [
    '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#14b8a6',
    '#f43f5e', '#d946ef', '#0ea5e9', '#22c55e', '#f97316'
];

interface Props {
    projection: any[];
}

export const IncomeChart: React.FC<Props> = ({ projection }) => {
    const { chartData, keys } = useMemo(() => {
        if (!projection || projection.length === 0) return { chartData: [], keys: [] };

        const allKeys = new Set<string>();

        const chartData = projection.map(p => {
            const point: any = { year: p.year };

            p.income_details?.forEach((inc: any) => {
                const name = inc.name || 'Unknown Income';
                const amount = inc.gross ?? inc.value ?? 0;
                if (amount > 0) {
                    point[name] = (point[name] || 0) + amount;
                    allKeys.add(name);
                }
            });

            p.withdrawal_details?.forEach((w: any) => {
                const name = w.name || 'Unknown Withdrawal';
                const amount = w.value ?? 0;
                if (amount > 0) {
                    point[name] = (point[name] || 0) + amount;
                    allKeys.add(name);
                }
            });

            return point;
        });

        return {
            chartData,
            keys: Array.from(allKeys)
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
                        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                        itemStyle={{ color: '#f8fafc' }}
                        formatter={(value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
                    />
                    <Legend
                        wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
                    />
                    {keys.map((key, index) => (
                        <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            stackId="1"
                            stroke={COLORS[index % COLORS.length]}
                            fill={COLORS[index % COLORS.length]}
                            fillOpacity={0.6}
                        />
                    ))}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
