"use client";

import React, { useState, useEffect } from "react";

export default function TradingAccountSettings() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [editingConfig, setEditingConfig] = useState<any>({
        name: "My Broker",
        account_type: "IBKR",
        host: "127.0.0.1",
        port: 4001,
        client_id: 1,
        linked_account_id: ""
    });
    const [financeAccounts, setFinanceAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        fetchConfigs();
        fetchFinanceAccounts();
    }, []);

    const fetchConfigs = async () => {
        try {
            const res = await fetch("/api/trading/configs");
            if (res.ok) {
                const data = await res.json();
                setConfigs(data || []);
                if (data && data.length > 0) {
                    setEditingConfig(data[0]);
                }
            }
        } catch (err) {
            console.error("Error fetching trading configs:", err);
        }
    };

    const fetchFinanceAccounts = async () => {
        try {
            const res = await fetch("/api/finances/latest");
            if (res.ok) {
                const data = await res.json();
                if (data && data.data && data.data.items) {
                    setFinanceAccounts(data.data.items.filter((i: any) => i.category === "Investments"));
                }
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
        setMessage("");
        try {
            const res = await fetch("/api/trading/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editingConfig)
            });
            if (res.ok) {
                setMessage("Settings saved successfully!");
                fetchConfigs();
            } else {
                setMessage("Error saving settings.");
            }
        } catch (err) {
            setMessage("Error saving settings.");
        } finally {
            setSaving(false);
        }
    };

    const handleAddNew = () => {
        setEditingConfig({
            name: "New Account",
            account_type: "IBKR",
            host: "127.0.0.1",
            port: 4001,
            client_id: 1,
            linked_account_id: ""
        });
    };

    if (loading) return <div className="text-slate-500">Loading settings...</div>;

    const isIBKR = editingConfig.account_type === "IBKR";

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
                        {c.name} ({c.account_type})
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
                    {isIBKR ? "IBKR" : "Schwab"} Connection Settings
                </h2>

                <form onSubmit={handleSave} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-400 mb-2">Account Name</label>
                            <input
                                type="text"
                                title="Account Name"
                                placeholder="e.g. Schwab Main"
                                value={editingConfig.name}
                                onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Account Type</label>
                            <select
                                title="Account Type"
                                value={editingConfig.account_type}
                                onChange={(e) => setEditingConfig({ ...editingConfig, account_type: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
                            >
                                <option value="IBKR">Interactive Brokers</option>
                                <option value="SCHWAB">Charles Schwab</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Link to Internal Account</label>
                            <select
                                title="Select internal account to link"
                                value={editingConfig.linked_account_id}
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

                    <div className="pt-4 flex items-center justify-between">
                        <p className={`text-sm ${message.includes("Error") ? "text-red-400" : "text-green-400"}`}>
                            {message}
                        </p>
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
