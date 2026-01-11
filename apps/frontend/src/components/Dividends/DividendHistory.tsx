"use client";

import { useState, useEffect } from "react";

export type DividendRecord = {
  year: number;
  amount: number;
};

type DividendHistoryProps = {
  initialData: DividendRecord[];
  onSave: (data: DividendRecord[]) => void;
};

export default function DividendHistory({ initialData, onSave }: DividendHistoryProps) {
  const [records, setRecords] = useState<DividendRecord[]>(initialData);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newAmount, setNewAmount] = useState<number>(0);

  useEffect(() => {
    setRecords(initialData);
  }, [initialData]);

  const handleAdd = () => {
    if (records.some((r) => r.year === newYear)) {
      alert("Year already exists");
      return;
    }
    const updated = [...records, { year: newYear, amount: newAmount }].sort((a, b) => a.year - b.year);
    setRecords(updated);
    onSave(updated);
  };

  const handleDelete = (year: number) => {
    const updated = records.filter((r) => r.year !== year);
    setRecords(updated);
    onSave(updated);
  };

  const handleUpdate = (year: number, amount: number) => {
      const updated = records.map(r => r.year === year ? { ...r, amount } : r);
      setRecords(updated);
      onSave(updated);
  }

  return (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
      <h3 className="text-lg font-semibold mb-4 text-slate-200">Historical Dividends</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="text-xs text-slate-400 uppercase bg-slate-800">
            <tr>
              <th className="px-4 py-2">Year</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.year} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="px-4 py-2">{record.year}</td>
                <td className="px-4 py-2">
                    <input 
                        type="number" 
                        value={record.amount} 
                        onChange={(e) => handleUpdate(record.year, parseFloat(e.target.value))}
                        className="bg-transparent border-none focus:ring-0 w-full"
                    />
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleDelete(record.year)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr className="bg-slate-800/30">
              <td className="px-4 py-2">
                <input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(parseInt(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-20 text-slate-200"
                />
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(parseFloat(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-full text-slate-200"
                />
              </td>
              <td className="px-4 py-2">
                <button
                  onClick={handleAdd}
                  className="text-blue-400 hover:text-blue-300 font-medium"
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
