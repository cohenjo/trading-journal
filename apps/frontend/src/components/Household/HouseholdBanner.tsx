"use client";

/**
 * HouseholdBanner
 *
 * Inline banner shown inside page content when the household bootstrap
 * detects no household or a permanent error.
 *
 * Stable data-testid attributes (Redfoot E2E contract):
 *   household-banner         — the wrapper div
 *   household-banner-setup   — the "Set up household" button
 */

import React from "react";
import { useHousehold } from "@/lib/household/HouseholdContext";

export function HouseholdBanner() {
  const { status, errorMessage, retriggerBootstrap } = useHousehold();

  if (status === "provisioned" || status === "idle" || status === "loading") {
    return null;
  }

  if (status === "unprovisioned") {
    return (
      <div
        data-testid="household-banner"
        role="alert"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-300"
      >
        <span className="shrink-0">⚠️</span>
        <span className="flex-1">
          No active household found for your account.
        </span>
        <button
          data-testid="household-banner-setup"
          onClick={retriggerBootstrap}
          className="shrink-0 rounded-md bg-amber-700/60 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-600/60 transition-colors"
        >
          Set up household
        </button>
      </div>
    );
  }

  // status === 'error'
  return (
    <div
      data-testid="household-banner"
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
    >
      <span className="shrink-0">⚠️</span>
      <span className="flex-1">
        {errorMessage ?? "Household setup failed. Please try again."}
      </span>
      <button
        data-testid="household-banner-setup"
        onClick={retriggerBootstrap}
        className="shrink-0 rounded-md bg-red-800/60 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-700/60 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
