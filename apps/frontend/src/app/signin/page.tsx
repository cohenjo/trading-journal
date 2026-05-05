'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Validate the `next` redirect target to prevent open redirects.
 * Must start with `/`, and must not contain `//` or `:` (protocol-relative / absolute URLs).
 */
function isSafeRedirect(next: string | null): next is string {
  if (!next) return false;
  return next.startsWith('/') && !next.includes('//') && !next.includes(':');
}

const SITE_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Maps error codes from the callback URL to human-readable messages. */
const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  auth_callback_failed: 'Google sign-in did not complete. Try again or use a magic link.',
  missing_oauth_code: 'Google sign-in did not complete. Try again or use a magic link.',
  oauth_exchange_failed: 'Google sign-in did not complete. Try again or use a magic link.',
};

/** Inner component — must be wrapped in Suspense because it calls useSearchParams(). */
function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const errorCode = searchParams.get('error');
  const redirectTo = `${SITE_URL}/auth/callback`;

  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (AUTH_ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.') : null,
  );

  // If user lands here while already signed in, bounce to next or home
  useEffect(() => {
    void import('@/lib/supabase/browser').then(({ createClient }) => createClient().auth.getSession()).then(({ data: { session } }) => {
      if (session) {
        const destination = isSafeRedirect(next) ? next : '/';
        window.location.replace(destination);
      }
    });
  }, [next]);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    const { createClient } = await import('@/lib/supabase/browser');
    const supabase = createClient();
    // ⚠️ KEYBOARD TASK: Enable Google OAuth provider in Supabase Studio
    //    → Authentication → Providers → Google → enable + add Client ID & Secret
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: isSafeRedirect(next) ? { next } : undefined,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
    // On success the browser navigates away — no need to setLoading(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { createClient } = await import('@/lib/supabase/browser');
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Magic links use email by default — no extra Supabase Studio config needed
        emailRedirectTo: redirectTo,
      },
    });
    setLoading(false);
    if (otpError) {
      setError(otpError.message);
    } else {
      setMagicLinkSent(true);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Trading Journal</h1>
          <p className="text-slate-400 text-sm">Sign in to access your portfolio</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          {/* Google OAuth */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white text-slate-900 font-medium rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-slate-700" />
            <span className="text-slate-500 text-xs uppercase tracking-wider">or</span>
            <div className="flex-1 border-t border-slate-700" />
          </div>

          {/* Magic link */}
          {magicLinkSent ? (
            <div className="text-center space-y-2 py-4">
              <p className="text-emerald-400 font-medium">✓ Check your inbox</p>
              <p className="text-slate-400 text-sm">
                We sent a magic link to <strong>{email}</strong>. Click it to sign in.
              </p>
              <button
                onClick={() => setMagicLinkSent(false)}
                className="text-slate-500 text-xs underline hover:text-slate-300"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div>
                <label htmlFor="email" className="block text-sm text-slate-400 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-sm transition-colors"
              >
                {loading ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          )}

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs">
          Personal finance &amp; trading journal — household access only
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </main>
    }>
      <SignInForm />
    </Suspense>
  );
}
