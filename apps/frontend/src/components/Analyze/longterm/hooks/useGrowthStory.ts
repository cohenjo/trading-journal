"use client";

import { listGrowthStories } from "@/app/analyze/actions";
import { useState, useCallback, useRef, useEffect } from "react";

export interface ScenarioData {
  title: string;
  narrative: string;
  catalysts: string[];
  target_multiple: string;
  confidence: string;
}

export interface SentimentSummary {
  retail: string;
  institutional: string;
}

export interface GrowthStoryData {
  ticker: string;
  company_name: string;
  value_driver: string;
  scenarios: {
    best_case: ScenarioData;
    probable_case: ScenarioData;
    worst_case: ScenarioData;
  };
  sentiment_summary: SentimentSummary;
  sources_summary: string;
  generated_at: string;
}

interface UseGrowthStoryReturn {
  data: GrowthStoryData | null;
  loading: boolean;
  error: string | null;
  elapsedSeconds: number;
  generate: () => void;
}

export function useGrowthStory(ticker: string): UseGrowthStoryReturn {
  const [data, setData] = useState<GrowthStoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const generate = useCallback(async () => {
    if (!ticker || loading) return;
    setLoading(true);
    setError(null);
    setData(null);
    setElapsedSeconds(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      const result = await listGrowthStories({ ticker, limit: 1 });
      if (!result.ok) throw new Error(result.error);
      const story = result.data[0]?.story as unknown as GrowthStoryData | undefined;
      if (!story) throw new Error(`No cached growth story for "${ticker}" yet`);
      setData(story);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate growth story"
      );
      setData(null);
    } finally {
      stopTimer();
      setLoading(false);
    }
  }, [ticker, loading, stopTimer]);

  return { data, loading, error, elapsedSeconds, generate };
}
