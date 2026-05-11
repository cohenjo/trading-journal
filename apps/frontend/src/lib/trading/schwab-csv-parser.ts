/**
 * Schwab Joint Tenant positions CSV parser.
 *
 * Schwab exports holdings as a CSV with the following structure:
 *
 *   Row 1  – Preamble: "Positions for account Joint Tenant ...NNN as of HH:MM AM/PM ET, YYYY/MM/DD"
 *   Row 2  – Column header row
 *   Row 3+ – One equity/ETF position per row
 *   ...
 *   Last-1 – "Cash & Cash Investments" row (skipped)
 *   Last   – "Positions Total" summary row (skipped)
 *
 * Relevant columns (mapped by header name, case-insensitive):
 *   Symbol                        → symbol (ticker)
 *   Description                   → description (security name)
 *   Qty (Quantity)                → quantity
 *   Price                         → mark_price (snapshot price, USD)
 *   Mkt Val (Market Value)        → market_value (USD, e.g. "$1,373.00")
 *   Cost Basis                    → cost_basis_total (USD, e.g. "$2,550.00")
 *   Div Yld (Dividend Yield)      → dividend_yield (e.g. "16.64%" → 0.1664)
 *
 * Exchange is always 'US'; currency is always 'USD'.
 * Rows where Symbol is blank, "Cash & Cash Investments", or "Positions Total"
 * are skipped.
 */

import type { ParsedHolding } from './leumi-xls-parser';

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true if the CSV text looks like a Schwab positions export.
 * Detects the first-line preamble "Positions for account".
 */
export function isSchwabCsv(text: string): boolean {
  return text.trimStart().startsWith('"Positions for account') ||
    text.trimStart().startsWith('Positions for account');
}

// ── Numeric helpers ──────────────────────────────────────────────────────────

/**
 * Parses a currency string like "$1,373.00" or "-$69.00" → number.
 * Returns null on blank or non-parseable input.
 */
function parseCurrency(raw: string): number | null {
  if (!raw || raw === '--' || raw === 'N/A') return null;
  // Remove $, commas; handle "-$" → negative
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a percentage string like "16.64%" → 0.1664.
 * Returns null on blank or non-parseable input.
 */
function parsePct(raw: string): number | null {
  if (!raw || raw === '--' || raw === 'N/A') return null;
  const cleaned = raw.replace(/%/g, '').replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * Parses a plain numeric string (no $ or % prefix).
 * Returns null on blank or non-parseable input.
 */
function parseNum(raw: string): number | null {
  if (!raw || raw === '--' || raw === 'N/A') return null;
  const n = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ── CSV row parser ───────────────────────────────────────────────────────────

/**
 * Parses a single CSV line into an array of field values.
 * Handles double-quoted fields (including embedded commas and escaped quotes "").
 */
export function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  fields.push(current);
  return fields;
}

// ── Preamble date extraction ─────────────────────────────────────────────────

/**
 * Extracts the as-of date from the Schwab preamble line.
 * Example: "Positions for account Joint Tenant ...051 as of 10:45 AM ET, 2026/05/11"
 *          → "2026-05-11"
 * Falls back to today on parse failure.
 */
function extractAsOfDate(preamble: string): string {
  // Match "YYYY/MM/DD" at end of string
  const match = preamble.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return new Date().toISOString().slice(0, 10);
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Parses a Schwab Joint Tenant CSV positions export.
 *
 * @param text  Raw CSV text (UTF-8).
 * @returns     Array of ParsedHolding objects, one per equity/ETF position.
 *              Cash rows and summary rows are omitted.
 */
export function parseSchwabCsv(text: string): ParsedHolding[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 3) return [];

  // Row 0: preamble with date
  const as_of_date = extractAsOfDate(lines[0]);

  // Find header row (contains "Symbol")
  let headerIdx = -1;
  let headerMap: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    if (/Symbol/i.test(lines[i])) {
      headerIdx = i;
      const cols = parseCsvRow(lines[i]);
      cols.forEach((col, idx) => {
        headerMap[col.toLowerCase().trim()] = idx;
      });
      break;
    }
  }
  if (headerIdx < 0) return [];

  // Helper to look up a column by partial name (case-insensitive prefix match)
  const col = (needle: string): number => {
    for (const [key, idx] of Object.entries(headerMap)) {
      if (key.startsWith(needle.toLowerCase())) return idx;
    }
    return -1;
  };

  const idxSymbol = col('symbol');
  const idxDesc   = col('description');
  const idxQty    = col('qty');
  const idxPrice  = col('price');
  const idxMktVal = col('mkt val');
  const idxCostBasis = col('cost basis');
  const idxGainDollar = col('gain $');
  const idxDivYld = col('div yld');

  if (idxSymbol < 0 || idxQty < 0) return [];

  const SKIP_SYMBOLS = new Set(['cash & cash investments', 'positions total', '--', '']);

  const holdings: ParsedHolding[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseCsvRow(lines[i]);
    const symbol = (fields[idxSymbol] ?? '').trim();
    if (SKIP_SYMBOLS.has(symbol.toLowerCase())) continue;
    if (!symbol) continue;

    const description = idxDesc >= 0 ? (fields[idxDesc] ?? '').trim() : null;
    const qtyRaw = idxQty >= 0 ? (fields[idxQty] ?? '') : '';
    const quantity = parseNum(qtyRaw);
    if (quantity == null || quantity <= 0) continue;

    const mark_price = idxPrice >= 0 ? parseNum((fields[idxPrice] ?? '')) : null;
    const market_value = idxMktVal >= 0 ? parseCurrency((fields[idxMktVal] ?? '')) : null;
    const cost_basis_total = idxCostBasis >= 0 ? parseCurrency((fields[idxCostBasis] ?? '')) : null;
    const unrealized_pnl = idxGainDollar >= 0 ? parseCurrency((fields[idxGainDollar] ?? '')) : null;
    const dividend_yield = idxDivYld >= 0 ? parsePct((fields[idxDivYld] ?? '')) : null;

    holdings.push({
      symbol: symbol.toUpperCase(),
      exchange: 'US',
      quantity,
      average_cost: null,         // Schwab doesn't export per-share avg cost
      currency: 'USD',
      raw_description: description ?? symbol,
      tase_id: '',
      as_of_date,
      description: description || null,
      mark_price,
      market_value,
      market_value_local: null,   // USD-only account, no local-currency value
      dividend_yield,
      cost_basis_total,
      unrealized_pnl,
    });
  }

  return holdings;
}
