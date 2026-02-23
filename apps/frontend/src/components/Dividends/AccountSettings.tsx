"use client";

import React, { useState, useEffect } from "react";
import DeleteConfirmationModal from "./DeleteConfirmationModal";

interface AccountSettingsProps {
    onAccountsChange: () => void;
}

export default function AccountSettings({ onAccountsChange }: AccountSettingsProps) {
    const [accounts, setAccounts] = useState<string[]>([]);
    const [importableAccounts, setImportableAccounts] = useState<any[]>([]);
    const [selectedImport, setSelectedImport] = useState<any>(null);
    const [newAccount, setNewAccount] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Delete Modal State
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; name: string | null }>({
        isOpen: false,
        name: null
    });
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchAccounts = async () => {
        try {
            const [accRes, impRes] = await Promise.all([
                fetch("/api/dividends/accounts"),
                fetch("/api/dividends/accounts/importable")
            ]);

            if (accRes.ok) {
                const data = await accRes.json();
                setAccounts(data);
            }
            if (impRes.ok) {
                const data = await impRes.json();
                setImportableAccounts(data);
            }
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleImportSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        if (!id) {
            setSelectedImport(null);
            setNewAccount("");
            return;
        }
        const item = importableAccounts.find(i => i.id === id);
        if (item) {
            setSelectedImport(item);
            setNewAccount(item.name);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAccount.trim()) return;
        setLoading(true);
        setError("");

        try {
            let res;
            if (selectedImport) {
                res = await fetch("/api/dividends/accounts/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        linked_id: selectedImport.id,
                        name: newAccount
                    })
                });
            } else {
                res = await fetch("/api/dividends/accounts?name=" + encodeURIComponent(newAccount), {
                    method: "POST"
                });
            }

            if (res.ok) {
                setNewAccount("");
                setSelectedImport(null);
                await fetchAccounts();
                onAccountsChange();
            } else {
                const data = await res.json();
                setError(data.detail || "Failed to add account");
            }
        } catch (err) {
            setError("Error adding account");
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = (name: string) => {
        setDeleteModal({ isOpen: true, name });
    };

    const executeDelete = async () => {
        if (!deleteModal.name) return;
        setIsDeleting(true);

        try {
            const res = await fetch(`/api/dividends/accounts/${encodeURIComponent(deleteModal.name)}`, {
                method: "DELETE"
            });

            if (res.ok) {
                await fetchAccounts();
                onAccountsChange();
                setDeleteModal({ isOpen: false, name: null });
            } else {
                const data = await res.json();
                alert(data.detail || "Failed to delete account");
            }
        } catch (err) {
            alert("Error deleting account");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="bg-slate-900 p-6 rounded-lg border border-slate-800 max-w-2xl">
            <h2 className="text-xl font-bold text-slate-100 mb-6">Account Settings</h2>

            <div className="mb-8 p-4 bg-slate-950/50 rounded-lg border border-slate-800">
                <h3 className="text-sm font-medium text-slate-300 mb-3 block">Add New Account</h3>

                <div className="mb-4">
                    <label className="text-xs text-slate-500 mb-1 block">Link from Current Finances (Optional)</label>
                    <select
                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                        onChange={handleImportSelect}
                        value={selectedImport?.id || ""}
                        aria-label="Link from Current Finances"
                    >
                        <option value="">-- None (Create Manual Account) --</option>
                        {importableAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.type})
                            </option>
                        ))}
                    </select>
                </div>

                <form onSubmit={handleAdd} className="flex gap-4">
                    <div className="flex-1">
                        <label htmlFor="new-account" className="sr-only">New Account Name</label>
                        <input
                            id="new-account"
                            type="text"
                            value={newAccount}
                            onChange={(e) => setNewAccount(e.target.value)}
                            placeholder="Enter account name..."
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {loading ? (selectedImport ? "Importing..." : "Adding...") : (selectedImport ? "Import Account" : "Add Account")}
                    </button>
                </form>
            </div>

            {error && <div className="text-red-400 mb-4 text-sm">{error}</div>}

            <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Active Accounts</h3>
                {accounts.length === 0 ? (
                    <div className="text-slate-500 italic">No accounts found.</div>
                ) : (
                    accounts.map(acc => (
                        <div key={acc} className="flex justify-between items-center bg-slate-950 p-4 rounded-lg border border-slate-800">
                            <span className="text-slate-200 font-medium">{acc}</span>
                            <button
                                onClick={() => confirmDelete(acc)}
                                className="text-slate-500 hover:text-red-400 p-2 transition-colors"
                                title="Delete Account"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    ))
                )}
            </div>

            <DeleteConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
                onConfirm={executeDelete}
                title="Delete Account"
                message={`Are you sure you want to delete account "${deleteModal.name}"? This action cannot be undone.`}
                isDeleting={isDeleting}
            />
        </div>
    );
}
