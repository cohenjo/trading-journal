/**
 * Canonical account-type utilities for trading_account_config.
 *
 * The DB constraint chk_account_type enforces:
 *   CHECK (account_type IN ('ibkr', 'schwab', 'ira'))
 *
 * Every code path that writes account_type MUST pass through
 * normalizeAccountType() first to guarantee lowercase, validated input.
 *
 * Per Next.js 15 'use server' rules this module MUST NOT carry a
 * 'use server' directive — it is a plain synchronous utility imported
 * by actions.ts internally.
 */

/** Lowercase tokens accepted by the chk_account_type DB constraint. */
export const VALID_ACCOUNT_TYPES = ['ibkr', 'schwab', 'ira'] as const;
export type ValidAccountType = (typeof VALID_ACCOUNT_TYPES)[number];

/**
 * Lowercases the input and validates it against the allowed account types.
 *
 * @returns The canonical lowercase type, or null if the input is unknown.
 *
 * @example normalizeAccountType('IBKR')   → 'ibkr'
 * @example normalizeAccountType('Schwab') → 'schwab'
 * @example normalizeAccountType('IRA')    → 'ira'
 * @example normalizeAccountType('foo')    → null
 * @example normalizeAccountType(null)     → null
 */
export function normalizeAccountType(input: string | null | undefined): ValidAccountType | null {
  const lower = (input ?? '').toLowerCase().trim();
  if ((VALID_ACCOUNT_TYPES as readonly string[]).includes(lower)) {
    return lower as ValidAccountType;
  }
  return null;
}
