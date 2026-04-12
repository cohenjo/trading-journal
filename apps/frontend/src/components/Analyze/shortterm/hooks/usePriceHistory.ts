"use client";

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

    fetch(`/api/analyze/price-history/${ticker}?period=1y&interval=1d`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch price history for ${ticker}`);
        return res.json();
      })
      .then((json: OHLCVBar[]) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
