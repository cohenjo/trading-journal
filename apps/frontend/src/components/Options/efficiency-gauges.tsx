function GaugeSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6" data-testid={`gauge-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <div className="mt-6 flex justify-center">
        <svg viewBox="0 0 220 120" className="h-28 w-full max-w-64" role="img" aria-label={`${title} pending gauge`}>
          <path d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="rgb(51 65 85)" strokeWidth="18" strokeLinecap="round" />
          <path d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="rgba(148, 163, 184, 0.22)" strokeWidth="10" strokeLinecap="round" strokeDasharray="8 12" />
          <circle cx="110" cy="100" r="6" fill="rgb(100 116 139)" />
        </svg>
      </div>
      <div className="mt-3 rounded-2xl bg-slate-900/80 px-4 py-3 text-center text-sm font-medium text-slate-400">Pending — Phase 4</div>
    </div>
  );
}

export default function EfficiencyGauges() {
  return (
    <section className="grid h-full grid-cols-1 gap-4 md:grid-cols-2" data-testid="efficiency-gauges">
      <GaugeSkeleton title="Return on Capital at Risk" />
      <GaugeSkeleton title="Margin Utilization" />
    </section>
  );
}
