import { redirect } from 'next/navigation';

/**
 * Legacy /login route — redirects to the canonical /signin page.
 * Kept for backward compatibility (bookmarks, old email links).
 */
export default function LoginRedirectPage() {
  redirect('/signin');
}
