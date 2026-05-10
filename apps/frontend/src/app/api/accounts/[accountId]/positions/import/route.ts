import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/**
 * POST /api/accounts/{accountId}/positions/import
 *
 * Proxies a multipart CSV upload to the FastAPI backend.
 * Field name: "file" (CSV).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;

  if (!accountId || isNaN(Number(accountId))) {
    return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
  }

  try {
    const formData = await request.formData();

    const upstream = await fetch(
      `${BACKEND_BASE}/api/accounts/${accountId}/positions/import`,
      {
        method: 'POST',
        body: formData,
      },
    );

    const body = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: body || `Upstream error ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const json = JSON.parse(body) as unknown;
    return NextResponse.json(json, { status: 200 });
  } catch (err) {
    console.error('[positions/import] proxy error:', err);
    return NextResponse.json(
      { error: 'Import service unavailable' },
      { status: 503 },
    );
  }
}
