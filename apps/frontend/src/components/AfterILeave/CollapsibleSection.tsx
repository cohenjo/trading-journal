'use client';

import React, { useState } from 'react';

interface CollapsibleSectionProps {
  emoji: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  printOpen?: boolean;
}

export default function CollapsibleSection({
  emoji,
  title,
  subtitle,
  defaultOpen = true,
  children,
  printOpen = true,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-slate-900 pdf-light:bg-white rounded-xl border border-slate-800 pdf-light:border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-slate-800/50 pdf-light:hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <h2 className="text-lg font-semibold text-slate-100 pdf-light:text-gray-900">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-slate-400 pdf-light:text-gray-500 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform duration-200 print-hidden ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`transition-all duration-300 ${
          open ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
        } ${printOpen ? 'print-force-open' : ''}`}
      >
        <div className="px-6 pb-6 border-t border-slate-800/50 pdf-light:border-gray-100 pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}
