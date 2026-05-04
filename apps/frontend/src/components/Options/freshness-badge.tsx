interface Props {
  asOf: string | null;
  source: string | null;
}

function freshnessTone(asOf: string | null): string {
  if (!asOf) return 'border-red-500/40 bg-red-500/10 text-red-200';
  const ageMs = Date.now() - new Date(asOf).getTime();
  if (ageMs < 2 * 60 * 60 * 1000) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  if (ageMs < 24 * 60 * 60 * 1000) return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-red-500/40 bg-red-500/10 text-red-200';
}

function formatTimestamp(asOf: string | null): string {
  if (!asOf) return 'Not synced';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(asOf));
}

export default function FreshnessBadge({ asOf, source }: Props) {
  const label = source?.replaceAll('_', ' ') ?? 'unknown';
  return (
    <div className={`rounded-full border px-4 py-2 text-sm font-medium ${freshnessTone(asOf)}`} data-testid="freshness-badge">
      Updated {formatTimestamp(asOf)} <span className="opacity-75">(source: {label})</span>
    </div>
  );
}
