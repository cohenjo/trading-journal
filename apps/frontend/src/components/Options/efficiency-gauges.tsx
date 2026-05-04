'use client';

import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import type { EfficiencyGaugesData, OptionsMarginSource } from '@/types/options';

interface EfficiencyGaugesProps {
  data: EfficiencyGaugesData;
}

interface GaugeProps {
  title: string;
  value: string | null;
  suffix: string;
  min: Decimal;
  max: Decimal;
  zones: { label: string; from: number; to: number; color: string }[];
  tooltip: string;
  stale: boolean;
  footer?: ReactNode;
}

const SOURCE_LABELS: Record<OptionsMarginSource, string> = {
  ib_gateway: 'live (IB Gateway)',
  flex: 'flex',
  synthetic: 'synthetic',
};

function clamp(value: Decimal, min: Decimal, max: Decimal): Decimal {
  return Decimal.max(min, Decimal.min(max, value));
}

function needleRotation(value: string | null, min: Decimal, max: Decimal): number {
  if (value === null) return -90;
  const decimal = new Decimal(value);
  const ratio = clamp(decimal.minus(min).div(max.minus(min)), new Decimal(0), new Decimal(1));
  return ratio.times(180).minus(90).toNumber();
}

function formatPct(value: string | null): string {
  if (value === null) return '—';
  return `${new Decimal(value).toFixed(2)}%`;
}

function SemicircleGauge({ title, value, suffix, min, max, zones, tooltip, stale, footer }: GaugeProps) {
  const rotation = needleRotation(value, min, max);
  const displayValue = value === null ? '—' : `${new Decimal(value).toFixed(2)}${suffix}`;
  return (
    <div className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6" data-testid={`gauge-${title.toLowerCase().replaceAll(' ', '-')}`} title={tooltip}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        {stale && <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-200">Stale</span>}
      </div>
      <div className="mt-5 flex justify-center">
        <svg viewBox="0 0 220 130" className="h-32 w-full max-w-64" role="img" aria-label={`${title} gauge ${displayValue}`}>
          <path d="M 30 105 A 80 80 0 0 1 190 105" fill="none" stroke="rgb(30 41 59)" strokeWidth="20" strokeLinecap="round" />
          {zones.map((zone, index) => (
            <path
              key={zone.label}
              d="M 30 105 A 80 80 0 0 1 190 105"
              fill="none"
              stroke={zone.color}
              strokeWidth="12"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${zone.to - zone.from} ${100 - (zone.to - zone.from)}`}
              strokeDashoffset={100 - zone.from}
              opacity={0.9 - index * 0.05}
            />
          ))}
          <g transform={`rotate(${rotation} 110 105)`} data-testid={`${title.toLowerCase().replaceAll(' ', '-')}-needle`}>
            <line x1="110" y1="105" x2="110" y2="32" stroke="rgb(226 232 240)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="110" cy="105" r="7" fill="rgb(226 232 240)" />
          </g>
        </svg>
      </div>
      <div className="mt-2 text-center text-3xl font-black tabular-nums text-slate-50">{displayValue}</div>
      <p className="mt-1 text-center text-xs text-slate-500">{tooltip}</p>
      {footer && <div className="mt-3 flex justify-center">{footer}</div>}
    </div>
  );
}

function SourcePill({ source }: { source: OptionsMarginSource | null }) {
  if (!source) return null;
  const synthetic = source === 'synthetic';
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${synthetic ? 'bg-slate-700 text-slate-300' : 'bg-emerald-400/15 text-emerald-200'}`}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

export default function EfficiencyGauges({ data }: EfficiencyGaugesProps) {
  const noData = data.rocaR_pct === null && data.marginUtilization_pct === null;
  if (noData) {
    return (
      <section className="h-full rounded-3xl border border-dashed border-slate-700 bg-slate-950/70 p-8 text-center" data-testid="efficiency-gauges">
        <h2 className="text-xl font-bold text-slate-100">Capital efficiency gauges</h2>
        <p className="mt-3 text-slate-400">Waiting for first sync — see /options/setup</p>
      </section>
    );
  }

  const marginTooltip = data.marginUsed && data.marginAvailable
    ? `Margin used / available = ${new Decimal(data.marginUsed).toFixed(2)} / ${new Decimal(data.marginAvailable).toFixed(2)} (${data.marginSource ?? 'unknown'})`
    : 'Margin used / margin available; unavailable until the first margin snapshot.';

  return (
    <section className="grid h-full grid-cols-1 gap-4 md:grid-cols-2" data-testid="efficiency-gauges">
      <SemicircleGauge
        title="Return on Capital at Risk"
        value={data.rocaR_pct}
        suffix="%"
        min={new Decimal(-10)}
        max={new Decimal(25)}
        zones={[
          { label: 'negative', from: 0, to: 29, color: 'rgb(239 68 68)' },
          { label: 'low', from: 29, to: 43, color: 'rgb(100 116 139)' },
          { label: 'target', from: 43, to: 71, color: 'rgb(34 197 94)' },
          { label: 'high', from: 71, to: 100, color: 'rgb(59 130 246)' },
        ]}
        tooltip={`Realized P&L / time-weighted capital at risk = ${formatPct(data.rocaR_pct)}`}
        stale={data.isStale}
      />
      <SemicircleGauge
        title="Margin Utilization"
        value={data.marginUtilization_pct}
        suffix="%"
        min={new Decimal(0)}
        max={new Decimal(100)}
        zones={[
          { label: 'comfortable', from: 0, to: 50, color: 'rgb(34 197 94)' },
          { label: 'watch', from: 50, to: 75, color: 'rgb(245 158 11)' },
          { label: 'high', from: 75, to: 100, color: 'rgb(239 68 68)' },
        ]}
        tooltip={marginTooltip}
        stale={data.isStale}
        footer={<SourcePill source={data.marginSource} />}
      />
    </section>
  );
}
