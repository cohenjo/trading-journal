"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type UserSettings = {
  targetIncome: number;
  defaultRungTarget: number;
  dividendYieldRate: number;
  dividendGrowthRate: number;
  dividendReinvestRate: number;
  cutoffYear: number;
  dividendFinalYear: number;
  optionsGrowthRate: number;
  optionsFinalYear: number;
};

const DEFAULT_SETTINGS: UserSettings = {
  targetIncome: 20000,
  defaultRungTarget: 40000,
  dividendYieldRate: 0.028,
  dividendGrowthRate: 0.04,
  dividendReinvestRate: 0.8,
  cutoffYear: 2040,
  dividendFinalYear: 2064,
  optionsGrowthRate: 0.05,
  optionsFinalYear: 2064,
};

const STORAGE_KEY = "trading-journal-settings-v1";

type SettingsContextValue = {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

const loadSettings = (): UserSettings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      targetIncome:
        typeof parsed.targetIncome === "number" && parsed.targetIncome >= 0
          ? parsed.targetIncome
          : DEFAULT_SETTINGS.targetIncome,
      defaultRungTarget:
        typeof parsed.defaultRungTarget === "number" && parsed.defaultRungTarget >= 0
          ? parsed.defaultRungTarget
          : DEFAULT_SETTINGS.defaultRungTarget,
      dividendYieldRate:
        typeof parsed.dividendYieldRate === "number"
          ? parsed.dividendYieldRate
          : DEFAULT_SETTINGS.dividendYieldRate,
      dividendGrowthRate:
        typeof parsed.dividendGrowthRate === "number"
          ? parsed.dividendGrowthRate
          : DEFAULT_SETTINGS.dividendGrowthRate,
      dividendReinvestRate:
        typeof parsed.dividendReinvestRate === "number"
          ? parsed.dividendReinvestRate
          : DEFAULT_SETTINGS.dividendReinvestRate,
      cutoffYear:
        typeof parsed.cutoffYear === "number"
          ? parsed.cutoffYear
          : DEFAULT_SETTINGS.cutoffYear,
      dividendFinalYear:
        typeof parsed.dividendFinalYear === "number"
          ? parsed.dividendFinalYear
          : DEFAULT_SETTINGS.dividendFinalYear,
      optionsGrowthRate:
        typeof parsed.optionsGrowthRate === "number"
          ? parsed.optionsGrowthRate
          : DEFAULT_SETTINGS.optionsGrowthRate,
      optionsFinalYear:
        typeof parsed.optionsFinalYear === "number"
          ? parsed.optionsFinalYear
          : DEFAULT_SETTINGS.optionsFinalYear,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const persistSettings = (settings: UserSettings) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSettings = (partial: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      persistSettings(next);
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
