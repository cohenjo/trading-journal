"use client";

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

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
      const res = await fetch(
        `${apiUrl}/api/analyze/price-history/${ticker}?period=${period}&interval=${interval}`
      );
      if (!res.ok) {
        throw new Error(res.status === 404 ? `No price data for "${ticker}"` : `API error (${res.status})`);
      }
      const json = await res.json();
      setData(json.data ?? []);
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
