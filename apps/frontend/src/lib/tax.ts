import type { RSUGrant } from '@/components/Plan/types';

export const INFLATION_RATE = 1.015;

const baseBrackets = [
  { limit: 7010, rate: 0.10 },
  { limit: 10060, rate: 0.14 },
  { limit: 16150, rate: 0.20 },
  { limit: 22440, rate: 0.31 },
  { limit: 46690, rate: 0.35 },
  { limit: 60000, rate: 0.47 },
  { limit: Infinity, rate: 0.50 }
];

const baseCreditPoint = 242;

/**
 * Calculates the marginal tax on a given monthly taxable income.
 * Optionally applies the standard 2.25 credit points for a resident.
 */
export function calculateMarginalTax(monthlyTaxableIncome: number, currentYear: number, applyCreditPoints: boolean = true): number {
  if (monthlyTaxableIncome <= 0) return 0;

  const yearsFrom2026 = Math.max(0, currentYear - 2026);
  const inflationFactor = Math.pow(INFLATION_RATE, yearsFrom2026);

  let tax = 0;
  let previousLimit = 0;

  for (const bracket of baseBrackets) {
    const inflatedLimit = bracket.limit * inflationFactor;
    if (monthlyTaxableIncome > previousLimit) {
      const taxableInBracket = Math.min(monthlyTaxableIncome, inflatedLimit) - previousLimit;
      tax += taxableInBracket * bracket.rate;
    }
    previousLimit = inflatedLimit;
  }

  if (applyCreditPoints) {
    const creditPointsAmount = 2.25 * baseCreditPoint * inflationFactor;
    tax = Math.max(0, tax - creditPointsAmount);
  }

  return tax;
}

/**
 * Calculates the tax on additional income (e.g. RSU vesting or sale) on top of a base income.
 * This correctly applies marginal brackets without double-counting credit points.
 */
export function calculateTaxOnAdditionalIncome(baseAnnualIncome: number, additionalAnnualIncome: number, currentYear: number): number {
  if (additionalAnnualIncome <= 0) return 0;

  const baseMonthly = baseAnnualIncome / 12;
  const newMonthly = (baseAnnualIncome + additionalAnnualIncome) / 12;

  // Calculate tax on base (with credit points)
  const baseTax = calculateMarginalTax(baseMonthly, currentYear, true);

  // Calculate tax on new total (with credit points)
  const totalTax = calculateMarginalTax(newMonthly, currentYear, true);

  return (totalTax - baseTax) * 12;
}

/**
 * Calculate the effective tax rate on a Gross RSU withdrawal.
 *
 * In Israel:
 * - Up to grant price: taxed as Income
 * - Above grant price: taxed as Capital Gains (25%)
 *
 * Uses a blended average grant price across all grants.
 */
export function calculateRSUWithdrawalEffectiveTaxRate(
  grossWithdrawalAmount: number,
  rsuGrants: RSUGrant[],
  salePrice: number,
  currentYear: number,
  baseAnnualIncome: number
): number {
  if (grossWithdrawalAmount <= 0) return 0;
  if (!rsuGrants || rsuGrants.length === 0 || salePrice <= 0) return 0; // Fallback to 0 if no grant data or 0 sale price

  let totalShares = 0;
  let totalGrantValue = 0;

  for (const grant of rsuGrants) {
    totalShares += grant.shares;
    totalGrantValue += grant.shares * grant.price;
  }

  if (totalShares <= 0) return 0;

  const blendedGrantPrice = totalGrantValue / totalShares;
  const sharesSold = grossWithdrawalAmount / salePrice;

  const incomePortion = sharesSold * blendedGrantPrice;
  const capGainsPortion = Math.max(0, sharesSold * (salePrice - blendedGrantPrice));

  const incomeTax = calculateTaxOnAdditionalIncome(baseAnnualIncome, incomePortion, currentYear);
  const capGainsTax = capGainsPortion * 0.25;

  const totalTax = incomeTax + capGainsTax;

  return Math.min(0.99, totalTax / grossWithdrawalAmount); // Cap effective tax rate at 99%
}
