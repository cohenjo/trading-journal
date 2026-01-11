"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type BondCandidate = {
  id: string;
  issuer: string;
  coupon_rate: number;
  maturity_date: string;
  yield_to_maturity: number;
  rating: string;
  currency: string;
  price: number;
};

const ScannerPage: React.FC = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [minMaturity, setMinMaturity] = useState<string>("");
  const [maxMaturity, setMaxMaturity] = useState<string>("");
  const [minYield, setMinYield] = useState<string>("");
  const [minRating, setMinRating] = useState<string>("A");
  const [currency, setCurrency] = useState<string>("USD");
  const [results, setResults] = useState<BondCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize maturity filters based on optional fromYear query param.
  useEffect(() => {
    const fromYear = searchParams.get("fromYear");
    if (fromYear) 
    {
      const yearNum = Number(fromYear) || new Date().getFullYear();
      setMinMaturity(`${yearNum}-01-01`);
      setMaxMaturity(`${yearNum}-12-31`);
    }
  }, [searchParams]);

  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (minMaturity) params.set("min_maturity", minMaturity);
      if (maxMaturity) params.set("max_maturity", maxMaturity);
      if (minYield) params.set("min_yield", minYield);
      if (minRating) params.set("min_rating", minRating);
      if (currency) params.set("currency", currency);

      const res = await fetch(`/api/bonds/scanner?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const data: BondCandidate[] = await res.json();
      setResults(data);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-xl font-semibold mb-4">Bond Scanner</h1>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Min maturity</span>
          <input
            type="date"
            value={minMaturity}
            onChange={(e) => setMinMaturity(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Max maturity</span>
          <input
            type="date"
            value={maxMaturity}
            onChange={(e) => setMaxMaturity(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Min yield (%)</span>
          <input
            type="number"
            step="0.01"
            value={minYield}
            onChange={(e) => setMinYield(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Min rating</span>
          <select
            value={minRating}
            onChange={(e) => setMinRating(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="AAA">AAA</option>
            <option value="AA">AA</option>
            <option value="A">A</option>
            <option value="BBB">BBB</option>
            <option value="BB">BB</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={handleSearch}
        className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        disabled={loading}
      >
        {loading ? "Searching..." : "Search"}
      </button>

      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

      <div className="mt-6 overflow-x-auto text-sm">
        <table className="min-w-full border border-slate-700 border-collapse">
          <thead className="bg-slate-900">
            <tr>
              <th className="border border-slate-700 px-2 py-1 text-left">Issuer</th>
              <th className="border border-slate-700 px-2 py-1 text-right">Coupon</th>
              <th className="border border-slate-700 px-2 py-1 text-right">YTM</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Rating</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Currency</th>
              <th className="border border-slate-700 px-2 py-1 text-right">Price</th>
              <th className="border border-slate-700 px-2 py-1 text-left">Maturity</th>
              <th className="border border-slate-700 px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {results.map((b) => (
              <tr key={b.id} className="odd:bg-slate-950 even:bg-slate-900">
                <td className="border border-slate-800 px-2 py-1">{b.issuer}</td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  {(b.coupon_rate * 100).toFixed(2)}%
                </td>
                <td className="border border-slate-800 px-2 py-1 text-right">
                  {(b.yield_to_maturity * 100).toFixed(2)}%
                </td>
                <td className="border border-slate-800 px-2 py-1">{b.rating}</td>
                <td className="border border-slate-800 px-2 py-1">{b.currency}</td>
                <td className="border border-slate-800 px-2 py-1 text-right">{b.price.toFixed(2)}</td>
                <td className="border border-slate-800 px-2 py-1">
                  {new Date(b.maturity_date).toLocaleDateString()}
                </td>
                <td className="border border-slate-800 px-2 py-1 text-center">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-xs"
                    onClick={() => {
                      const maturityYear = new Date(b.maturity_date).getFullYear();
                      const params = new URLSearchParams();
                      params.set("candidateId", b.id);
                      params.set("candidateYear", String(maturityYear));
                      router.push(`/ladder?${params.toString()}`);
                    }}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))}
            {results.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="border border-slate-800 px-2 py-4 text-center text-slate-400"
                >
                  No results yet. Adjust filters and click Search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ScannerPage;
