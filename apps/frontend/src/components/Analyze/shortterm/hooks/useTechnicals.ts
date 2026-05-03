"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

interface MacdData {
  macd_line: number;
  signal_line: number;
  histogram: number;
}

interface BollingerData {
  upper: number;
  middle: number;
  lower: number;
}

interface Indicators {
  ema_50: number;
  ema_200: number;
  rsi_14: number;
  macd: MacdData;
  bollinger: BollingerData;
}

interface SupportResistance {
  support_1: number;
  resistance_1: number;
  trend: string;
}

export interface TechnicalsData {
  indicators: Indicators;
  support_resistance: SupportResistance;
}

interface UseTechnicalsResult {
  data: TechnicalsData | null;
  loading: boolean;
  error: string | null;
  refreshedAt: string | null;
  isStale: boolean;
  refetch: () => void;
}

export function useTechnicals(ticker: string): UseTechnicalsResult {
  const [data, setData] = useState<TechnicalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const fetchData = useCallback(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    getTickerAnalysis(ticker)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        const row = result.data;
        const technicals = row?.data.sections?.technicals as TechnicalsData | undefined;
        if (!row || !technicals) throw new Error(`No cached technicals for ${ticker} yet`);
        setData(technicals);
        setRefreshedAt(row.refreshed_at);
        setIsStale(row.isStale);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load technicals");
        setRefreshedAt(null);
        setIsStale(false);
      })
      .finally(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refreshedAt, isStale, refetch: fetchData };
}
