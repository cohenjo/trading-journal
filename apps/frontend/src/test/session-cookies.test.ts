import { describe, expect, it } from 'vitest';
import { sessionCookies } from '../../e2e/fixtures/session-cookies';

describe('E2E Supabase SSR session cookies', () => {
  for (const [supabaseUrl, appUrl, name, domain, secure] of [
    ['http://127.0.0.1:54321', 'http://localhost:3000', 'sb-127-auth-token', 'localhost', false],
    ['http://localhost:54321', 'http://127.0.0.1:3100', 'sb-localhost-auth-token', '127.0.0.1', false],
    ['https://test-ref.supabase.co', 'https://preview.example.com', 'sb-test-ref-auth-token', 'preview.example.com', true],
  ] as const) {
    it(`uses the SSR storage key and target origin for ${supabaseUrl}`, () => {
      const session = { expires_at: 2_000_000_000, expires_in: 3600 };
      const [cookie] = sessionCookies(supabaseUrl, appUrl, session);
      expect(cookie).toMatchObject({ name, domain, secure, path: '/', expires: session.expires_at });
      const json = Buffer.from(cookie.value.slice('base64-'.length), 'base64url').toString();
      expect(JSON.parse(json)).toEqual(session);
    });
  }

  it('chunks long sessions without truncating the token', () => {
    const session = { expires_in: 3600, access_token: 'synthetic'.repeat(1000) };
    const cookies = sessionCookies('http://127.0.0.1:54321', 'http://localhost:3000', session);
    expect(cookies.length).toBeGreaterThan(1);
    expect(cookies.map(cookie => cookie.name)).toEqual(
      cookies.map((_, index) => `sb-127-auth-token.${index}`),
    );
    expect(cookies.every(cookie => cookie.value.length <= 3180)).toBe(true);
    const encoded = cookies.map(cookie => cookie.value).join('');
    expect(JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString())).toEqual(session);
  });
});
