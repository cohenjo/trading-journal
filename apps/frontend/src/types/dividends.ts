/**
 * Shared types for the Dividends page (Issue #363).
 *
 * DividendPosition — one row in the per-account dividend table.
 * Source-of-truth: stock_positions enriched with dividend_payments +
 * dividend_accruals. No dependency on dividend_ticker_data (empty).
 */

export type PaymentFrequency =
  | 'monthly'
  | 'quarterly'
  | 'semi-annual'
  | 'annual'
  | 'irregular'
  | null;

export type DividendDataSource = 'flex' | 'manual' | 'csv' | null;

/** One dividend-bearing stock position, enriched with TTM and forward yield metrics. */
export interface DividendPosition {
  ticker: string;
  name: string | null;
  quantity: number;
  avg_cost: number | null;
  /** Canonical price in the position's display currency (ILA agorot divided by 100 → ILS). */
  current_price: number | null;
  /** Canonical market value in the position's display currency (ILS for TASE, USD for US, etc.). */
  market_value: number | null;
  /** ISO 4217 display currency code for all monetary amounts on this position.
   *  ILA broker code is normalised to ILS (₪). */
  currency: string;

  // TTM (trailing 12 months from CURRENT_DATETIME = 2026-05-11)
  ttm_div_per_share: number | null;
  ttm_dividend_total: number | null; // dollar — total paid to this position TTM
  ttm_yield_pct: number | null; // (ttm_div_per_share / current_price) × 100

  // Forward / projected (annualised)
  forward_div_per_share: number | null; // from dividend_accruals.gross_rate × freq if present, else TTM
  forward_dividend_annual: number | null; // forward_div_per_share × quantity
  forward_yield_pct: number | null; // (forward_div_per_share / current_price) × 100

  // Metadata
  last_payment_date: string | null; // ISO date of most recent report_date
  payment_frequency: PaymentFrequency;
  source: DividendDataSource;
}

/** Aggregate dividend summary across all accounts (for summary chart). */
export interface DividendSummaryResult {
  total_forward_annual: number;
  position_count: number;
  by_account: Record<'ibkr' | 'schwab' | 'ira', number>;
}
