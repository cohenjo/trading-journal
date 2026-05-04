'use client';

export default function OptionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="rounded-3xl border border-red-500/40 bg-red-500/10 p-8 text-red-100">
        <h1 className="text-2xl font-bold">Options dashboard could not load</h1>
        <p className="mt-3 text-red-100/80">Please refresh the page. If the problem continues, check the latest options sync run.</p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="mt-4 max-h-80 overflow-auto rounded-2xl bg-red-950/60 p-4 text-xs">{error.stack ?? error.message}</pre>
        )}
        <button type="button" onClick={reset} className="mt-5 rounded-full bg-red-200 px-5 py-2 font-semibold text-red-950">Try again</button>
      </div>
    </div>
  );
}
