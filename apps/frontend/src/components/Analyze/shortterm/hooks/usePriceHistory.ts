"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UsePriceHistoryResult {
  data: OHLCVBar[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePriceHistory(ticker: string): UsePriceHistoryResult {
  const [data, setData] = useState<OHLCVBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    getTickerAnalysis(ticker)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        const priceHistory = result.data?.data.sections?.price_history_1y_1d as { data?: OHLCVBar[] } | undefined;
        if (!priceHistory?.data) throw new Error(`No cached price history for ${ticker} yet`);
        setData(priceHistory.data);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load price history"))
      .finally(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
