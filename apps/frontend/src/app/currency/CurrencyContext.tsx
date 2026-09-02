"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import { getExchangeRatesAction } from "./actions";
import {
  convertCurrency,
  formatCurrency,
  setDynamicCurrencyRates,
  FALLBACK_CURRENCY_RATES,
} from "@/lib/currency";

export type CurrencyContextValue = {
  rates: Record<string, number>;
  convert: (amount: number, from?: string, to?: string) => number;
  format: (amount: number, currency?: string, compact?: boolean) => string;
  isLoaded: boolean;
};

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_CURRENCY_RATES);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getExchangeRatesAction()
      .then((loadedRates) => {
        if (!isMounted) return;
        setRates(loadedRates);
        setDynamicCurrencyRates(loadedRates);
        setIsLoaded(true);
      })
      .catch((err) => {
        console.warn("[CurrencyProvider] failed to load dynamic rates, using fallback:", err);
        if (isMounted) setIsLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo<CurrencyContextValue>(() => ({
    rates,
    convert: (amount: number, from = "ILS", to = "ILS") => convertCurrency(amount, from, to, rates),
    format: (amount: number, currency = "USD", compact = false) => formatCurrency(amount, currency, compact),
    isLoaded,
  }), [rates, isLoaded]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (!context) {
    return {
      rates: FALLBACK_CURRENCY_RATES,
      convert: (amount: number, from = "ILS", to = "ILS") => convertCurrency(amount, from, to),
      format: (amount: number, currency = "USD", compact = false) => formatCurrency(amount, currency, compact),
      isLoaded: true,
    };
  }
  return context;
}
