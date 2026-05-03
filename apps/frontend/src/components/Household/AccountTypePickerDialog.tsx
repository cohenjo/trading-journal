"use client";

/**
 * AccountTypePickerDialog
 *
 * Modal that fires when a new user has no household yet.
 * Allows choosing Individual (default) or Joint account type,
 * then calls `provisionHousehold` from HouseholdContext.
 *
 * Stable data-testid attributes (Redfoot E2E contract):
 *   account-type-individual
 *   account-type-joint
 *   account-type-confirm
 */

import React, { useState } from "react";
import { useHousehold, type AccountType } from "@/lib/household/HouseholdContext";

export function AccountTypePickerDialog() {
  const { status, provisionHousehold, errorMessage } = useHousehold();
  const [selected, setSelected] = useState<AccountType>("individual");
  const [submitting, setSubmitting] = useState(false);

  // Only render when the bootstrap tells us no household exists
  if (status !== "unprovisioned") return null;

  async function handleConfirm() {
    setSubmitting(true);
    await provisionHousehold(selected);
    setSubmitting(false);
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="household-dialog-title"
    >
      <div className="w-full max-w-sm mx-4 rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2
          id="household-dialog-title"
          className="text-xl font-semibold text-slate-100 mb-2"
        >
          Set up your household
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Choose the account type for your household. This can be changed later
          in Settings.
        </p>

        <div className="flex flex-col gap-3 mb-6">
          {/* Individual option */}
          <button
            type="button"
            data-testid="account-type-individual"
            onClick={() => setSelected("individual")}
            className={[
              "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
              selected === "individual"
                ? "border-blue-500 bg-blue-950/40 text-blue-200"
                : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500",
            ].join(" ")}
          >
            <span
              className={[
                "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                selected === "individual"
                  ? "border-blue-400"
                  : "border-slate-500",
              ].join(" ")}
            >
              {selected === "individual" && (
                <span className="h-2 w-2 rounded-full bg-blue-400" />
              )}
            </span>
            <div>
              <p className="font-medium">Individual</p>
              <p className="text-xs text-slate-400">
                Single-person household (most common)
              </p>
            </div>
          </button>

          {/* Joint option */}
          <button
            type="button"
            data-testid="account-type-joint"
            onClick={() => setSelected("joint")}
            className={[
              "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
              selected === "joint"
                ? "border-violet-500 bg-violet-950/40 text-violet-200"
                : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500",
            ].join(" ")}
          >
            <span
              className={[
                "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                selected === "joint"
                  ? "border-violet-400"
                  : "border-slate-500",
              ].join(" ")}
            >
              {selected === "joint" && (
                <span className="h-2 w-2 rounded-full bg-violet-400" />
              )}
            </span>
            <div>
              <p className="font-medium">Joint</p>
              <p className="text-xs text-slate-400">
                Shared household with a partner or family member
              </p>
            </div>
          </button>
        </div>

        {errorMessage && (
          <p className="mb-4 rounded-md bg-red-950/60 border border-red-700/40 px-3 py-2 text-sm text-red-300">
            {errorMessage}
          </p>
        )}

        <button
          type="button"
          data-testid="account-type-confirm"
          disabled={submitting}
          onClick={handleConfirm}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Setting up…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
