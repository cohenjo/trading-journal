"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

export interface PutOption {
  strike: number;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  volume: number;
  open_interest: number;
}

export interface OptionChainData {
  current_price: number;
  expirations: string[];
  iv_percentile: number;
  iv_rank: number;
  puts: PutOption[];
}

interface UseOptionChainResult {
  data: OptionChainData | null;
  loading: boolean;
  error: string | null;
  expiry: string | null;
  setExpiry: (expiry: string) => void;
  refetch: () => void;
}

export function useOptionChain(ticker: string): UseOptionChainResult {
  const [data, setData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    getTickerAnalysis(ticker)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        const options = result.data?.data.sections?.options as OptionChainData | undefined;
        if (!options) throw new Error(`No cached options for ${ticker} yet`);
        setData(options);
        if (!expiry && options.expirations.length > 0) setExpiry(options.expirations[0]);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load options"))
      .finally(() => setLoading(false));
  }, [ticker, expiry]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, expiry, setExpiry, refetch: fetchData };
}
