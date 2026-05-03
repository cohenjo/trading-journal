"use client";

import { getTickerAnalysis } from "@/app/analyze/actions";
import { useState, useEffect, useCallback } from "react";

export interface SynthesisData {
  growth_engine: string[];
  bear_case: string[];
}

interface UseSynthesisReturn {
  data: SynthesisData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSynthesis(ticker: string): UseSynthesisReturn {
  const [data, setData] = useState<SynthesisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTickerAnalysis(ticker);
      if (!result.ok) throw new Error(result.error);
      const synthesis = result.data?.data.sections?.synthesis as SynthesisData | undefined;
      if (!synthesis) throw new Error(`No cached synthesis for "${ticker}" yet`);
      setData(synthesis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch synthesis");
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
