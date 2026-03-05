"use client";

import React from "react";
import {
  useGrowthStory,
  type GrowthStoryData,
  type ScenarioData,
} from "./hooks/useGrowthStory";

interface GrowthStoryProps {
  ticker: string;
}

function LoadingState({ elapsedSeconds }: { elapsedSeconds: number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center">
      <div className="inline-flex items-center gap-3 mb-4">
        <span className="relative flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
        </span>
        <span className="text-lg font-semibold text-white">
          Analyzing...{" "}
          <span className="text-blue-400 font-mono">{elapsedSeconds}s</span>
        </span>
      </div>
      <p className="text-sm text-slate-400 max-w-md mx-auto">
        Reading SEC filings, scanning news &amp; social sentiment, building
        scenario models. This typically takes 30–60 seconds.
      </p>
      <div className="mt-6 w-full max-w-xs mx-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500/60 rounded-full transition-all duration-1000"
          style={{ width: `${Math.min((elapsedSeconds / 50) * 100, 95)}%` }}
        />
      </div>
    </div>
  );
}

function GenerateButton({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center">
      <p className="text-4xl mb-3">🔍</p>
      <button
        onClick={onGenerate}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors text-lg"
      >
        Generate Growth Story
      </button>
      <p className="text-sm text-slate-400 mt-3 max-w-sm mx-auto">
        Uses AI to analyze news, social sentiment, and financial data to build a
        three-scenario outlook.
      </p>
    </div>
  );
}

function ValueDriverCard({ text }: { text: string }) {
  return (
    <div className="bg-blue-950/30 border border-blue-800/50 rounded-xl p-6">
      <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
        Core Value Driver
      </h3>
      <p className="text-lg text-slate-200 leading-relaxed">{text}</p>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
  color,
}: {
  confidence: string;
  color: "green" | "blue" | "red";
}) {
  const colors = {
    green: "bg-green-900/60 text-green-300 border-green-700/50",
    blue: "bg-blue-900/60 text-blue-300 border-blue-700/50",
    red: "bg-red-900/60 text-red-300 border-red-700/50",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[color]}`}
    >
      {confidence} probability
    </span>
  );
}

function ScenarioCard({
  scenario,
  label,
  color,
}: {
  scenario: ScenarioData;
  label: string;
  color: "green" | "blue" | "red";
}) {
  const borderColors = {
    green: "border-green-800/50 bg-green-950/20",
    blue: "border-blue-800/50 bg-blue-950/20",
    red: "border-red-800/50 bg-red-950/20",
  };
  const headerColors = {
    green: "text-green-400",
    blue: "text-blue-400",
    red: "text-red-400",
  };
  const dotColors = {
    green: "bg-green-400",
    blue: "bg-blue-400",
    red: "bg-red-400",
  };
  const bulletColors = {
    green: "text-green-500",
    blue: "text-blue-500",
    red: "text-red-500",
  };
  const catalystLabel = color === "red" ? "Key Risks" : "Key Catalysts";

  return (
    <div className={`border rounded-xl p-6 ${borderColors[color]} flex flex-col`}>
      <div className="flex items-center justify-between mb-3">
        <h4
          className={`text-sm font-semibold ${headerColors[color]} flex items-center gap-2`}
        >
          <span className={`w-2 h-2 rounded-full ${dotColors[color]}`} />
          {label}
        </h4>
        <ConfidenceBadge confidence={scenario.confidence} color={color} />
      </div>
      <p className="text-white font-semibold text-base mb-1">
        {scenario.title}
      </p>
      <p className="text-xl font-bold text-white mb-3">
        {scenario.target_multiple}
      </p>
      <p className="text-sm text-slate-300 leading-relaxed mb-4">
        {scenario.narrative}
      </p>
      <div className="mt-auto">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          {catalystLabel}
        </p>
        <ul className="space-y-1.5">
          {scenario.catalysts.map((c, i) => (
            <li
              key={i}
              className="text-sm text-slate-300 flex items-start gap-2"
            >
              <span className={`${bulletColors[color]} mt-1 shrink-0`}>•</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SentimentSection({
  sentiment,
}: {
  sentiment: GrowthStoryData["sentiment_summary"];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-slate-300 mb-2">
          📊 Retail Sentiment
        </h4>
        <p className="text-sm text-slate-400">{sentiment.retail}</p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-slate-300 mb-2">
          🏛️ Institutional Sentiment
        </h4>
        <p className="text-sm text-slate-400">{sentiment.institutional}</p>
      </div>
    </div>
  );
}

function StoryResults({ data }: { data: GrowthStoryData }) {
  const generatedDate = new Date(data.generated_at).toLocaleString();
  return (
    <div className="space-y-6">
      <ValueDriverCard text={data.value_driver} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ScenarioCard
          scenario={data.scenarios.best_case}
          label="Best Case"
          color="green"
        />
        <ScenarioCard
          scenario={data.scenarios.probable_case}
          label="Probable Case"
          color="blue"
        />
        <ScenarioCard
          scenario={data.scenarios.worst_case}
          label="Worst Case"
          color="red"
        />
      </div>

      <SentimentSection sentiment={data.sentiment_summary} />

      <div className="text-xs text-slate-500 border-t border-slate-800 pt-4">
        <p>{data.sources_summary}</p>
        <p className="mt-1">Generated: {generatedDate}</p>
      </div>
    </div>
  );
}

export default function GrowthStory({ ticker }: GrowthStoryProps) {
  const { data, loading, error, elapsedSeconds, generate } =
    useGrowthStory(ticker);

  if (loading) {
    return <LoadingState elapsedSeconds={elapsedSeconds} />;
  }

  if (error) {
    return (
      <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-6 text-center">
        <p className="text-red-400 mb-3">{error}</p>
        <button
          onClick={generate}
          className="px-4 py-2 text-sm bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data) {
    return <StoryResults data={data} />;
  }

  return <GenerateButton onGenerate={generate} />;
}
