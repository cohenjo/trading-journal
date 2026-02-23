"use client";

import DividendDashboard from "../../components/Dividends/DividendDashboard";

export default function DividendsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Dividend Dashboard</h1>
      <DividendDashboard />
    </div>
  );
}
