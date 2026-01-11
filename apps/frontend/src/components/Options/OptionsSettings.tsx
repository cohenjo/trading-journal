"use client";

export type OptionsProjectionParams = {
  growth_rate: number;
  cutoff_year: number;
  final_year: number;
};

type Props = {
  params: OptionsProjectionParams;
  onChange: (params: OptionsProjectionParams) => void;
};

export default function OptionsSettings({ params, onChange }: Props) {
  const handleChange = (field: keyof OptionsProjectionParams, value: string) => {
    let parsed: number;
    if (field === "growth_rate") {
      parsed = (Number(value) || 0) / 100;
    } else {
      parsed = Number(value) || 0;
    }
    onChange({ ...params, [field]: parsed });
  };

  return (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
      <h3 className="text-lg font-semibold text-slate-200">Options Projection Settings</h3>

      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="block text-slate-300 mb-1">Growth Rate (%)</span>
          <input
            type="number"
            value={(params.growth_rate * 100).toFixed(2)}
            onChange={(e) => handleChange("growth_rate", e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm"
          />
        </label>

        <label className="block">
          <span className="block text-slate-300 mb-1">Cutoff Year (growth stops)</span>
          <input
            type="number"
            value={params.cutoff_year}
            onChange={(e) => handleChange("cutoff_year", e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm"
          />
        </label>

        <label className="block">
          <span className="block text-slate-300 mb-1">Final Year</span>
          <input
            type="number"
            value={params.final_year}
            onChange={(e) => handleChange("final_year", e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
