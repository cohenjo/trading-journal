"use client";

import { useState, useEffect } from "react";

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
}

export function useSynthesis(ticker: string): UseSynthesisResult {
  const [data, setData] = useState<SynthesisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    fetch(`/api/analyze/synthesis/${ticker}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch synthesis for ${ticker}`);
        return res.json();
      })
      .then((json: SynthesisData) => {
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
