"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Ladder } from "@/components/Ladder/Ladder";
import { ExpectedIncomeChart } from "@/components/Ladder/ExpectedIncomeChart";
import type { RungData, IncomePoint, DistributionRow, Bond } from "@/components/Ladder/types";

export default function LadderPage() {
  const [rungs, setRungs] = useState<RungData[]>([]);
  const [incomeSeries, setIncomeSeries] = useState<IncomePoint[]>([]);
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [selectedRungId, setSelectedRungId] = useState<string | null>(null);
  const [hoveredRungId, setHoveredRungId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const candidateId = searchParams.get("candidateId");
  const candidateYear = searchParams.get("candidateYear");

  useEffect(() => {
    const fetchData = async () => {
      const overviewRes = await fetch("/api/ladder/overview");
      const overviewJson = await overviewRes.json();
      setRungs(overviewJson.rungs ?? []);
      setBonds(overviewJson.bonds ?? []);

      const incomeRes = await fetch("/api/ladder/income");
      const incomeJson = await incomeRes.json();
      setIncomeSeries(incomeJson.income_series ?? []);
      setDistributions(incomeJson.distributions ?? []);
    };

    fetchData().catch((err) => {
      console.error("Failed to load ladder data", err);
    });
  }, []);

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
                await fetch(`/api/ladder/rungs/${rungId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ target_amount: targetAmount }),
                });

                setRungs((prev) =>
                  prev.map((r) =>
                    r.id === rungId ? { ...r, target_amount: targetAmount } : r
                  )
                );
              } catch (err) {
                console.error("Failed to update rung target", err);
              }
            }}
            onAddBond={async (payload) => {
              try {
                const res = await fetch("/api/ladder/bonds", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: "", // let backend synthesize if empty
                    ...payload,
                  }),
                });

                if (!res.ok) {
                  const text = await res.text();
                  console.error("Failed to add bond", text);
                  return;
                }

                // After adding a bond, reload ladder and income data so
                // all views stay in sync.
                const overviewRes = await fetch("/api/ladder/overview");
                const overviewJson = await overviewRes.json();
                setRungs(overviewJson.rungs ?? []);
                setBonds(overviewJson.bonds ?? []);

                const incomeRes = await fetch("/api/ladder/income");
                const incomeJson = await incomeRes.json();
                setIncomeSeries(incomeJson.income_series ?? []);
                setDistributions(incomeJson.distributions ?? []);
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

        {/* Right: Expected income + distributions */}
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

          <section className="flex-1 min-h-0 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-hidden">
            <h2 className="text-lg font-semibold mb-2">Distributions (mock)</h2>
            <div className="h-full overflow-y-auto text-xs">
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
    </main>
  );
}
