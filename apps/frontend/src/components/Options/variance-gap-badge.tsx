import Decimal from 'decimal.js';
import { formatDate, formatSignedUsd, formatUsd, toDecimal } from './options-format';

interface Props {
  cumulativeCashFlow: string;
  cumulativeRealizedPnl: string;
  gap: string;
  asOf: string | null;
}

function gapTone(gap: Decimal): string {
  if (gap.isZero()) return 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30';
  if (gap.isPositive()) return 'text-amber-200 bg-amber-500/10 border-amber-400/40';
  return 'text-sky-200 bg-sky-500/10 border-sky-400/40';
}

export default function VarianceGapBadge({ cumulativeCashFlow, cumulativeRealizedPnl, gap, asOf }: Props) {
  const gapValue = toDecimal(gap);

  return (
    <section className="h-full rounded-3xl border border-slate-700/80 bg-slate-950/80 p-6 shadow-2xl shadow-black/20" data-testid="variance-gap-badge">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Variance Gap</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-100">Cash you took in vs cash you actually earned</h2>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm text-slate-400">Cumulative Cash Flow</p>
          <p className="text-3xl font-bold tabular-nums text-emerald-300">{formatSignedUsd(cumulativeCashFlow)}</p>
        </div>
        <div>
          <p className="text-sm text-slate-400">Cumulative Realized P&amp;L</p>
          <p className="text-3xl font-bold tabular-nums text-blue-300">{formatSignedUsd(cumulativeRealizedPnl)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${gapTone(gapValue)}`}>
          <p className="text-sm">Variance Gap</p>
          <p className="text-4xl font-black tabular-nums">{formatSignedUsd(gapValue)}</p>
          <p className="mt-2 text-xs opacity-80">Positive gap often means open risk or roll losses not visible in cash flow.</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500">
        <span>as of {formatDate(asOf)}</span>
        <span>{formatUsd(gapValue.abs())} diagnostic delta</span>
      </div>
    </section>
  );
}
