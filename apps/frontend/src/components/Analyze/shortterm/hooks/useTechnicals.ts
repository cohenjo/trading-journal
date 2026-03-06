"use client";

import { useState, useEffect } from "react";

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
}

export function useTechnicals(ticker: string): UseTechnicalsResult {
  const [data, setData] = useState<TechnicalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    fetch(`/api/analyze/technicals/${ticker}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch technicals for ${ticker}`);
        return res.json();
      })
      .then((json: TechnicalsData) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [ticker]);

  return { data, loading, error };
}
