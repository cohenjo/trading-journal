"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
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
  refreshedAt: string | null;
  isStale: boolean;
  refetch: () => void;
}

export function useCompanyFundamentals(ticker: string): UseFundamentalsReturn {
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTickerAnalysis(ticker);
      if (!result.ok) throw new Error(result.error);
      const row = result.data;
      const fundamentals = row?.data.sections?.fundamentals as FundamentalsData | undefined;
      if (!row || !fundamentals) throw new Error(`No cached analysis for "${ticker}" yet`);
      setData(fundamentals);
      setRefreshedAt(row.refreshed_at);
      setIsStale(row.isStale);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch fundamentals");
      setData(null);
      setRefreshedAt(null);
      setIsStale(false);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refreshedAt, isStale, refetch: fetchData };
}
