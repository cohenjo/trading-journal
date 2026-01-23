'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ProgressSummary } from './AddHistoryModal';

interface ProgressTableProps {
  data: ProgressSummary[];
  onEdit: (item: ProgressSummary) => void;
  onDelete: (date: string) => void;
}

const formatMoney = (val: number) => new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD', 
    compactDisplay: 'short',
    maximumFractionDigits: 0 
}).format(val);

const ActionMenu: React.FC<{ 
    item: ProgressSummary; 
    onEdit: () => void;
    onDelete: () => void;
}> = ({ onEdit, onDelete }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={menuRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            >
                {/* Vertical 3 dots icon */}
                <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="2" cy="2" r="2" />
                    <circle cx="2" cy="8" r="2" />
                    <circle cx="2" cy="14" r="2" />
                </svg>
            </button>
            
            {isOpen && (
                <div className="absolute right-0 mt-1 w-32 bg-slate-800 border border-slate-700 rounded-md shadow-lg z-50 overflow-hidden">
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                        onClick={() => { setIsOpen(false); onEdit(); }}
                    >
                        Edit
                    </button>
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors"
                        onClick={() => { setIsOpen(false); onDelete(); }}
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
};

export const ProgressTable: React.FC<ProgressTableProps> = ({ data, onEdit, onDelete }) => {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 min-h-[400px]">
      <table className="w-full text-left bg-slate-900 border-collapse">
        <thead>
          <tr className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
            <th className="p-4 font-semibold">Date</th>
            <th className="p-4 font-semibold text-right">Net Worth</th>
            <th className="p-4 font-semibold text-right">Assets</th>
            <th className="p-4 font-semibold text-right">Liabilities</th>
            <th className="p-4 font-semibold text-right text-blue-400">Savings</th>
            <th className="p-4 font-semibold text-right text-cyan-400">Investments</th>
            <th className="p-4 font-semibold text-center w-[80px]">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data.map((row) => (
            <tr key={row.date} className="hover:bg-slate-800/50 transition-colors group">
              <td className="p-4 text-slate-300 font-medium whitespace-nowrap">{row.date}</td>
              <td className="p-4 text-right font-bold text-slate-100">{formatMoney(row.net_worth)}</td>
              <td className="p-4 text-right text-slate-300">{formatMoney(row.total_assets)}</td>
              <td className="p-4 text-right text-red-400">{formatMoney(row.total_liabilities)}</td>
              <td className="p-4 text-right text-blue-300">{formatMoney(row.total_savings)}</td>
              <td className="p-4 text-right text-cyan-300">{formatMoney(row.total_investments)}</td>
              <td className="p-2 text-center">
                  <ActionMenu 
                    item={row}
                    onEdit={() => onEdit(row)}
                    onDelete={() => onDelete(row.date)}
                  />
              </td>
            </tr>
          ))}
          {data.length === 0 && (
             <tr>
                 <td colSpan={7} className="p-8 text-center text-slate-500">No history available</td>
             </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
