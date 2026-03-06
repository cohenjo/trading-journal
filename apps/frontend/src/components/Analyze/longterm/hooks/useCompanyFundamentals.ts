"use client";

import { useState, useEffect, useCallback } from "react";

export interface DcfInputs {
  current_fcf: number;
  shares_outstanding: number;
  growth_rate_default: number;
  discount_rate_default: number;
  terminal_growth: number;
  projection_years: number;
}

export interface Financials {
  roic: number | null;
  wacc: number | null;
  revenue_cagr_5y: number | null;
  fcf_cagr_5y: number | null;
  net_debt_ebitda: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  ev_fcf: number | null;
}

export interface FundamentalsData {
  ticker: string;
  name: string;
  sector: string;
  market_cap: number;
  currency: string;
  current_price: number;
  financials: Financials;
  dcf_inputs: DcfInputs;
}

interface UseFundamentalsReturn {
  data: FundamentalsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

export function useCompanyFundamentals(ticker: string): UseFundamentalsReturn {
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/analyze/fundamentals/${ticker}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? `Ticker "${ticker}" not found` : `API error (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch fundamentals");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
