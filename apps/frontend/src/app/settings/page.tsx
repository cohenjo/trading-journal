"use client";

import { useState, useEffect } from "react";
import { useSettings } from "../settings/SettingsContext";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const [targetIncome, setTargetIncome] = useState<number>(settings.targetIncome);
  const [defaultRungTarget, setDefaultRungTarget] = useState<number>(
    settings.defaultRungTarget
  );

  useEffect(() => {
    setTargetIncome(settings.targetIncome);
    setDefaultRungTarget(settings.defaultRungTarget);
  }, [settings.targetIncome, settings.defaultRungTarget]);

  const handleSave = () => {
    const safeTargetIncome = Number.isFinite(targetIncome) && targetIncome >= 0 ? targetIncome : 0;
    const safeDefaultRungTarget =
      Number.isFinite(defaultRungTarget) && defaultRungTarget >= 0
        ? defaultRungTarget
        : 0;
    updateSettings({
      targetIncome: safeTargetIncome,
      defaultRungTarget: safeDefaultRungTarget,
    });
  };

  return (
    <main className="min-h-[90vh] flex flex-col items-center justify-start py-6 px-4">
      <div className="w-full max-w-md bg-slate-900 text-slate-100 rounded-lg p-4 border border-slate-700 shadow">
        <h1 className="text-xl font-semibold mb-4">Settings</h1>
        <div className="space-y-4 text-sm">
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor="targetIncome">
              Target yearly income (USD)
            </label>
            <input
              id="targetIncome"
              type="number"
              className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              value={targetIncome}
              onChange={(e) => setTargetIncome(Number(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor="defaultRungTarget">
              Default rung target amount (USD)
            </label>
            <input
              id="defaultRungTarget"
              type="number"
              className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              value={defaultRungTarget}
              onChange={(e) => setDefaultRungTarget(Number(e.target.value) || 0)}
              min={0}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </main>
  );
}
