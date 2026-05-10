"use client";
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Ladder } from "@/components/Ladder/Ladder";
import { ExpectedIncomeChart } from "@/components/Ladder/ExpectedIncomeChart";
import type { RungData, IncomePoint, DistributionRow, Bond } from "@/components/Ladder/types";
import { addLadderBond, getLadderIncome, getLadderOverview, updateLadderRung } from "./actions";

export default function LadderPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LadderPage />
    </Suspense>
  );
}

function LadderPage() {
  const [rungs, setRungs] = useState<RungData[]>([]);
  const [incomeSeries, setIncomeSeries] = useState<IncomePoint[]>([]);
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [selectedRungId, setSelectedRungId] = useState<string | null>(null);
  const [hoveredRungId, setHoveredRungId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const candidateId = searchParams.get("candidateId");
  const candidateYear = searchParams.get("candidateYear");

  const loadLadderData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, incomeResult] = await Promise.all([
        getLadderOverview(),
        getLadderIncome(),
      ]);

      if (!overviewResult.ok) throw new Error(overviewResult.error);
      if (!incomeResult.ok) throw new Error(incomeResult.error);

      setRungs(overviewResult.data.rungs);
      setBonds(overviewResult.data.bonds);
      setIncomeSeries(incomeResult.data.income_series);
      setDistributions(incomeResult.data.distributions);
    } catch (err) {
      console.error("Failed to load ladder data", err);
      setError("Failed to load ladder data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLadderData();
  }, [loadLadderData]);

  // When coming back from the scanner with a candidateYear, auto-open that rung.
  useEffect(() => {
    if (!candidateYear) return;

    const yr = Number(candidateYear);
    if (!Number.isFinite(yr)) return;

    // In 1Y mode the rung ids are simple year strings.
    setSelectedRungId(String(yr));
  }, [candidateYear]);

  return (
    <main className="h-[90vh] flex flex-col py-4 px-6 overflow-hidden">
      <h1 className="text-3xl font-bold text-center mb-4">Bond Ladder</h1>

      {error && (
        <div className="bg-red-900/50 border border-red-800 text-red-200 p-4 rounded mb-4 max-w-4xl mx-auto">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center flex-1">
          <div className="text-slate-400 animate-pulse">Loading ladder data...</div>
        </div>
      )}

      {!loading && (
        <div className="flex-1 flex gap-4 w-full max-w-[1800px] mx-auto min-h-0 px-2">
        {/* Left: Ladder */}
        <div className="basis-[15%] h-full flex flex-col items-start justify-start pr-2">
          <Ladder
            rungs={rungs}
            selectedRungId={selectedRungId}
            onSelectRung={setSelectedRungId}
            onHoverRung={setHoveredRungId}
            bonds={bonds}
            onUpdateRungTarget={async (rungId, targetAmount) => {
              try {
                const result = await updateLadderRung(rungId, { target_amount: targetAmount });
                if (!result.ok) throw new Error(result.error);

                setRungs((prev) => {
                  const aggregateMatch = /^(3Y|5Y)-(\d{4})$/.exec(rungId);
                  if (!aggregateMatch) {
                    return prev.map((r) =>
                      r.id === rungId ? { ...r, target_amount: targetAmount } : r
                    );
                  }

                  const span = aggregateMatch[1] === "3Y" ? 3 : 5;
                  const startYear = Number(aggregateMatch[2]);
                  const endYear = startYear + span - 1;
                  const perRungTarget = targetAmount / span;
                  return prev.map((r) =>
                    r.year >= startYear && r.year <= endYear
                      ? { ...r, target_amount: perRungTarget }
                      : r
                  );
                });
              } catch (err) {
                console.error("Failed to update rung target", err);
              }
            }}
            onAddBond={async (payload) => {
              try {
                const result = await addLadderBond({ id: "", ...payload });
                if (!result.ok) throw new Error(result.error);

                // After adding a bond, reload ladder and income data so
                // all views stay in sync.
                await loadLadderData();
              } catch (err) {
                console.error("Failed to add bond", err);
              }
            }}
            prefillCandidate={{
              id: candidateId ?? undefined,
              maturityYear: candidateYear ? Number(candidateYear) : undefined,
            }}
          />
        </div>

        {/* Right: Expected income + distributions + bond holdings */}
        <div className="basis-[85%] flex flex-col min-h-0 pl-2">
          <section className="basis-2/5 bg-slate-900 text-slate-100 rounded-lg p-3 mb-3 overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold mb-2">Expected Income</h2>
            <div className="flex-1 ">
              {incomeSeries.length > 0 ? (
                <ExpectedIncomeChart data={incomeSeries} />
              ) : (
                <div className="text-xs text-slate-300">Loading income data…</div>
              )}
            </div>
          </section>

          <div className="flex-1 min-h-0 flex gap-3">
            {/* Bond Holdings Table */}
            <section
              className="basis-1/2 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-hidden flex flex-col"
              data-testid="bond-holdings-section"
            >
              <h2 className="text-lg font-semibold mb-2">Bond Holdings</h2>
              <div className="flex-1 overflow-y-auto text-xs">
                {bonds.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center h-full text-slate-400 gap-2"
                    data-testid="bond-holdings-empty"
                  >
                    <span className="text-2xl">🪪</span>
                    <p className="text-sm font-medium">No bonds yet</p>
                    <p className="text-xs text-slate-500">Add a bond to the ladder to see it here.</p>
                  </div>
                ) : (
                  <table className="w-full border-collapse" data-testid="bond-holdings-table">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr>
                        <th className="text-left px-1 py-1">Ticker / Issuer</th>
                        <th className="text-right px-1 py-1">Coupon</th>
                        <th className="text-right px-1 py-1">Face Value</th>
                        <th className="text-left px-1 py-1">Maturity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bonds]
                        .sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))
                        .map((bond) => (
                          <tr key={bond.id} className="hover:bg-slate-800">
                            <td className="px-1 py-0.5 whitespace-nowrap">
                              {bond.ticker ?? bond.issuer}
                            </td>
                            <td className="px-1 py-0.5 text-right" data-testid={`coupon-${bond.id}`}>
                              {(bond.coupon_rate * 100).toFixed(2)}%
                            </td>
                            <td className="px-1 py-0.5 text-right">
                              {bond.face_value.toLocaleString()} {bond.currency}
                            </td>
                            <td className="px-1 py-0.5 whitespace-nowrap">
                              {bond.maturity_date}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Distributions */}
            <section className="basis-1/2 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-hidden flex flex-col">
              <h2 className="text-lg font-semibold mb-2">Distributions (mock)</h2>
              <div className="flex-1 overflow-y-auto text-xs">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr>
                      <th className="text-left px-1 py-1">Date</th>
                      <th className="text-left px-1 py-1">Type</th>
                      <th className="text-left px-1 py-1">Ticker</th>
                      <th className="text-left px-1 py-1">Issuer</th>
                      <th className="text-right px-1 py-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributions.map((d) => (
                      <tr
                        key={d.id}
                        className={
                          d.rung_id === (hoveredRungId ?? selectedRungId)
                            ? "bg-slate-700"
                            : "hover:bg-slate-800"
                        }
                      >
                        <td className="px-1 py-0.5 whitespace-nowrap">{d.date}</td>
                        <td className="px-1 py-0.5">{d.type}</td>
                        <td className="px-1 py-0.5 whitespace-nowrap">{d.ticker ?? ""}</td>
                        <td className="px-1 py-0.5 whitespace-nowrap">{d.issuer}</td>
                        <td className="px-1 py-0.5 text-right">
                          {d.amount.toFixed(2)} {d.currency}
                        </td>
                      </tr>
                    ))}
                    {distributions.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-1 py-1 text-center text-slate-400">
                          Loading distributions…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
      )}
    </main>
  );
}
