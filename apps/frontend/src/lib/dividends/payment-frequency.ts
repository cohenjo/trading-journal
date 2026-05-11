import type { PaymentFrequency } from '@/types/dividends';

/**
 * Detects dividend payment frequency from a list of ex-dates.
 * Returns null when there are fewer than 2 dates to compare.
 *
 * Thresholds (average interval in days):
 *   ≤ 40   → monthly
 *   ≤ 100  → quarterly
 *   ≤ 200  → semi-annual
 *   ≤ 450  → annual
 *   > 450  → irregular
 */
export function detectPaymentFrequency(dates: string[]): PaymentFrequency {
  if (dates.length < 2) return dates.length === 1 ? 'annual' : null;

  const sorted = [...dates].sort();
  let totalDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff =
      (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) /
      (1000 * 60 * 60 * 24);
    totalDays += diff;
  }
  const avgDays = totalDays / (sorted.length - 1);

  if (avgDays <= 40) return 'monthly';
  if (avgDays <= 100) return 'quarterly';
  if (avgDays <= 200) return 'semi-annual';
  if (avgDays <= 450) return 'annual';
  return 'irregular';
}
