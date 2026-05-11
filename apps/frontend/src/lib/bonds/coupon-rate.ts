/**
 * Coupon-rate display utilities for bond holdings.
 *
 * Bond coupon rates flow through two conventions in this codebase:
 *
 *  - "percentage" (default): the DB-native unit stored in `bond_holdings.coupon_rate`.
 *    4.25 means 4.25 %. Holdings page reads these values directly.
 *
 *  - "decimal": the normalised unit produced by `getLadderOverviewByAccount()` /
 *    `getLadderBondHoldings()`, which divide the DB value by 100 before populating
 *    the `Bond` type used in Ladder components. 0.0425 means 4.25 %.
 *
 * Always use `displayCouponRate` for rendering — never inline `.toFixed()` — so
 * both conventions converge to the same display format and the Bug-2 footgun
 * (accidentally ×100-ing an already-percentage value) cannot recur.
 */

export type CouponKind = 'percentage' | 'decimal';

export interface DisplayCouponRateOptions {
  /** Number of decimal places to render. Defaults to 3. */
  decimals?: number;
  /**
   * Convention of the raw value:
   *   - 'percentage' (default): raw is already in percentage units (e.g. 4.25 → "4.250%")
   *   - 'decimal': raw is a decimal fraction (e.g. 0.0425 → "4.250%")
   */
  kind?: CouponKind;
}

/** Sentinel string rendered when a coupon rate is absent or invalid. */
export const MISSING_COUPON = '—';

/**
 * Format a raw coupon-rate value for display.
 *
 * @param raw    The coupon rate value from the data layer. May be null, undefined, or NaN.
 * @param options Optional formatting and convention options.
 * @returns A string like "4.250%" or "—" when the value is missing/invalid.
 *
 * @example
 * displayCouponRate(3.875)             // "3.875%"
 * displayCouponRate(0.0425, { kind: 'decimal' }) // "4.250%"
 * displayCouponRate(null)              // "—"
 * displayCouponRate(4.5, { decimals: 2 }) // "4.50%"
 */
export function displayCouponRate(
  raw: number | null | undefined,
  options?: DisplayCouponRateOptions,
): string {
  if (raw === null || raw === undefined) return MISSING_COUPON;

  const n = Number(raw);
  if (!Number.isFinite(n)) return MISSING_COUPON;

  const decimals = options?.decimals ?? 3;
  const asPercentage = options?.kind === 'decimal' ? n * 100 : n;

  return `${asPercentage.toFixed(decimals)}%`;
}

/**
 * Parse an unknown input into a coupon-rate number (percentage units) or null.
 *
 * Accepts numbers, numeric strings, null, and undefined. Returns null for any
 * value that cannot be converted to a finite number.
 */
export function parseCouponRate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}
