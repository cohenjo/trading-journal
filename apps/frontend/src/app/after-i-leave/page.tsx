'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';
import CollapsibleSection from '@/components/AfterILeave/CollapsibleSection';
import SummaryTable from '@/components/AfterILeave/SummaryTable';
import { Lang, translations } from '@/components/AfterILeave/translations';

async function fetchFinanceData(): Promise<FinanceItem[]> {
  try {
    const res = await fetch('/api/finances/latest');
    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.items || [];
  } catch {
    return [];
  }
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 pdf-light:text-blue-600 hover:text-blue-300 underline underline-offset-2"
    >
      {children} ↗
    </a>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-2 border-b border-slate-800/30 pdf-light:border-gray-100 last:border-0">
      <span className="text-slate-400 pdf-light:text-gray-500 font-medium sm:w-48 flex-shrink-0">
        {label}
      </span>
      <span className="text-slate-200 pdf-light:text-gray-800">{children}</span>
    </div>
  );
}

function DocumentsList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-slate-300 pdf-light:text-gray-700 text-sm">
          <span className="text-slate-500 mt-0.5">📄</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function DemoTag({ text }: { text?: string }) {
  return (
    <span className="inline-block bg-amber-500/20 text-amber-400 pdf-light:bg-amber-100 pdf-light:text-amber-700 text-xs font-bold px-2 py-0.5 rounded ms-2">
      {text || 'DEMO — Update with real data'}
    </span>
  );
}

export default function AfterILeavePage() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<FinanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lang, setLang] = useState<Lang>('en');

  useEffect(() => {
    fetchFinanceData().then((data) => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!contentRef.current || generating) return;
    setGenerating(true);

    const el = contentRef.current;
    el.classList.add('pdf-light-mode');

    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const date = new Date().toISOString().split('T')[0];

      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `after-i-leave-guide-${date}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            backgroundColor: '#ffffff',
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        })
        .from(el)
        .save();
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      el.classList.remove('pdf-light-mode');
      setGenerating(false);
    }
  }, [generating]);

  const lastUpdated = new Date().toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const t = translations[lang];

  return (
    <div className="min-h-screen bg-slate-950">
      {/* PDF light-mode style overrides */}
      <style>{`
        .pdf-light-mode { background: #ffffff !important; color: #1a1a1a !important; }
        .pdf-light-mode .pdf-light\\:bg-white { background: #ffffff !important; }
        .pdf-light-mode .pdf-light\\:bg-gray-50 { background: #f9fafb !important; }
        .pdf-light-mode .pdf-light\\:text-gray-900 { color: #111827 !important; }
        .pdf-light-mode .pdf-light\\:text-gray-800 { color: #1f2937 !important; }
        .pdf-light-mode .pdf-light\\:text-gray-700 { color: #374151 !important; }
        .pdf-light-mode .pdf-light\\:text-gray-600 { color: #4b5563 !important; }
        .pdf-light-mode .pdf-light\\:text-gray-500 { color: #6b7280 !important; }
        .pdf-light-mode .pdf-light\\:border-gray-200 { border-color: #e5e7eb !important; }
        .pdf-light-mode .pdf-light\\:border-gray-100 { border-color: #f3f4f6 !important; }
        .pdf-light-mode .pdf-light\\:bg-gray-200 { background: #e5e7eb !important; }
        .pdf-light-mode .pdf-light\\:text-blue-600 { color: #2563eb !important; }
        .pdf-light-mode .pdf-light\\:bg-amber-100 { background: #fef3c7 !important; }
        .pdf-light-mode .pdf-light\\:text-amber-600 { color: #d97706 !important; }
        .pdf-light-mode .pdf-light\\:text-amber-700 { color: #b45309 !important; }
        .pdf-light-mode .pdf-light\\:hover\\:bg-gray-50:hover { background: #f9fafb !important; }
        .pdf-light-mode .bg-slate-950,
        .pdf-light-mode .bg-slate-900 { background: #ffffff !important; }
        .pdf-light-mode .text-slate-100,
        .pdf-light-mode .text-slate-200 { color: #1f2937 !important; }
        .pdf-light-mode .text-slate-300 { color: #374151 !important; }
        .pdf-light-mode .text-slate-400,
        .pdf-light-mode .text-slate-500 { color: #6b7280 !important; }
        .pdf-light-mode .border-slate-800,
        .pdf-light-mode .border-slate-700 { border-color: #e5e7eb !important; }
        .pdf-light-mode .bg-slate-800,
        .pdf-light-mode .bg-slate-800\\/50,
        .pdf-light-mode .bg-slate-800\\/30,
        .pdf-light-mode .bg-slate-700 { background: #f3f4f6 !important; }
        .pdf-light-mode .text-blue-400 { color: #2563eb !important; }
        .pdf-light-mode .text-amber-400 { color: #d97706 !important; }
        .pdf-light-mode .text-emerald-400 { color: #059669 !important; }
        .pdf-light-mode .bg-blue-500\\/10 { background: #eff6ff !important; }
        .pdf-light-mode .bg-emerald-500\\/10 { background: #ecfdf5 !important; }
        .pdf-light-mode .bg-amber-500\\/10 { background: #fffbeb !important; }
        .pdf-light-mode .bg-amber-500\\/20 { background: #fef3c7 !important; }
        .pdf-light-mode .print-hidden { display: none !important; }
        .pdf-light-mode .max-h-0 { max-height: 5000px !important; opacity: 1 !important; }
      `}</style>

      <div ref={contentRef} dir={lang === 'he' ? 'rtl' : 'ltr'} className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* ─── Header ─── */}
        <header className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight">
                {t.header.title}
              </h1>
              <p className="mt-3 text-lg text-slate-400 leading-relaxed max-w-2xl">
                {t.header.subtitle}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {t.header.lastUpdated} {lastUpdated}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              {/* Language toggle */}
              <div className="print-hidden flex items-center rounded-lg border border-slate-700 overflow-hidden text-sm">
                <button
                  onClick={() => setLang('en')}
                  className={`px-3 py-2 transition-colors ${lang === 'en' ? 'bg-blue-600 text-white font-medium' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  🇬🇧 English
                </button>
                <button
                  onClick={() => setLang('he')}
                  className={`px-3 py-2 transition-colors ${lang === 'he' ? 'bg-blue-600 text-white font-medium' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  🇮🇱 עברית
                </button>
              </div>
              <button
                onClick={handleDownloadPdf}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
              >
                {generating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    {t.header.generating}
                  </>
                ) : (
                  <>{t.header.downloadPdf}</>
                )}
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          {/* ─── 1. Quick Summary Table ─── */}
          <CollapsibleSection
            emoji="📊"
            title={t.summary.title}
            subtitle={t.summary.subtitle}
          >
            {loading ? (
              <div className="py-8 text-center text-slate-400">{t.summary.loading}</div>
            ) : (
              <SummaryTable items={items} lang={lang} />
            )}
          </CollapsibleSection>

          {/* ─── 2. First Steps ─── */}
          <CollapsibleSection
            emoji="🫶"
            title={t.firstSteps.title}
            subtitle={t.firstSteps.subtitle}
          >
            <ol className="space-y-4">
              {t.firstSteps.steps.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-200 pdf-light:text-gray-800">{step.title}</p>
                    <p className="text-sm text-slate-400 pdf-light:text-gray-600 mt-1">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CollapsibleSection>

          {/* ─── 3. Detailed Sections ─── */}

          {/* 3a: Inheritance Order */}
          <CollapsibleSection
            emoji="⚖️"
            title={t.inheritance.title}
            subtitle={t.inheritance.subtitle}
          >
            <div className="space-y-3 text-sm">
              <InfoRow label={t.inheritance.labels.whatIsIt}>
                {t.inheritance.whatIsIt}
              </InfoRow>
              <InfoRow label={t.inheritance.labels.whereToApply}>
                <ExternalLink href="https://inheritance.justice.gov.il/RashamYerusha/">
                  {t.inheritance.whereToApply}
                </ExternalLink>
              </InfoRow>
              <InfoRow label={t.inheritance.labels.documentsNeeded}>
                {t.inheritance.documentsNeeded}
              </InfoRow>
              <InfoRow label={t.inheritance.labels.cost}>
                {t.inheritance.cost}
              </InfoRow>
              <InfoRow label={t.inheritance.labels.timeline}>
                {t.inheritance.timeline}
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 {lang === 'he' ? 'חשוב:' : 'Important:'}</strong> {t.inheritance.tip}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3b: Bituach Leumi */}
          <CollapsibleSection
            emoji="🏛️"
            title={t.bituachLeumi.title}
            subtitle={t.bituachLeumi.subtitle}
          >
            <div className="space-y-3 text-sm">
              <InfoRow label={t.bituachLeumi.labels.what}>
                {t.bituachLeumi.what}
              </InfoRow>
              <InfoRow label={t.bituachLeumi.labels.eligibility}>
                {t.bituachLeumi.eligibility}
              </InfoRow>
              <InfoRow label={t.bituachLeumi.labels.howToApply}>
                {t.bituachLeumi.howToApply}
              </InfoRow>
              <InfoRow label={t.bituachLeumi.labels.documents}>
                {t.bituachLeumi.documents}
              </InfoRow>
              <InfoRow label={t.bituachLeumi.labels.phone}>{t.bituachLeumi.phone}</InfoRow>
              <InfoRow label={t.bituachLeumi.labels.website}>
                <ExternalLink href="https://www.btl.gov.il">www.btl.gov.il</ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>⏰ {lang === 'he' ? 'דדליין:' : 'Deadline:'}</strong> {t.bituachLeumi.deadline}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3c: Life Insurance */}
          <CollapsibleSection
            emoji="🛡️"
            title={t.lifeInsurance.title}
            subtitle={t.lifeInsurance.subtitle}
          >
            <DemoTag text={t.lifeInsurance.demoTag} />
            <div className="space-y-3 text-sm mt-3">
              <InfoRow label={t.lifeInsurance.labels.provider}>{t.lifeInsurance.provider}</InfoRow>
              <InfoRow label={t.lifeInsurance.labels.sumInsured}>{t.lifeInsurance.sumInsured}</InfoRow>
              <InfoRow label={t.lifeInsurance.labels.process}>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  {t.lifeInsurance.processSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </InfoRow>
              <InfoRow label={t.lifeInsurance.labels.website}>
                <ExternalLink href="https://www.clalbit.co.il">www.clalbit.co.il</ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>📝 {lang === 'he' ? 'הערה:' : 'Note:'}</strong> {t.lifeInsurance.note}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3d: Mortgage Insurance */}
          <CollapsibleSection
            emoji="🏡"
            title={t.mortgageInsurance.title}
            subtitle={t.mortgageInsurance.subtitle}
          >
            <DemoTag text={t.mortgageInsurance.demoTag} />
            <div className="space-y-3 text-sm mt-3">
              <InfoRow label={t.mortgageInsurance.labels.provider}>{t.mortgageInsurance.provider}</InfoRow>
              <InfoRow label={t.mortgageInsurance.labels.whatItCovers}>
                {t.mortgageInsurance.whatItCovers}
              </InfoRow>
              <InfoRow label={t.mortgageInsurance.labels.process}>
                {t.mortgageInsurance.process}
              </InfoRow>
              <InfoRow label={t.mortgageInsurance.labels.documents}>
                {t.mortgageInsurance.documents}
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>📝 {lang === 'he' ? 'הערה:' : 'Note:'}</strong> {t.mortgageInsurance.note}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3e: Pension Funds */}
          <CollapsibleSection
            emoji="🏦"
            title={t.pension.title}
            subtitle={t.pension.subtitle}
          >
            <div className="space-y-3 text-sm">
              <InfoRow label={t.pension.labels.provider}>
                {t.pension.provider}
              </InfoRow>
              <InfoRow label={t.pension.labels.whatHappens}>
                {t.pension.whatHappens}
              </InfoRow>
              <InfoRow label={t.pension.labels.process}>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  {t.pension.processSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </InfoRow>
              <InfoRow label={t.pension.labels.timeline}>{t.pension.timeline}</InfoRow>
              <InfoRow label={t.pension.labels.website}>
                <ExternalLink href="https://www.clalbit.co.il/pension/clalpension/">
                  {lang === 'he' ? 'פורטל כלל פנסיה' : 'Clal Pension portal'}
                </ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 {lang === 'he' ? 'טיפ:' : 'Tip:'}</strong> {t.pension.tip}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3f: IBKR */}
          <CollapsibleSection
            emoji="📈"
            title={t.ibkr.title}
            subtitle={t.ibkr.subtitle}
          >
            <div className="space-y-3 text-sm">
              <InfoRow label={t.ibkr.labels.accountType}>{t.ibkr.accountType}</InfoRow>
              <InfoRow label={t.ibkr.labels.whatToDo}>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  {t.ibkr.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </InfoRow>
              <InfoRow label={t.ibkr.labels.contact}>
                <a href="mailto:estateprocessing@interactivebrokers.com" className="text-blue-400 pdf-light:text-blue-600 underline">
                  estateprocessing@interactivebrokers.com
                </a>
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 {lang === 'he' ? 'חשוב:' : 'Important:'}</strong> {t.ibkr.important}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3g: Bank Accounts */}
          <CollapsibleSection
            emoji="🏧"
            title={t.bankAccounts.title}
            subtitle={t.bankAccounts.subtitle}
          >
            <div className="space-y-3 text-sm">
              {items.filter((i) => i.category === 'Savings' && i.type !== 'Pension').length > 0 && (
                <div className="mb-3">
                  <p className="text-slate-400 pdf-light:text-gray-500 mb-2 font-medium">{t.bankAccounts.yourSavingsLabel}</p>
                  <ul className="space-y-1">
                    {items
                      .filter((i) => i.category === 'Savings' && i.type !== 'Pension')
                      .map((i) => (
                        <li key={i.id} className="flex justify-between text-slate-300 pdf-light:text-gray-700 py-1 border-b border-slate-800/30 pdf-light:border-gray-100">
                          <span>{i.name}</span>
                          <span className="font-mono" dir="ltr">
                            {new Intl.NumberFormat('en-IL', { style: 'currency', currency: i.currency || 'ILS' }).format(i.value)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <InfoRow label={t.bankAccounts.labels.generalProcess}>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  {t.bankAccounts.processSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </InfoRow>
              <div className="mt-3 p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <p className="text-emerald-300 pdf-light:text-emerald-700 text-sm">
                  <strong>💡 {lang === 'he' ? 'טיפ:' : 'Tip:'}</strong> {t.bankAccounts.tip}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3h: Government Resources */}
          <CollapsibleSection
            emoji="🇮🇱"
            title={t.government.title}
            subtitle={t.government.subtitle}
          >
            <div className="space-y-6 text-sm">
              <div>
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  {t.government.harBituach.title}
                </h3>
                <div className="space-y-2">
                  <InfoRow label={t.government.harBituach.labels.url}>
                    <ExternalLink href="https://harb.cma.gov.il/">harb.cma.gov.il</ExternalLink>
                  </InfoRow>
                  <InfoRow label={t.government.harBituach.labels.whatItDoes}>
                    {t.government.harBituach.whatItDoes}
                  </InfoRow>
                  <InfoRow label={t.government.harBituach.labels.howToUse}>
                    {t.government.harBituach.how}
                  </InfoRow>
                  <InfoRow label={t.government.harBituach.labels.shows}>
                    {t.government.harBituach.shows}
                  </InfoRow>
                  <p className="text-emerald-400 pdf-light:text-emerald-600 font-medium mt-1">{t.government.harBituach.freeOfficial}</p>
                </div>
              </div>

              <div className="border-t border-slate-800/50 pdf-light:border-gray-200 pt-5">
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  {t.government.harKesef.title}
                </h3>
                <div className="space-y-2">
                  <InfoRow label={t.government.harKesef.labels.url}>
                    <ExternalLink href="https://itur.mof.gov.il/home/shuk">itur.mof.gov.il</ExternalLink>
                  </InfoRow>
                  <InfoRow label={t.government.harKesef.labels.whatItDoes}>
                    {t.government.harKesef.whatItDoes}
                  </InfoRow>
                  <InfoRow label={t.government.harKesef.labels.shows}>
                    {t.government.harKesef.shows}
                  </InfoRow>
                  <InfoRow label={t.government.harKesef.labels.deceasedSearch}>
                    {t.government.harKesef.deceasedSearch}
                  </InfoRow>
                  <p className="text-emerald-400 pdf-light:text-emerald-600 font-medium mt-1">{t.government.harKesef.freeOfficial}</p>
                </div>
              </div>

              <div className="border-t border-slate-800/50 pdf-light:border-gray-200 pt-5">
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  {t.government.govIl.title}
                </h3>
                <div className="space-y-2">
                  <InfoRow label={t.government.govIl.labels.url}>
                    <ExternalLink href="https://www.gov.il/en/service/post-death-accompaniment">
                      gov.il
                    </ExternalLink>
                  </InfoRow>
                  <InfoRow label={t.government.govIl.labels.whatItDoes}>
                    {t.government.govIl.whatItDoes}
                  </InfoRow>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── 4. Important Documents Checklist ─── */}
          <CollapsibleSection
            emoji="📋"
            title={t.documents.title}
            subtitle={t.documents.subtitle}
          >
            <div className="space-y-3">
              {t.documents.items.map((doc, i) => (
                <label key={i} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 rounded border-slate-600 text-blue-500 focus:ring-blue-500/50 bg-slate-800"
                  />
                  <span className="text-slate-300 pdf-light:text-gray-700 group-hover:text-slate-100 transition-colors">
                    {doc}
                  </span>
                </label>
              ))}
            </div>
          </CollapsibleSection>

          {/* ─── 5. Important Contacts ─── */}
          <CollapsibleSection
            emoji="📞"
            title={t.contacts.title}
            subtitle={t.contacts.subtitle}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {t.contacts.roles.map((contact, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg bg-slate-800/50 pdf-light:bg-gray-50 border border-slate-700/50 pdf-light:border-gray-200"
                >
                  <p className="font-semibold text-slate-200 pdf-light:text-gray-800 text-sm">{contact.role}</p>
                  <p className="text-slate-400 pdf-light:text-gray-600 text-sm mt-1">{contact.name}</p>
                  <p className="text-slate-500 pdf-light:text-gray-500 text-xs mt-1" dir="ltr">
                    📱 {contact.phone} &nbsp;|&nbsp; ✉️ {contact.email}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* ─── Footer Note ─── */}
          <div className="mt-8 p-6 rounded-xl bg-slate-900/50 border border-slate-800/50 text-center">
            <p className="text-slate-400 pdf-light:text-gray-500 text-sm leading-relaxed">
              {t.footer.lines[0]}
              <br />
              {t.footer.lines[1]}
              <br />
              <span className="text-slate-500 text-xs mt-2 block">
                {t.footer.lines[2]}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
