"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

export interface PricePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UsePriceHistoryReturn {
  data: PricePoint[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePriceHistory(
  ticker: string,
  period: string = "1y",
  interval: string = "1d"
): UsePriceHistoryReturn {
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTickerAnalysis(ticker);
      if (!result.ok) throw new Error(result.error);
      const sectionKey = `price_history_${period}_${interval}`;
      const priceHistory = result.data?.data.sections?.[sectionKey] as { data?: PricePoint[] } | undefined;
      if (!priceHistory?.data) throw new Error(`No cached price history for "${ticker}" yet`);
      setData(priceHistory.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch price history");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [ticker, period, interval]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
