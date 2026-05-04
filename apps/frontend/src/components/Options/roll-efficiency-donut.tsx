import { formatPercent } from './options-format';

interface Props {
  positive: number;
  negative: number;
  neutral: number;
}

const SEGMENTS = [
  { key: 'positive', color: '#22c55e', label: 'Positive rolls' },
  { key: 'negative', color: '#ef4444', label: 'Negative rolls' },
  { key: 'neutral', color: '#94a3b8', label: 'Neutral rolls' },
] as const;

export default function RollEfficiencyDonut({ positive, negative, neutral }: Props) {
  const values = { positive, negative, neutral };
  const total = positive + negative + neutral;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <section className="rounded-3xl border border-slate-700/80 bg-slate-950/80 p-6" data-testid="roll-efficiency-donut">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Roll Efficiency</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-100">Classified roll outcomes</h2>
      </div>

      <div className="flex flex-col items-center gap-5">
        <div className="relative h-48 w-48">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" role="img" aria-label="Roll efficiency donut chart">
            <circle cx="64" cy="64" r={radius} fill="none" stroke="#1e293b" strokeWidth="18" />
            {total > 0 && SEGMENTS.map((segment) => {
              const value = values[segment.key];
              const dash = (value / total) * circumference;
              const circle = (
                <circle
                  key={segment.key}
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="18"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                >
                  <title>{segment.label}: {value} ({formatPercent((value / total) * 100)})</title>
                </circle>
              );
              offset += dash;
              return circle;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-4xl font-black tabular-nums text-slate-100">{total}</span>
            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">rolls</span>
          </div>
        </div>

        <div className="grid w-full grid-cols-3 gap-2 text-center text-sm">
          {SEGMENTS.map((segment) => {
            const value = values[segment.key];
            const pct = total === 0 ? 0 : (value / total) * 100;
            return (
              <div key={segment.key} className="rounded-2xl bg-slate-900/80 p-3" title={`${segment.label}: ${value}`}>
                <div className="mx-auto mb-2 h-2 w-8 rounded-full" style={{ backgroundColor: segment.color }} />
                <p className="font-bold text-slate-100">{formatPercent(pct)}</p>
                <p className="text-xs capitalize text-slate-500">{segment.key}</p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-5 border-t border-slate-800 pt-4 text-xs text-slate-500">
        Neutral = realized P&amp;L within ±$25 of break-even (configurable later)
      </p>
    </section>
  );
}
