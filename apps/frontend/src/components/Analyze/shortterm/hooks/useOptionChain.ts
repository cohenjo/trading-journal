"use client";

import { useState, useEffect } from "react";

export interface PutOption {
  strike: number;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  volume: number;
  open_interest: number;
}

export interface OptionChainData {
  current_price: number;
  expirations: string[];
  iv_percentile: number;
  iv_rank: number;
  puts: PutOption[];
}

interface UseOptionChainResult {
  data: OptionChainData | null;
  loading: boolean;
  error: string | null;
  expiry: string | null;
  setExpiry: (expiry: string) => void;
}

export function useOptionChain(ticker: string): UseOptionChainResult {
  const [data, setData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    const url = expiry
      ? `/api/analyze/options/${ticker}?expiry=${expiry}`
      : `/api/analyze/options/${ticker}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch options for ${ticker}`);
        return res.json();
      })
      .then((json: OptionChainData) => {
        setData(json);
        if (!expiry && json.expirations.length > 0) {
          setExpiry(json.expirations[0]);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [ticker, expiry]);

  return { data, loading, error, expiry, setExpiry };
}
