"use client";

import React, { useState, useEffect } from "react";

interface AddPositionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (position: { account: string; ticker: string; shares: number; id?: number }) => void;
    initialData?: { account: string; ticker: string; shares: number; id?: number } | null;
    availableAccounts: string[];
    defaultAccount?: string;
}

export default function AddPositionModal({ isOpen, onClose, onSave, initialData, availableAccounts, defaultAccount }: AddPositionModalProps) {
    const [account, setAccount] = useState(defaultAccount || availableAccounts[0] || "ABKR");
    const [ticker, setTicker] = useState("");
    const [shares, setShares] = useState(0);

    useEffect(() => {
        if (initialData) {
            setAccount(initialData.account);
            setTicker(initialData.ticker);
            setShares(initialData.shares);
        } else {
            // Reset form
            setAccount(defaultAccount || availableAccounts[0] || "ABKR");
            setTicker("");
            setShares(0);
        }
    }, [initialData, isOpen, availableAccounts, defaultAccount]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            id: initialData?.id,
            account,
            ticker: ticker.toUpperCase(),
            shares: Number(shares)
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-md shadow-xl">
                <h2 className="text-xl font-bold text-slate-100 mb-4">
                    {initialData ? "Edit Position" : "Add Position"}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="account" className="block text-sm font-medium text-slate-400 mb-1">Account</label>
                        <select
                            id="account"
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                        >
                            {availableAccounts.map(acc => (
                                <option key={acc} value={acc}>{acc}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="ticker" className="block text-sm font-medium text-slate-400 mb-1">Ticker</label>
                        <input
                            id="ticker"
                            type="text"
                            required
                            value={ticker}
                            onChange={(e) => setTicker(e.target.value)}
                            placeholder="e.g. MSFT"
                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors uppercase"
                        />
                    </div>

                    <div>
                        <label htmlFor="shares" className="block text-sm font-medium text-slate-400 mb-1">Shares</label>
                        <input
                            id="shares"
                            type="number"
                            required
                            step="any"
                            min="0"
                            value={shares}
                            onChange={(e) => setShares(Number(e.target.value))}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors font-medium"
                        >
                            Save Position
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
