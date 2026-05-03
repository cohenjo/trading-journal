/**
 * Stub handler for client-side page-load telemetry.
 *
 * PageLoadMetrics fires on every page (including the unauthenticated /login
 * redirect) and POSTs timing data here. When a self-hosted Python backend is
 * configured (NEXT_PUBLIC_API_URL), the request is rewritten there via
 * next.config.ts. When no backend is configured (Vercel / preview deploys),
 * this stub accepts the POST and drops the payload so the browser never sees
 * a 4xx and no console errors are generated.
 *
 * This route is intentionally public (listed under /api/metrics/ in the
 * middleware PUBLIC_PREFIXES) because the session is not yet available when
 * the metrics fire after an unauthenticated redirect.
 */
export async function POST(): Promise<Response> {
  // Accept the payload and return No Content — metrics are best-effort.
  return new Response(null, { status: 204 });
}
