import Decimal from 'decimal.js';

export const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function toDecimal(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

export function formatUsd(value: string | number | Decimal | null | undefined): string {
  return usdFormatter.format(toDecimal(value).toDecimalPlaces(0).toNumber());
}

export function formatSignedUsd(value: string | number | Decimal | null | undefined): string {
  const decimal = toDecimal(value);
  const formatted = formatUsd(decimal.abs());
  if (decimal.isZero()) return formatted;
  return `${decimal.isPositive() ? '+' : '-'}${formatted}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export function monthLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
