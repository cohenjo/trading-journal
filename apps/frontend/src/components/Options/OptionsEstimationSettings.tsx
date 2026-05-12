"use client";

export type OptionsProjectionParams = {
  growth_rate: number;
  final_year: number;
};

type OptionsEstimationSettingsProps = {
  params: OptionsProjectionParams;
  onChange: (params: OptionsProjectionParams) => void;
};

/** Settings panel for options income projection — growth rate and final year. */
export default function OptionsEstimationSettings({ params, onChange }: OptionsEstimationSettingsProps) {
  const handleChange = (field: keyof OptionsProjectionParams, value: number) => {
    onChange({ ...params, [field]: value });
  };

  return (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 h-full">
      <h3 className="text-lg font-semibold mb-4 text-slate-200">Projection Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Annual Growth Rate (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={(params.growth_rate * 100).toFixed(1)}
            onChange={(e) => handleChange("growth_rate", parseFloat(e.target.value) / 100)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Year-over-year growth applied to the 3-year baseline average
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">Final Year</label>
          <input
            type="number"
            step="1"
            min={new Date().getFullYear() + 1}
            max={2100}
            value={params.final_year}
            onChange={(e) => handleChange("final_year", parseInt(e.target.value, 10))}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
