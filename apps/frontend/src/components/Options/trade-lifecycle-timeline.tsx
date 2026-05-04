import Decimal from 'decimal.js';
import type { OptionsStrategyKind, StrategyGroup } from '@/types/options';
import { formatDate, formatSignedUsd, toDecimal } from './options-format';

interface Props {
  groups: StrategyGroup[];
}

const KIND_COLORS: Record<OptionsStrategyKind, string> = {
  csp: '#3b82f6',
  vertical_spread: '#a855f7',
  roll_chain: '#f97316',
  ungrouped: '#64748b',
};

function groupLabel(group: StrategyGroup): string {
  const firstTrade = group.trades[0];
  const strikes = Array.from(new Set(group.trades.map((trade) => trade.strike).filter(Boolean))).join('/');
  const expiry = firstTrade?.expiry ? formatDate(firstTrade.expiry).slice(5) : 'open';
  const strategy = group.kind.replaceAll('_', ' ');
  return `${group.underlyingSymbol} ${strategy}${strikes ? ` ${strikes}` : ''} ${expiry}`;
}

function rangeBounds(groups: StrategyGroup[]): { start: number; end: number } {
  const now = Date.now();
  const starts = groups.map((group) => new Date(group.openedAt).getTime()).filter(Number.isFinite);
  const ends = groups.map((group) => new Date(group.closedAt ?? now).getTime()).filter(Number.isFinite);
  const start = Math.min(...starts, now);
  const end = Math.max(...ends, now + 24 * 60 * 60 * 1000);
  return start === end ? { start: start - 1, end: end + 1 } : { start, end };
}

function xFor(date: string | null, start: number, end: number): number {
  const value = date ? new Date(date).getTime() : Date.now();
  return 240 + ((value - start) / (end - start)) * 680;
}

export default function TradeLifecycleTimeline({ groups }: Props) {
  const sorted = [...groups].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const { start, end } = rangeBounds(sorted);
  const height = Math.max(160, sorted.length * 54 + 54);

  if (sorted.length === 0) {
    return (
      <section className="rounded-3xl border border-slate-700/80 bg-slate-950/80 p-6" data-testid="trade-lifecycle-timeline">
        <h2 className="text-lg font-semibold text-slate-100">Trade Lifecycle Timeline</h2>
        <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No strategy groups in this range yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-700/80 bg-slate-950/80 p-5" data-testid="trade-lifecycle-timeline">
      <div className="sticky top-0 z-10 mb-4 bg-slate-950/95 pb-3">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Detected lifecycle</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-100">Trade Lifecycle Timeline</h2>
      </div>
      <div className="max-h-[640px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950">
        <svg viewBox={`0 0 960 ${height}`} className="min-w-[920px]" role="img" aria-label="Strategy group Gantt timeline">
          <line x1="240" x2="920" y1="32" y2="32" stroke="#334155" />
          <text x="240" y="22" fill="#94a3b8" fontSize="12">{formatDate(new Date(start).toISOString())}</text>
          <text x="850" y="22" fill="#94a3b8" fontSize="12">{formatDate(new Date(end).toISOString())}</text>
          {sorted.map((group, index) => {
            const y = 70 + index * 54;
            const x1 = xFor(group.openedAt, start, end);
            const x2 = Math.max(x1 + 10, xFor(group.closedAt, start, end));
            const color = KIND_COLORS[group.kind];
            const rollCount = group.rollEvents.length;
            const cashFlow = toDecimal(group.netCashFlow);
            const realized = toDecimal(group.realizedPnl);
            return (
              <g key={group.id}>
                <text x="16" y={y - 8} fill="#e2e8f0" fontSize="13" fontWeight="700">{groupLabel(group).slice(0, 32)}</text>
                <text x="16" y={y + 10} fill="#94a3b8" fontSize="11">
                  CF {formatSignedUsd(cashFlow)} · P&amp;L {formatSignedUsd(realized)} · rolls {rollCount}
                </text>
                <line x1="240" x2="920" y1={y} y2={y} stroke="#1e293b" strokeDasharray="4 8" />
                <rect x={x1} y={y - 9} width={x2 - x1} height="18" rx="9" fill={color} opacity="0.78">
                  <title>{groupLabel(group)}: {formatDate(group.openedAt)} → {group.closedAt ? formatDate(group.closedAt) : 'open'}</title>
                </rect>
                {group.closedAt === null && <text x={x2 + 8} y={y + 4} fill="#94a3b8" fontSize="11">open</text>}
                {group.rollEvents.map((roll) => {
                  const rx = xFor(roll.detectedAt, start, end);
                  const pnl = new Decimal(roll.closedLegRealizedPnl);
                  return (
                    <polygon
                      key={roll.id}
                      points={`${rx},${y - 15} ${rx + 9},${y} ${rx},${y + 15} ${rx - 9},${y}`}
                      fill="#fb923c"
                      stroke="#fed7aa"
                      strokeWidth="1"
                    >
                      <title>{roll.classification} roll · closed leg {formatSignedUsd(pnl)} · cash {formatSignedUsd(roll.incrementalCashFlow)}</title>
                    </polygon>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
