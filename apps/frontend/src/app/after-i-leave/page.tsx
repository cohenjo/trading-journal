'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';
import CollapsibleSection from '@/components/AfterILeave/CollapsibleSection';
import SummaryTable from '@/components/AfterILeave/SummaryTable';

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

function DemoTag() {
  return (
    <span className="inline-block bg-amber-500/20 text-amber-400 pdf-light:bg-amber-100 pdf-light:text-amber-700 text-xs font-bold px-2 py-0.5 rounded ml-2">
      DEMO — Update with real data
    </span>
  );
}

export default function AfterILeavePage() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<FinanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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

  const lastUpdated = new Date().toLocaleDateString('en-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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

      <div ref={contentRef} className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* ─── Header ─── */}
        <header className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight">
                After I Leave — Financial Guide
              </h1>
              <p className="mt-3 text-lg text-slate-400 leading-relaxed max-w-2xl">
                Everything you need to know about our finances, accounts, and how to access them.
                Take it one step at a time — there&apos;s no rush.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Last updated: {lastUpdated}
              </p>
            </div>
            <button
              onClick={handleDownloadPdf}
              disabled={generating}
              className="print-hidden flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
            >
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                <>📥 Download as PDF</>
              )}
            </button>
          </div>
        </header>

        <div className="space-y-6">
          {/* ─── 1. Quick Summary Table ─── */}
          <CollapsibleSection
            emoji="📊"
            title="Quick Financial Summary"
            subtitle="All accounts, investments, and insurance at a glance"
          >
            {loading ? (
              <div className="py-8 text-center text-slate-400">Loading financial data…</div>
            ) : (
              <SummaryTable items={items} />
            )}
          </CollapsibleSection>

          {/* ─── 2. First Steps ─── */}
          <CollapsibleSection
            emoji="🫶"
            title="First Steps — What to Do Right Away"
            subtitle="A gentle guide for the first days and weeks"
          >
            <ol className="space-y-4">
              {[
                {
                  title: "Don't rush — take your time to grieve",
                  desc: 'There is no deadline on grief. Financial matters can wait a few weeks. Lean on family and friends.',
                },
                {
                  title: 'Gather essential documents',
                  desc: 'ID cards (תעודות זהות), marriage certificate (תעודת נישואין), death certificate (תעודת פטירה) — get multiple certified copies.',
                },
                {
                  title: 'Contact our lawyer and accountant',
                  desc: 'See the contacts section below. They can guide you through the legal and tax processes.',
                },
                {
                  title: 'Apply for Bituach Leumi survivors\' pension (קצבת שארים)',
                  desc: 'This provides a monthly income. See the dedicated section below for how to apply.',
                },
                {
                  title: 'Check הר הביטוח and הר הכסף for the complete picture',
                  desc: 'These free government tools show ALL insurance policies and pension funds registered under an ID number. See the Government Resources section.',
                },
                {
                  title: 'Begin insurance claims — life insurance first',
                  desc: 'Life insurance is typically the largest payout. Start this process early as it takes 30-60 days.',
                },
              ].map((step, i) => (
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
            title="Inheritance Order (צו ירושה)"
            subtitle="The legal document you need for almost everything — start this first"
          >
            <div className="space-y-3 text-sm">
              <InfoRow label="What is it">
                A court order that proves you are the legal heir. It is required by banks, pension funds, and insurance companies to release funds.
              </InfoRow>
              <InfoRow label="Where to apply">
                <ExternalLink href="https://inheritance.justice.gov.il/RashamYerusha/">
                  Registrar of Inheritance online portal
                </ExternalLink>
              </InfoRow>
              <InfoRow label="Documents needed">
                Death certificate, your ID, marriage certificate, two witness affidavits declaring the heirs
              </InfoRow>
              <InfoRow label="Cost">
                ~₪507 online application fee + ₪66 publication fee
              </InfoRow>
              <InfoRow label="Timeline">
                2-3 months for straightforward cases (no disputes)
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 Important:</strong> This document is needed for almost everything. Start this process as soon as possible.
                  If we have a will, the process is called &quot;probate&quot; (צו קיום צוואה) — similar process but verifies the will.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3b: Bituach Leumi */}
          <CollapsibleSection
            emoji="🏛️"
            title="Bituach Leumi — Survivors' Pension (ביטוח לאומי — קצבת שארים)"
            subtitle="Monthly income from National Insurance"
          >
            <div className="space-y-3 text-sm">
              <InfoRow label="What">
                Monthly pension paid to the surviving spouse from the National Insurance Institute.
              </InfoRow>
              <InfoRow label="Eligibility">
                Automatic for a married spouse — no minimum contribution period required.
              </InfoRow>
              <InfoRow label="How to apply">
                File a claim at your local Bituach Leumi branch, or online through the website.
              </InfoRow>
              <InfoRow label="Documents needed">
                Death certificate, marriage certificate, both IDs, bank details for payments
              </InfoRow>
              <InfoRow label="Phone">*6050</InfoRow>
              <InfoRow label="Website">
                <ExternalLink href="https://www.btl.gov.il">www.btl.gov.il</ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>⏰ Deadline:</strong> Submit within 12 months of the date of death to receive full retroactive payments.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3c: Life Insurance */}
          <CollapsibleSection
            emoji="🛡️"
            title="Life Insurance Claims (ביטוח חיים)"
            subtitle="Claiming the life insurance payout"
          >
            <DemoTag />
            <div className="space-y-3 text-sm mt-3">
              <InfoRow label="Provider">Clal Insurance (כלל ביטוח)</InfoRow>
              <InfoRow label="Sum insured">₪2,000,000</InfoRow>
              <InfoRow label="Process">
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  <li>Call Clal customer service or visit their website</li>
                  <li>Request and fill the claim form (טופס תביעה) — download from their site</li>
                  <li>Submit with: death certificate, your ID, policy number, marriage certificate, bank account details</li>
                  <li>If no named beneficiary on the policy — you&apos;ll need the inheritance order</li>
                  <li>Processing: 30-60 days after all documents are submitted</li>
                </ol>
              </InfoRow>
              <InfoRow label="Website">
                <ExternalLink href="https://www.clalbit.co.il">www.clalbit.co.il</ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>📝 Note:</strong> Update this section with the real policy number, exact coverage amount, and beneficiary details.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3d: Mortgage Insurance */}
          <CollapsibleSection
            emoji="🏡"
            title="Mortgage Insurance (ביטוח משכנתא)"
            subtitle="Covers the remaining mortgage balance"
          >
            <DemoTag />
            <div className="space-y-3 text-sm mt-3">
              <InfoRow label="Provider">Migdal (מגדל)</InfoRow>
              <InfoRow label="What it covers">
                Pays off the remaining mortgage balance in full. You won&apos;t owe any more mortgage payments.
              </InfoRow>
              <InfoRow label="Process">
                Contact both Migdal (the insurer) and the mortgage bank. They will coordinate the payoff.
              </InfoRow>
              <InfoRow label="Documents needed">
                Death certificate, mortgage account details, policy number, your ID
              </InfoRow>
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <p className="text-amber-300 pdf-light:text-amber-700 text-sm">
                  <strong>📝 Note:</strong> Update this section with the real policy number and mortgage bank details.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3e: Pension Funds */}
          <CollapsibleSection
            emoji="🏦"
            title="Pension Funds (קרנות פנסיה)"
            subtitle="Survivors' pension — ongoing monthly payments"
          >
            <div className="space-y-3 text-sm">
              <InfoRow label="Provider">
                Clal Pension (from existing financial data)
              </InfoRow>
              <InfoRow label="What happens">
                The surviving spouse receives a survivors&apos; pension — monthly payments based on the accumulated pension.
              </InfoRow>
              <InfoRow label="Process">
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  <li>Contact Clal Pension fund directly</li>
                  <li>Submit a claim form with: death certificate, marriage certificate, IDs, inheritance order</li>
                  <li>Notify the employer — request Form 161 (טופס 161) which details pension contributions</li>
                </ol>
              </InfoRow>
              <InfoRow label="Timeline">Submit within 12 months</InfoRow>
              <InfoRow label="Website">
                <ExternalLink href="https://www.clalbit.co.il/pension/clalpension/">
                  Clal Pension portal
                </ExternalLink>
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 Tip:</strong> Check if there&apos;s a lump sum component (מענק) in addition to the monthly pension.
                  Some policies allow a one-time withdrawal alongside the ongoing payments.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3f: IBKR */}
          <CollapsibleSection
            emoji="📈"
            title="Investments — Interactive Brokers (IBKR)"
            subtitle="International brokerage account — stocks, bonds, and options"
          >
            <div className="space-y-3 text-sm">
              <InfoRow label="Account type">Individual (non-US resident)</InfoRow>
              <InfoRow label="What to do">
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  <li>
                    Email{' '}
                    <a href="mailto:estateprocessing@interactivebrokers.com" className="text-blue-400 pdf-light:text-blue-600 underline">
                      estateprocessing@interactivebrokers.com
                    </a>{' '}
                    with the account number
                  </li>
                  <li>Subject line: &quot;Estate Processing&quot;</li>
                  <li>
                    Required documents: certified death certificate, your government ID, inheritance order
                    (Israeli צו ירושה with apostille), estate/probate court documents
                  </li>
                  <li>IBKR will freeze the account, then transfer assets to your name or liquidate to cash</li>
                  <li>Processing: 2-4 weeks after all documents are submitted</li>
                </ol>
              </InfoRow>
              <InfoRow label="Contact">
                <a href="mailto:estateprocessing@interactivebrokers.com" className="text-blue-400 pdf-light:text-blue-600 underline">
                  estateprocessing@interactivebrokers.com
                </a>
              </InfoRow>
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-300 pdf-light:text-blue-700 text-sm">
                  <strong>💡 Important:</strong> For non-US accounts, there is no &quot;Transfer on Death&quot; option.
                  Legal inheritance documents (צו ירושה) are required. The apostille authenticates the Israeli document for international use.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3g: Bank Accounts */}
          <CollapsibleSection
            emoji="🏧"
            title="Bank Accounts & Savings"
            subtitle="Israeli bank accounts and savings plans"
          >
            <div className="space-y-3 text-sm">
              {items.filter((i) => i.category === 'Savings' && i.type !== 'Pension').length > 0 && (
                <div className="mb-3">
                  <p className="text-slate-400 pdf-light:text-gray-500 mb-2 font-medium">Your savings accounts from the financial data:</p>
                  <ul className="space-y-1">
                    {items
                      .filter((i) => i.category === 'Savings' && i.type !== 'Pension')
                      .map((i) => (
                        <li key={i.id} className="flex justify-between text-slate-300 pdf-light:text-gray-700 py-1 border-b border-slate-800/30 pdf-light:border-gray-100">
                          <span>{i.name}</span>
                          <span className="font-mono">
                            {new Intl.NumberFormat('en-IL', { style: 'currency', currency: i.currency || 'ILS' }).format(i.value)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <InfoRow label="General process">
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pdf-light:text-gray-700">
                  <li>Visit the bank branch with the death certificate and inheritance order</li>
                  <li>The bank will temporarily freeze the accounts</li>
                  <li>After the inheritance order is issued: transfer or merge accounts to your name</li>
                  <li>For joint accounts: show the death certificate — the surviving holder gets access</li>
                </ol>
              </InfoRow>
              <div className="mt-3 p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <p className="text-emerald-300 pdf-light:text-emerald-700 text-sm">
                  <strong>💡 Tip:</strong> Keep some cash accessible in a joint account for immediate living expenses.
                  Bank freezes on individual accounts can take weeks to resolve.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* 3h: Government Resources */}
          <CollapsibleSection
            emoji="🇮🇱"
            title="Government Resources"
            subtitle="Free official tools to find all insurance and savings"
          >
            <div className="space-y-6 text-sm">
              <div>
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  🛡️ הר הביטוח (Har HaBituach) — Insurance Mountain
                </h3>
                <div className="space-y-2">
                  <InfoRow label="URL">
                    <ExternalLink href="https://harb.cma.gov.il/">harb.cma.gov.il</ExternalLink>
                  </InfoRow>
                  <InfoRow label="What it does">
                    Shows ALL insurance policies registered under a person&apos;s ID number — from ALL insurance companies.
                  </InfoRow>
                  <InfoRow label="How to use">
                    Login with Teudat Zehut (ID number) + issue date.
                  </InfoRow>
                  <InfoRow label="Shows">
                    Life insurance, health insurance, car insurance, home insurance — everything.
                  </InfoRow>
                  <p className="text-emerald-400 pdf-light:text-emerald-600 font-medium mt-1">✅ Free and official!</p>
                </div>
              </div>

              <div className="border-t border-slate-800/50 pdf-light:border-gray-200 pt-5">
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  💰 הר הכסף (Har HaKesef) — Money Mountain
                </h3>
                <div className="space-y-2">
                  <InfoRow label="URL">
                    <ExternalLink href="https://itur.mof.gov.il/home/shuk">itur.mof.gov.il</ExternalLink>
                  </InfoRow>
                  <InfoRow label="What it does">
                    Finds ALL pension funds, savings plans, dormant bank accounts registered under a person&apos;s identity.
                  </InfoRow>
                  <InfoRow label="Shows">
                    Pension funds, provident funds (קופות גמל), education funds (קרנות השתלמות), inactive bank accounts.
                  </InfoRow>
                  <InfoRow label="Deceased search">
                    You can search for a deceased person&apos;s funds with proper documentation.
                  </InfoRow>
                  <p className="text-emerald-400 pdf-light:text-emerald-600 font-medium mt-1">✅ Free and official!</p>
                </div>
              </div>

              <div className="border-t border-slate-800/50 pdf-light:border-gray-200 pt-5">
                <h3 className="font-semibold text-slate-200 pdf-light:text-gray-800 mb-2">
                  🏛️ Gov.il Post-Death Portal
                </h3>
                <div className="space-y-2">
                  <InfoRow label="URL">
                    <ExternalLink href="https://www.gov.il/en/service/post-death-accompaniment">
                      gov.il — Post-Death Accompaniment
                    </ExternalLink>
                  </InfoRow>
                  <InfoRow label="What it does">
                    Centralized government guidance for all death-related procedures, step by step.
                  </InfoRow>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── 4. Important Documents Checklist ─── */}
          <CollapsibleSection
            emoji="📋"
            title="Important Documents Checklist"
            subtitle="Gather these documents — you'll need them repeatedly"
          >
            <div className="space-y-3">
              {[
                'Death certificate (תעודת פטירה) — get multiple certified copies (at least 5)',
                'Marriage certificate (תעודת נישואין)',
                'Both ID cards (תעודות זהות)',
                'Inheritance order (צו ירושה) — apply ASAP, takes 2-3 months',
                'Bank account details (voided check or bank letter)',
                'All insurance policy numbers',
                'Employment Form 161 (טופס 161) — request from employer',
                'Attorney affidavit listing dependents (תצהיר עורך דין)',
              ].map((doc, i) => (
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
            title="Important Contacts"
            subtitle="People and services to reach out to"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { role: 'Lawyer (עורך דין)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
                { role: 'Accountant (רואה חשבון)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
                { role: 'Insurance Agent (סוכן ביטוח)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
                { role: 'Bank Contact', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
                { role: 'Bituach Leumi', name: 'National Insurance Institute', phone: '*6050', email: 'btl.gov.il' },
              ].map((contact, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg bg-slate-800/50 pdf-light:bg-gray-50 border border-slate-700/50 pdf-light:border-gray-200"
                >
                  <p className="font-semibold text-slate-200 pdf-light:text-gray-800 text-sm">{contact.role}</p>
                  <p className="text-slate-400 pdf-light:text-gray-600 text-sm mt-1">{contact.name}</p>
                  <p className="text-slate-500 pdf-light:text-gray-500 text-xs mt-1">
                    📱 {contact.phone} &nbsp;|&nbsp; ✉️ {contact.email}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* ─── Footer Note ─── */}
          <div className="mt-8 p-6 rounded-xl bg-slate-900/50 border border-slate-800/50 text-center">
            <p className="text-slate-400 pdf-light:text-gray-500 text-sm leading-relaxed">
              💙 This guide is here to help, not to worry you. It&apos;s just a map — so you know where to go if you ever need it.
              <br />
              Review it once, make sure the contacts and policy numbers are up to date, and then put it away.
              <br />
              <span className="text-slate-500 text-xs mt-2 block">
                Remember: you can always ask our lawyer or accountant for help navigating any of these steps.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
