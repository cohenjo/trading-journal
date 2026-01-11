"use client";

import React, { useEffect, useState } from "react";

type Holding = {
  id: string;
  ticker?: string | null;
  issuer: string;
  currency: string;
  face_value: number;
  coupon_rate: number;
  coupon_frequency: string;
  issue_date: string;
  maturity_date: string;
};

export default function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Holding | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/holdings");
        if (!res.ok) {
          throw new Error(`Failed to load holdings: ${res.status}`);
        }
        const data: Holding[] = await res.json();
        setHoldings(data);
      } catch (e: any) {
        setError(e.message ?? "Failed to load holdings");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleFaceChange = (id: string, value: number) => {
    setHoldings((prev) =>
      prev.map((h) => (h.id === id ? { ...h, face_value: value } : h))
    );
  };

  const handleSaveFace = async (id: string) => {
    const holding = holdings.find((h) => h.id === id);
    if (!holding) return;

    try {
      setSavingId(id);
      const res = await fetch(`/api/holdings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ face_value: holding.face_value }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to update holding: ${res.status}`);
      }
      const updated: Holding = await res.json();
      setHoldings((prev) =>
        prev.map((h) => (h.id === updated.id ? updated : h))
      );
    } catch (e: any) {
      setError(e.message ?? "Failed to update holding");
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveHolding = async (id: string) => {
    try {
      setSavingId(id);
      const res = await fetch(`/api/holdings/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to remove holding: ${res.status}`);
      }
      setHoldings((prev) => prev.filter((h) => h.id !== id));
    } catch (e: any) {
      setError(e.message ?? "Failed to remove holding");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-2xl font-semibold mb-4">Bond Holdings</h1>

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      <section className="mb-4 text-sm text-slate-300">
        <p>
          This page shows the current bond holdings portfolio backing the ladder.
          Expected income remains visible on the ladder page; here the focus is on
          positions (quantity) and basic bond attributes.
        </p>
      </section>

      <section className="bg-slate-900 rounded-lg p-3 text-sm overflow-x-auto">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-xs font-medium"
            onClick={() => {
              setNewRow({
                id: "", // CUSIP to be entered
                issuer: "",
                currency: "USD",
                face_value: 0,
                coupon_rate: 0.04,
                coupon_frequency: "ANNUAL",
                issue_date: new Date().toISOString().slice(0, 10),
                maturity_date: new Date().toISOString().slice(0, 10),
              });
            }}
          >
            + Add holding
          </button>
        </div>
        <table className="min-w-full border border-slate-700 border-collapse">
          <thead className="bg-slate-900">
            <tr>
              <th className="border border-slate-700 px-2 py-1 text-left">CUSIP</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Ticker</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Issuer</th>
              <th className="border border-slate-700 px-2 py-1 text-right">Face value</th>
              <th className="border border-slate-700 px-2 py-1 text-right">Coupon</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Frequency</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Currency</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Issue date</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Maturity</th>
              <th className="border border-slate-700 px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {newRow && (
              <tr className="bg-slate-950">
                <td className="border border-slate-800 px-2 py-1">
                  <input
                    type="text"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-28"
                    value={newRow.id}
                    onChange={(e) =>
                      setNewRow({ ...newRow, id: e.target.value })
                    }
                    placeholder="CUSIP"
                    aria-label="CUSIP"
                  />
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <input
                    type="text"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-24"
                    value={newRow.ticker ?? ""}
                    onChange={(e) =>
                      setNewRow({ ...newRow, ticker: e.target.value || null })
                    }
                    placeholder="Ticker"
                    aria-label="Ticker"
                  />
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <input
                    type="text"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-40"
                    value={newRow.issuer}
                    onChange={(e) =>
                      setNewRow({ ...newRow, issuer: e.target.value })
                    }
                    placeholder="Issuer"
                    aria-label="Issuer"
                  />
                </td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  <input
                    type="number"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-32 text-right"
                    value={newRow.face_value}
                    onChange={(e) =>
                      setNewRow({
                        ...newRow,
                        face_value: Number(e.target.value) || 0,
                      })
                    }
                    aria-label="Face value"
                  />
                  <span className="ml-1">{newRow.currency}</span>
                </td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  <input
                    type="number"
                    step="0.01"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-20 text-right"
                    value={(newRow.coupon_rate * 100).toFixed(2)}
                    onChange={(e) =>
                      setNewRow({
                        ...newRow,
                        coupon_rate: (Number(e.target.value) || 0) / 100,
                      })
                    }
                    aria-label="Coupon rate"
                  />
                  <span className="ml-1">%</span>
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <select
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5"
                    value={newRow.coupon_frequency}
                    onChange={(e) =>
                      setNewRow({
                        ...newRow,
                        coupon_frequency: e.target.value,
                      })
                    }
                    aria-label="Coupon frequency"
                  >
                    <option value="ANNUAL">Annual</option>
                    <option value="SEMI_ANNUAL">Semi-annual</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </select>
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <select
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5"
                    value={newRow.currency}
                    onChange={(e) =>
                      setNewRow({ ...newRow, currency: e.target.value })
                    }
                    aria-label="Currency"
                  >
                    <option value="USD">USD</option>
                  </select>
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <input
                    type="date"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5"
                    value={newRow.issue_date}
                    onChange={(e) =>
                      setNewRow({ ...newRow, issue_date: e.target.value })
                    }
                    aria-label="Issue date"
                  />
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  <input
                    type="date"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5"
                    value={newRow.maturity_date}
                    onChange={(e) =>
                      setNewRow({ ...newRow, maturity_date: e.target.value })
                    }
                    aria-label="Maturity date"
                  />
                </td>
                <td className="border border-slate-800 px-2 py-1 text-center">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs mr-1"
                    onClick={async () => {
                      if (!newRow || !newRow.issuer || !newRow.maturity_date) {
                        setError("Issuer and maturity are required");
                        return;
                      }
                      try {
                        setSavingId("__new__");
                        const res = await fetch(
                          "/api/ladder/bonds",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              id: newRow.id,
                              issuer: newRow.issuer,
                              currency: newRow.currency,
                              face_value: newRow.face_value,
                              coupon_rate: newRow.coupon_rate,
                              coupon_frequency: newRow.coupon_frequency,
                              issue_date: newRow.issue_date,
                              maturity_date: newRow.maturity_date,
                            }),
                          }
                        );
                        if (!res.ok) {
                          const text = await res.text();
                          throw new Error(text || "Failed to add holding");
                        }
                        const created: Holding = await res.json();
                        setHoldings((prev) => [...prev, created]);
                        setNewRow(null);
                      } catch (e: any) {
                        setError(e.message ?? "Failed to add holding");
                      } finally {
                        setSavingId(null);
                      }
                    }}
                    disabled={savingId === "__new__"}
                  >
                    {savingId === "__new__" ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                    onClick={() => setNewRow(null)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}
            {holdings.map((h) => (
              <tr key={h.id} className="odd:bg-slate-950 even:bg-slate-900">
                <td className="border border-slate-800 px-2 py-1 whitespace-nowrap">
                  {h.id}
                </td>
                <td className="border border-slate-800 px-2 py-1 whitespace-nowrap">
                  {h.ticker ?? ""}
                </td>
                <td className="border border-slate-800 px-2 py-1 whitespace-nowrap">
                  {h.issuer}
                </td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  <input
                    type="number"
                    className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-32 text-right"
                    value={h.face_value}
                    onChange={(e) =>
                      handleFaceChange(h.id, Number(e.target.value) || 0)
                    }
                    aria-label="Face value"
                  />
                  <span className="ml-1">{h.currency}</span>
                </td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  {(h.coupon_rate * 100).toFixed(2)}%
                </td>
                <td className="border border-slate-800 px-2 py-1">
                  {h.coupon_frequency.replace("_", "/")}
                </td>
                <td className="border border-slate-800 px-2 py-1">{h.currency}</td>
                <td className="border border-slate-800 px-2 py-1 whitespace-nowrap">
                  {new Date(h.issue_date).toLocaleDateString()}
                </td>
                <td className="border border-slate-800 px-2 py-1 whitespace-nowrap">
                  {new Date(h.maturity_date).toLocaleDateString()}
                </td>
                <td className="border border-slate-800 px-2 py-1 text-center">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs disabled:opacity-50 mr-1"
                    disabled={savingId === h.id}
                    onClick={() => handleSaveFace(h.id)}
                  >
                    {savingId === h.id ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-xs disabled:opacity-50"
                    disabled={savingId === h.id}
                    onClick={() => handleRemoveHolding(h.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {holdings.length === 0 && !loading && !newRow && (
              <tr>
                <td
                  colSpan={8}
                  className="border border-slate-800 px-2 py-4 text-center text-slate-400"
                >
                  No holdings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
