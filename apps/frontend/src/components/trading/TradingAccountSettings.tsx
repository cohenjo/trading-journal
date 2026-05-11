"use client";

import React, { useState, useEffect } from "react";
import { getLatestFinanceSnapshot } from '@/app/finances/actions';
import {
    getTradingConfigs,
    saveTradingConfig,
    type TradingAccountConfig,
} from '@/app/trading/actions';

type TradingAccountFormState = Partial<TradingAccountConfig> & {
    app_key?: string;
    app_secret?: string;
    account_hash?: string;
};

type FinanceAccountOption = {
    id: string;
    name: string;
    owner?: string;
    category?: string;
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ibkr: "InteractiveBrokers",
  schwab: "Schwab",
  ira: "LeumiIRA",
};

export default function TradingAccountSettings() {
    const [configs, setConfigs] = useState<TradingAccountConfig[]>([]);
    const [editingConfig, setEditingConfig] = useState<TradingAccountFormState>({
        name: "My Broker",
        account_type: "ibkr",
        host: "127.0.0.1",
        port: 4001,
        client_id: 1,
        linked_account_id: "",
        compute_options_income: true,
    });
    const [financeAccounts, setFinanceAccounts] = useState<FinanceAccountOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        fetchConfigs();
        fetchFinanceAccounts();
    }, []);

    const fetchConfigs = async () => {
        try {
            const data = await getTradingConfigs();
            setConfigs(data);
            if (data.length > 0) {
                setEditingConfig(data[0]);
            }
        } catch (err) {
            console.error("Error fetching trading configs:", err);
        }
    };

    const fetchFinanceAccounts = async () => {
        try {
            const snapshot = await getLatestFinanceSnapshot();
            if (snapshot?.data?.items) {
                const investmentAccounts = snapshot.data.items
                    .filter((item) => item.category === "Investments")
                    .map((item) => ({ id: item.id, name: item.name, owner: item.owner, category: item.category }));
                setFinanceAccounts(investmentAccounts);
            }
        } catch (err) {
            console.error("Error fetching finance accounts:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);
        try {
            const result = await saveTradingConfig({
                name: editingConfig.name ?? "My Broker",
                account_type: editingConfig.account_type ?? "ibkr",
                id: editingConfig.id,
                host: editingConfig.host,
                port: editingConfig.port,
                client_id: editingConfig.client_id,
                linked_account_id: editingConfig.linked_account_id,
                compute_options_income: editingConfig.compute_options_income ?? true,
            });
            if (result.ok) {
                setSaveSuccess(true);
                setEditingConfig(result.config);
                fetchConfigs();
            } else {
                setSaveError(result.error || "Error saving settings.");
            }
        } catch {
            setSaveError("Error saving settings.");
        } finally {
            setSaving(false);
        }
    };

    const handleAddNew = () => {
        setEditingConfig({
            name: "New Account",
            account_type: "ibkr",
            host: "127.0.0.1",
            port: 4001,
            client_id: 1,
            linked_account_id: "",
            compute_options_income: true,
        });
    };

    if (loading) return <div className="text-slate-500">Loading settings...</div>;

    const normalizedType = (editingConfig.account_type ?? "ibkr").toLowerCase();
    const isIBKR = normalizedType === "ibkr";
    const accountTypeLabel = ACCOUNT_TYPE_LABELS[normalizedType] ?? normalizedType.toUpperCase();

    return (
        <div className="space-y-6">
            {/* Account List / Selection */}
            <div className="flex flex-wrap gap-4 items-center">
                {configs.map(c => (
                    <button
                        key={c.id}
                        onClick={() => setEditingConfig(c)}
                        className={`px-4 py-2 rounded-lg border transition-all ${editingConfig.id === c.id
                            ? "bg-blue-600/20 border-blue-500 text-blue-100 ring-1 ring-blue-500/50"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                            }`}
                    >
                        {c.name ?? c.account_id ?? "My Trading Account"} ({c.account_type})
                    </button>
                ))}
                <button
                    onClick={handleAddNew}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors flex items-center gap-2 text-sm border border-slate-700"
                    title="Add New Account"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Add Broker
                </button>
            </div>

            <div className="max-w-2xl bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl">
                <h2 className="text-xl font-bold mb-6 text-slate-100 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    {accountTypeLabel} Connection Settings
                </h2>

                {/* Save error banner */}
                {saveError && (
                    <div
                        className="mb-4 p-3 bg-red-950/60 border border-red-700 rounded-lg text-red-300 text-sm font-medium"
                        data-testid="settings-save-error"
                    >
                        {saveError}
                    </div>
                )}

                {/* Save success banner */}
                {saveSuccess && (
                    <div
                        className="mb-4 p-3 bg-green-950/60 border border-green-700 rounded-lg text-green-300 text-sm font-medium"
                        data-testid="settings-save-success"
                    >
                        Settings saved successfully!
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-400 mb-2">Account Name</label>
                            <input
                                type="text"
                                title="Account Name"
                                placeholder="e.g. Schwab Main"
                                value={editingConfig.name ?? ""}
                                onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Account Type</label>
                            <select
                                title="Account Type"
                                value={editingConfig.account_type ?? "ibkr"}
                                onChange={(e) => setEditingConfig({ ...editingConfig, account_type: e.target.value as TradingAccountConfig['account_type'] })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                            >
                                <option value="ibkr">InteractiveBrokers</option>
                                <option value="schwab">Schwab</option>
                                <option value="ira">LeumiIRA</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Link to Internal Account</label>
                            <select
                                title="Select internal account to link"
                                value={editingConfig.linked_account_id ?? ""}
                                onChange={(e) => setEditingConfig({ ...editingConfig, linked_account_id: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                            >
                                <option value="">None</option>
                                {financeAccounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name} ({acc.owner})</option>
                                ))}
                            </select>
                        </div>

                        {isIBKR ? (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">Host</label>
                                    <input
                                        type="text"
                                        title="Host"
                                        placeholder="127.0.0.1"
                                        value={editingConfig.host || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, host: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">Port</label>
                                    <input
                                        type="number"
                                        title="Port"
                                        placeholder="4001"
                                        value={editingConfig.port || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, port: parseInt(e.target.value) })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">Client ID</label>
                                    <input
                                        type="number"
                                        title="Client ID"
                                        placeholder="1"
                                        value={editingConfig.client_id || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, client_id: parseInt(e.target.value) })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-400 mb-2">App Key</label>
                                    <input
                                        type="text"
                                        value={editingConfig.app_key || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, app_key: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors font-mono text-xs"
                                        placeholder="Consumer Key"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-400 mb-2">App Secret</label>
                                    <input
                                        type="password"
                                        value={editingConfig.app_secret || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, app_secret: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors font-mono text-xs"
                                        placeholder="Consumer Secret"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-400 mb-2">Account Hash</label>
                                    <input
                                        type="text"
                                        value={editingConfig.account_hash || ""}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, account_hash: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors font-mono text-xs"
                                        placeholder="Hashed Account ID"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
                        <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                            checked={editingConfig.compute_options_income ?? true}
                            onChange={(e) => setEditingConfig({ ...editingConfig, compute_options_income: e.target.checked })}
                        />
                        <span>
                            <span className="block font-medium text-slate-100">Compute options income for this account</span>
                            <span className="block text-slate-500">Enabled by default. The worker will include this account in Flex options ingestion and monthly dashboard metrics.</span>
                        </span>
                    </label>

                    <div className="pt-4 flex items-center justify-between">
                        <div />
                        <button
                            type="submit"
                            disabled={saving}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {saving ? "Saving..." : "Save Settings"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
