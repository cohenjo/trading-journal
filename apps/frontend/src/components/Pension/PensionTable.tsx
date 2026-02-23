import React from 'react';

type AccountDetails = {
    deposits?: number;
    earnings?: number;
    fees?: number;
    insurance_fees?: number;
};

type AccountDef = {
    id: string;
    owner: string;
    name: string;
    value: number;
    details: AccountDetails;
};

type Props = {
    accounts: AccountDef[];
    onDelete?: (id: string, name: string) => void;
};

export default function PensionTable({ accounts, onDelete }: Props) {
    const formatCurrency = (val?: number) => {
        if (val === undefined || val === null) return '-';
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
    };

    return (
        <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-900 mt-6">
            <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-800/50">
                    <tr>
                        <th className="px-6 py-4 font-semibold">Owner</th>
                        <th className="px-6 py-4 font-semibold">Fund Name</th>
                        <th className="px-6 py-4 font-semibold text-right">Total Amount</th>
                        <th className="px-6 py-4 font-semibold text-right">Monthly Deposits</th>
                        <th className="px-6 py-4 font-semibold text-right">Period Earnings</th>
                        <th className="px-6 py-4 font-semibold text-right">Mgmt Fees</th>
                        <th className="px-6 py-4 font-semibold text-right">Insurance Fees</th>
                        <th className="px-6 py-4 font-semibold text-right"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {accounts.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="px-6 py-8 text-center text-slate-500 italic">
                                No pension data available. Upload a report to start tracking.
                            </td>
                        </tr>
                    ) : (
                        accounts.map((acc, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                                <td className="px-6 py-4 font-medium text-slate-200">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${acc.owner === 'You' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                        {acc.owner}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-slate-200">{acc.name}</td>
                                <td className="px-6 py-4 text-right text-emerald-400 font-medium">
                                    {formatCurrency(acc.value)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {formatCurrency(acc.details?.deposits)}
                                </td>
                                <td className="px-6 py-4 text-right text-emerald-400/80">
                                    {formatCurrency(acc.details?.earnings)}
                                </td>
                                <td className="px-6 py-4 text-right text-rose-400/80">
                                    {formatCurrency(acc.details?.fees)}
                                </td>
                                <td className="px-6 py-4 text-right text-rose-400/80">
                                    {formatCurrency(acc.details?.insurance_fees)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {onDelete && (
                                        <button
                                            onClick={() => onDelete(acc.id, acc.name)}
                                            className="p-1.5 bg-slate-800 hover:bg-red-900/50 rounded text-red-400 transition-colors"
                                            title="Delete"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
