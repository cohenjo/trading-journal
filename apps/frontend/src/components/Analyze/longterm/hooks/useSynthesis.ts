"use client";

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

export function useSynthesis(ticker: string): UseSynthesisReturn {
  const [data, setData] = useState<SynthesisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/analyze/synthesis/${ticker}`);
      if (!res.ok) {
        throw new Error(`API error (${res.status})`);
      }
      const json = await res.json();
      setData(json);
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
