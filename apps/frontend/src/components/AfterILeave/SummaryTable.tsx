'use client';

import React from 'react';
import { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';
import { formatCurrency } from '@/lib/currency';
import { Lang, translations } from './translations';

interface InsurancePolicyRow {
  id?: string;
  type: string;
  provider: string;
  sum_insured?: string;
  owner: string;
  notes?: string;
}

interface DemoInsuranceItem {
  name: string;
  institution: string;
  type: string;
  value: string;
  owner: string;
  notes: string;
  isDemo: boolean;
}

function getDemoInsurance(lang: Lang): DemoInsuranceItem[] {
  const d = translations[lang].summary.demoItems;
  return [
    { name: d.lifeInsurance.name, institution: d.lifeInsurance.institution, type: 'Life Insurance', value: d.lifeInsurance.value, owner: 'Jony', notes: d.lifeInsurance.notes, isDemo: true },
    { name: d.mortgageInsurance.name, institution: d.mortgageInsurance.institution, type: 'Mortgage Insurance', value: d.mortgageInsurance.value, owner: 'Joint', notes: d.mortgageInsurance.notes, isDemo: true },
    { name: d.healthInsurance.name, institution: d.healthInsurance.institution, type: 'Health', value: '—', owner: 'Joint', notes: d.healthInsurance.notes, isDemo: true },
    { name: d.carInsurance.name, institution: d.carInsurance.institution, type: 'Vehicle', value: '—', owner: 'Joint', notes: d.carInsurance.notes, isDemo: true },
  ];
}

function mapInsurancePoliciesToRows(policies: InsurancePolicyRow[]): GroupedRow[] {
  return policies.map((p) => ({
    category: 'Insurance',
    name: `${p.type} Insurance`,
    institution: p.provider,
    type: p.type,
    value: p.sum_insured || '—',
    owner: p.owner,
    notes: p.notes || '',
    isDemo: false,
  }));
}

const CATEGORY_ORDER = ['Insurance', 'Pension', 'Savings', 'Investments', 'Assets', 'Liabilities'] as const;

const CATEGORY_ICONS: Record<string, string> = {
  Insurance: '🛡️',
  Pension: '🏛️',
  Savings: '💰',
  Investments: '📈',
  Assets: '🏠',
  Liabilities: '💳',
};

interface GroupedRow {
  category: string;
  name: string;
  institution: string;
  type: string;
  value: string;
  owner: string;
  notes: string;
  isDemo: boolean;
}

function mapFinanceItems(items: FinanceItem[]): GroupedRow[] {
  return items.map((item) => {
    let category = item.category;
    if (item.type === 'Pension') category = 'Pension' as FinanceItem['category'];

    return {
      category,
      name: item.name,
      institution: item.details?.managing_body || item.details?.institution || '—',
      type: item.type,
      value: formatCurrency(item.value, item.currency || 'ILS', true),
      owner: item.owner || '—',
      notes: '',
      isDemo: false,
    };
  });
}

export default function SummaryTable({ items, insurancePolicies = [], lang = 'en' }: { items: FinanceItem[]; insurancePolicies?: InsurancePolicyRow[]; lang?: Lang }) {
  const t = translations[lang].summary;
  const financeRows = mapFinanceItems(items);

  // Use real insurance data when available, fall back to demo
  const insuranceRows: GroupedRow[] = insurancePolicies.length > 0
    ? mapInsurancePoliciesToRows(insurancePolicies)
    : getDemoInsurance(lang).map((d) => ({
        category: 'Insurance',
        ...d,
      }));

  const allRows = [...insuranceRows, ...financeRows];

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    rows: allRows.filter((r) => r.category === cat),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 pdf-light:border-gray-200">
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium">{t.columns.category}</th>
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium">{t.columns.name}</th>
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium hidden md:table-cell">{t.columns.institution}</th>
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium hidden lg:table-cell">{t.columns.type}</th>
            <th className="text-end py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium">{t.columns.value}</th>
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium hidden md:table-cell">{t.columns.owner}</th>
            <th className="text-start py-3 px-3 text-slate-400 pdf-light:text-gray-500 font-medium hidden lg:table-cell">{t.columns.notes}</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((group) => (
            <React.Fragment key={group.category}>
              <tr className="bg-slate-800/50 pdf-light:bg-gray-50">
                <td
                  colSpan={7}
                  className="py-2 px-3 text-sm font-semibold text-slate-300 pdf-light:text-gray-700"
                >
                  {CATEGORY_ICONS[group.category] || '📋'} {t.categories[group.category] || group.category}
                </td>
              </tr>
              {group.rows.map((row, idx) => (
                <tr
                  key={`${group.category}-${idx}`}
                  className="border-b border-slate-800/50 pdf-light:border-gray-100 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="py-2.5 px-3">
                    <span className="text-lg">{CATEGORY_ICONS[row.category]}</span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-200 pdf-light:text-gray-800 font-medium">
                    {row.name}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 pdf-light:text-gray-600 hidden md:table-cell">
                    {row.institution}
                  </td>
                  <td className="py-2.5 px-3 hidden lg:table-cell">
                    <span className="text-xs bg-slate-700 pdf-light:bg-gray-200 text-slate-300 pdf-light:text-gray-600 px-2 py-0.5 rounded">
                      {row.type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-end text-slate-200 pdf-light:text-gray-800 font-mono">
                    {row.value}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 pdf-light:text-gray-600 hidden md:table-cell">
                    {row.owner}
                  </td>
                  <td className="py-2.5 px-3 hidden lg:table-cell">
                    {row.isDemo ? (
                      <span className="text-xs text-amber-400 pdf-light:text-amber-600 font-medium">
                        {row.notes}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">{row.notes}</span>
                    )}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
