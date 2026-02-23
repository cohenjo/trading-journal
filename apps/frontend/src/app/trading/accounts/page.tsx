"use client";

import React, { useState, useEffect } from "react";
import TradingAccountSettings from "@/components/trading/TradingAccountSettings";
import TradingAccountDashboard from "@/components/trading/TradingAccountDashboard";

export default function TradingAccountsPage() {
    const [activeTab, setActiveTab] = useState("IBKR");
    const [loading, setLoading] = useState(false);

    const tabs = ["IBKR", "Settings"];

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-8 text-slate-100">Trading Accounts</h1>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1">
                    {tabs.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === tab
                                ? "bg-slate-800 text-white shadow-sm"
                                : "text-slate-400 hover:text-slate-200"
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === "Settings" ? (
                <TradingAccountSettings />
            ) : (
                <TradingAccountDashboard />
            )}
        </div>
    );
}
