"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

export interface PriceActionSummary {
  current_support: number;
  setup_quality: "High" | "Moderate" | "Low";
}

export interface SynthesisData {
  price_action_summary: PriceActionSummary;
}

interface UseSynthesisResult {
  data: SynthesisData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSynthesis(ticker: string): UseSynthesisResult {
  const [data, setData] = useState<SynthesisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    getTickerAnalysis(ticker)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        const synthesis = result.data?.data.sections?.synthesis as SynthesisData | undefined;
        if (!synthesis) throw new Error(`No cached synthesis for ${ticker} yet`);
        setData(synthesis);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load synthesis"))
      .finally(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
