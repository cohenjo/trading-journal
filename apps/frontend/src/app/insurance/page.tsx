'use client';
import { apiFetch } from '@/lib/api-client';

import React, { useState, useEffect, useCallback } from 'react';

// --- i18n ---
type Lang = 'en' | 'he';

const t = {
  en: {
    title: 'Insurance Policies',
    subtitle: 'Manage all your insurance policies in one place.',
    addPolicy: '+ Add Policy',
    editPolicy: 'Edit Policy',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    confirmDelete: 'Delete this policy?',
    noPolicies: 'No insurance policies yet. Add one to get started.',
    form: {
      type: 'Type',
      provider: 'Provider',
      policyNumber: 'Policy Number',
      sumInsured: 'Sum Insured',
      monthlyPremium: 'Monthly Premium',
      beneficiaries: 'Beneficiaries',
      expiryDate: 'Expiry Date',
      website: 'Website',
      notes: 'Notes',
      owner: 'Owner',
    },
    types: {
      Life: 'Life',
      Mortgage: 'Mortgage',
      Health: 'Health',
      Disability: 'Disability',
      Other: 'Other',
    },
    owners: { You: 'You', Partner: 'Partner' },
    placeholders: {
      provider: 'e.g. Clal, Migdal, Harel',
      policyNumber: 'Optional',
      sumInsured: 'e.g. ₪2,000,000 or "Covers remaining mortgage"',
      monthlyPremium: 'Optional',
      beneficiaries: 'Optional',
      website: 'https://…',
      notes: 'Optional notes',
    },
    table: {
      type: 'Type',
      provider: 'Provider',
      sumInsured: 'Sum Insured',
      premium: 'Premium',
      owner: 'Owner',
      actions: '',
    },
  },
  he: {
    title: 'פוליסות ביטוח',
    subtitle: 'ניהול כל פוליסות הביטוח במקום אחד.',
    addPolicy: '+ הוסף פוליסה',
    editPolicy: 'עריכת פוליסה',
    cancel: 'ביטול',
    save: 'שמור',
    saving: 'שומר…',
    delete: 'מחק',
    confirmDelete: 'למחוק את הפוליסה?',
    noPolicies: 'עדיין אין פוליסות ביטוח. הוסף אחת כדי להתחיל.',
    form: {
      type: 'סוג',
      provider: 'ספק',
      policyNumber: 'מספר פוליסה',
      sumInsured: 'סכום מבוטח',
      monthlyPremium: 'פרמיה חודשית',
      beneficiaries: 'מוטבים',
      expiryDate: 'תאריך תפוגה',
      website: 'אתר',
      notes: 'הערות',
      owner: 'בעלות',
    },
    types: {
      Life: 'חיים',
      Mortgage: 'משכנתא',
      Health: 'בריאות',
      Disability: 'אובדן כושר עבודה',
      Other: 'אחר',
    },
    owners: { You: 'שלך', Partner: 'בן/בת זוג' },
    placeholders: {
      provider: 'למשל כלל, מגדל, הראל',
      policyNumber: 'אופציונלי',
      sumInsured: 'למשל ₪2,000,000 או "מכסה יתרת משכנתא"',
      monthlyPremium: 'אופציונלי',
      beneficiaries: 'אופציונלי',
      website: 'https://…',
      notes: 'הערות אופציונליות',
    },
    table: {
      type: 'סוג',
      provider: 'ספק',
      sumInsured: 'סכום',
      premium: 'פרמיה',
      owner: 'בעלות',
      actions: '',
    },
  },
};

// --- Types ---
const POLICY_TYPES = ['Life', 'Mortgage', 'Health', 'Disability', 'Other'] as const;
type PolicyType = (typeof POLICY_TYPES)[number];

interface InsurancePolicy {
  id?: string;
  type: PolicyType;
  provider: string;
  policy_number?: string;
  sum_insured?: string;
  monthly_premium?: number | null;
  beneficiaries?: string;
  expiry_date?: string;
  website?: string;
  notes?: string;
  owner: string;
}

const emptyForm: InsurancePolicy = {
  type: 'Life',
  provider: '',
  policy_number: '',
  sum_insured: '',
  monthly_premium: null,
  beneficiaries: '',
  expiry_date: '',
  website: '',
  notes: '',
  owner: 'You',
};

// --- Component ---
export default function InsurancePage() {
  const [lang, setLang] = useState<Lang>('en');
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InsurancePolicy>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = t[lang];

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await apiFetch('/api/insurance');
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setPolicies(data.data || []);
        }
      }
    } catch {
      // API not available yet — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const openNew = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (p: InsurancePolicy) => {
    setForm({ ...p });
    setEditingId(p.id || null);
    setShowForm(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.provider.trim()) {
      setError('Provider is required.');
      return;
    }
    setSaving(true);
    setError(null);

    const body = {
      ...form,
      monthly_premium: form.monthly_premium || null,
    };

    try {
      const url = editingId ? `/api/insurance/${editingId}` : '/api/insurance';
      const method = editingId ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      setShowForm(false);
      setEditingId(null);
      await fetchPolicies();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(labels.confirmDelete)) return;
    try {
      await apiFetch(`/api/insurance/${id}`, { method: 'DELETE' });
      await fetchPolicies();
    } catch {
      // silent
    }
  };

  const isRtl = lang === 'he';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 pb-24" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{labels.title}</h1>
            <p className="text-slate-400 mt-1">{labels.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Lang toggle */}
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'he' : 'en')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              {lang === 'en' ? 'עברית' : 'English'}
            </button>
            <button
              type="button"
              onClick={openNew}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              {labels.addPolicy}
            </button>
          </div>
        </header>

        {/* Form modal */}
        {showForm && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-white">
              {editingId ? labels.editPolicy : labels.addPolicy}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.type}</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as PolicyType })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {POLICY_TYPES.map((pt) => (
                      <option key={pt} value={pt}>
                        {labels.types[pt]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Provider */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.provider}</label>
                  <input
                    type="text"
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    placeholder={labels.placeholders.provider}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                {/* Policy Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.policyNumber}</label>
                  <input
                    type="text"
                    value={form.policy_number || ''}
                    onChange={(e) => setForm({ ...form, policy_number: e.target.value })}
                    placeholder={labels.placeholders.policyNumber}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Sum Insured */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.sumInsured}</label>
                  <input
                    type="text"
                    value={form.sum_insured || ''}
                    onChange={(e) => setForm({ ...form, sum_insured: e.target.value })}
                    placeholder={labels.placeholders.sumInsured}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Monthly Premium */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.monthlyPremium}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.monthly_premium ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        monthly_premium: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder={labels.placeholders.monthlyPremium}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Beneficiaries */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.beneficiaries}</label>
                  <input
                    type="text"
                    value={form.beneficiaries || ''}
                    onChange={(e) => setForm({ ...form, beneficiaries: e.target.value })}
                    placeholder={labels.placeholders.beneficiaries}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Expiry Date */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.expiryDate}</label>
                  <input
                    type="date"
                    value={form.expiry_date || ''}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Website */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.website}</label>
                  <input
                    type="url"
                    value={form.website || ''}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder={labels.placeholders.website}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Owner */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.owner}</label>
                  <div className="flex gap-4 mt-1">
                    {(['You', 'Partner'] as const).map((o) => (
                      <label key={o} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="owner"
                          value={o}
                          checked={form.owner === o}
                          onChange={() => setForm({ ...form, owner: o })}
                          className="form-radio text-blue-500 focus:ring-blue-500 bg-slate-800 border-slate-700 h-4 w-4"
                        />
                        <span className="text-slate-200">{labels.owners[o]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes — full width */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{labels.form.notes}</label>
                <textarea
                  value={form.notes || ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={labels.placeholders.notes}
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {labels.cancel}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                    saving
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {saving ? labels.saving : labels.save}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Policies list */}
        {loading ? (
          <div className="text-slate-500 text-sm animate-pulse">Loading policies…</div>
        ) : policies.length === 0 && !showForm ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
            <p className="text-slate-400">{labels.noPolicies}</p>
          </div>
        ) : policies.length > 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-start py-3 px-4 text-slate-400 font-medium">{labels.table.type}</th>
                    <th className="text-start py-3 px-4 text-slate-400 font-medium">{labels.table.provider}</th>
                    <th className="text-start py-3 px-4 text-slate-400 font-medium hidden md:table-cell">{labels.table.sumInsured}</th>
                    <th className="text-end py-3 px-4 text-slate-400 font-medium hidden md:table-cell">{labels.table.premium}</th>
                    <th className="text-start py-3 px-4 text-slate-400 font-medium hidden lg:table-cell">{labels.table.owner}</th>
                    <th className="text-end py-3 px-4 text-slate-400 font-medium">{labels.table.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                          {labels.types[p.type] || p.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-200 font-medium">{p.provider}</td>
                      <td className="py-3 px-4 text-slate-300 hidden md:table-cell">{p.sum_insured || '—'}</td>
                      <td className="py-3 px-4 text-end text-slate-300 font-mono hidden md:table-cell">
                        {p.monthly_premium ? `₪${p.monthly_premium.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-400 hidden lg:table-cell">
                        {labels.owners[p.owner as 'You' | 'Partner'] || p.owner}
                      </td>
                      <td className="py-3 px-4 text-end">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium me-3"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => p.id && handleDelete(p.id)}
                          className="text-red-400 hover:text-red-300 text-xs font-medium"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
