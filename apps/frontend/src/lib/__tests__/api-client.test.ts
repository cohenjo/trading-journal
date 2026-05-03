import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock must be set up before importing api-client.
// api-client uses a dynamic import('@/lib/supabase/browser'), so we mock the module
// and expose a mocked getSession via the createClient factory.
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
  }),
}));

import { apiFetch, ApiAuthError } from '../api-client';

beforeEach(() => {
  vi.resetAllMocks();
  // Default: restore global fetch mock
  vi.stubGlobal('fetch', vi.fn());
});

describe('apiFetch', () => {
  describe('when a session exists', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        data: { session: { access_token: 'test-jwt-token' } },
        error: null,
      } as ReturnType<typeof supabaseBrowser.auth.getSession> extends Promise<infer T> ? T : never);
    });

    it('attaches Authorization: Bearer header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      await apiFetch('/api/holdings');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer test-jwt-token',
      );
    });

    it('merges caller-supplied headers without clobbering Authorization', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      await apiFetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 1 }),
      });

      const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
      const headers = init?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe('Bearer test-jwt-token');
      expect(headers?.['Content-Type']).toBe('application/json');
    });

    it('returns the Response on success', async () => {
      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await apiFetch('/api/finances/latest');
      expect(result).toBe(mockResponse);
    });

    it('throws ApiAuthError on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

      await expect(apiFetch('/api/holdings')).rejects.toThrow(ApiAuthError);
      await expect(apiFetch('/api/holdings')).rejects.toMatchObject({ status: 401 });
    });

    it('throws ApiAuthError on 403', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));

      await expect(apiFetch('/api/holdings')).rejects.toThrow(ApiAuthError);
      await expect(apiFetch('/api/holdings')).rejects.toMatchObject({ status: 403 });
    });

    it('does NOT throw on other error status codes (e.g. 500)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));

      const result = await apiFetch('/api/holdings');
      expect(result.status).toBe(500);
    });
  });

  describe('when no session exists', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      } as ReturnType<typeof supabaseBrowser.auth.getSession> extends Promise<infer T> ? T : never);
    });

    it('makes the request without an Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      await apiFetch('/api/holdings');

      const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers?.Authorization).toBeUndefined();
    });
  });

  describe('ApiAuthError', () => {
    it('is an instance of Error', () => {
      const err = new ApiAuthError(401);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiAuthError);
    });

    it('carries the status code', () => {
      expect(new ApiAuthError(401).status).toBe(401);
      expect(new ApiAuthError(403).status).toBe(403);
    });

    it('uses a default message when none provided', () => {
      expect(new ApiAuthError(401).message).toContain('401');
    });

    it('accepts a custom message', () => {
      const err = new ApiAuthError(403, 'Forbidden');
      expect(err.message).toBe('Forbidden');
    });
  });
});
