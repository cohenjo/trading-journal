/**
 * Leumi IRA Excel holdings parser.
 *
 * Leumi exports holdings as a SpreadsheetML XML file with a `.xls` extension.
 * The file is UTF-8 encoded and contains a single worksheet structured as:
 *
 *   Row 1  – Report title
 *   Row 2  – Date ("תאריך:"), account number
 *   Row 3  – Portfolio summary metrics
 *   Row 4  – Additional summary metrics
 *   Row 5  – Column headers (Hebrew)
 *   Row 6+ – One security per row
 *
 * Column layout (row 5 headers → data rows):
 *   0  מספר נייר        – TASE paper number (security identifier)
 *   1  שם הנייר         – Security name (Hebrew / mixed Hebrew+English ticker)
 *   2  אירועים          – Corporate events flag
 *   3  הצבעות           – Voting rights flag
 *   4  שער קניה ממוצע  – Average purchase price (native currency)
 *   5  כמות אחזקה       – Quantity held
 *   6  שער אחרון        – Last price (native currency)
 *   7  שווי אחזקה ב ₪   – Holdings value converted to ILS
 *   8  % שינוי יומי     – Daily change %
 *   9  רווח ב-%         – Profit %
 *  10  רווח ב ₪         – Profit in ILS
 *  11  % מהתיק          – Portfolio weight %
 *  12  שער בסיס         – Base/reference price
 *  13  מס התיק          – Portfolio number
 *
 * Exchange classification heuristic:
 *   Foreign securities on TASE carry 8-digit paper numbers starting with '6'.
 *   Their names follow the pattern "(description) TICKER" or "(description) TICKER LN".
 *     - Trailing " LN" suffix  → London Stock Exchange; currency GBP
 *     - No LN suffix           → US exchange (NYSE / NASDAQ); currency USD
 *   All other paper numbers   → Tel-Aviv Stock Exchange (TASE); currency ILA (agorot)
 *
 * TASE prices are quoted in Israeli Agorot (ILA = 1/100 ILS).
 * US and LSE prices are in their native currencies (USD and GBP respectively).
 */

export type Exchange = 'US' | 'LSE' | 'TASE' | 'UNKNOWN';

export interface ParsedHolding {
  /** Canonical ticker symbol for the detected exchange. */
  symbol: string;
  /** Detected exchange. 'UNKNOWN' when heuristic cannot determine exchange. */
  exchange: Exchange;
  /** Number of shares / units held. */
  quantity: number;
  /** Average purchase price per unit in native currency (null if unavailable). */
  average_cost: number | null;
  /** ISO 4217 currency code for the native exchange. ILA for TASE, USD for US, GBP for LSE. */
  currency: string;
  /** Original Hebrew security name preserved for audit/debugging. */
  raw_description: string;
  /** Original TASE paper number (numeric string). Empty string for non-TASE sources. */
  tase_id: string;
  /** ISO 8601 date parsed from the report header (row 2). */
  as_of_date: string;
  /**
   * Human-readable security name. For TASE: Hebrew name as-is.
   * For foreign securities: extracted from parentheses in raw_description.
   * Populated by Leumi parser (Directive 2026-05-11-1745).
   */
  description?: string | null;
  /**
   * Point-in-time market price from the broker export snapshot.
   * For Leumi: שער אחרון (last price). For Schwab: Price column.
   * Yahoo Finance worker refreshes this going forward.
   */
  mark_price?: number | null;
  /**
   * Holdings value in ILS (Leumi only: שווי אחזקה ב ₪).
   * null for non-ILS sources.
   */
  market_value_local?: number | null;
  /**
   * Dividend yield as a decimal fraction (e.g. 0.0742 = 7.42%).
   * Populated from Schwab's Div Yld column; null for Leumi.
   */
  dividend_yield?: number | null;
  /** Market value in the security's native currency (Schwab: Mkt Val column). */
  market_value?: number | null;
  /** Total cost basis (Schwab: Cost Basis column). */
  cost_basis_total?: number | null;
  /**
   * Unrealized P&L in the holding's native currency.
   * For Leumi: רווח ב ₪ (ILS). For Schwab: Gain $ (Gain/Loss $, USD).
   */
  unrealized_pnl?: number | null;
}

// ---------------------------------------------------------------------------
// Manual override map: TASE paper number → { symbol, exchange, currency }
// Seed this for well-known dual-listed or edge-case securities.
// ---------------------------------------------------------------------------
const TASE_TO_GLOBAL_MAP: Record<string, { symbol: string; exchange: Exchange; currency: string }> = {
  // Examples – extend as edge cases are encountered:
  // '1081157': { symbol: 'TEVA', exchange: 'US', currency: 'USD' },   // Teva Pharmaceuticals
  // '1082763': { symbol: 'CHKP', exchange: 'US', currency: 'USD' },   // Check Point Software
};

// ---------------------------------------------------------------------------
// Pure functions (fully unit-testable)
// ---------------------------------------------------------------------------

/**
 * Derives the canonical exchange, symbol, and native currency for a Leumi IRA holding.
 *
 * @param description  Raw security name from column 1 (שם הנייר).
 * @param tasePaperId  TASE paper number from column 0 (מספר נייר).
 * @returns { symbol, exchange, currency }
 */
export function deriveExchange(
  description: string,
  tasePaperId: string,
): { symbol: string; exchange: Exchange; currency: string } {
  const id = tasePaperId.trim();

  // Check manual override table first.
  if (TASE_TO_GLOBAL_MAP[id]) {
    return TASE_TO_GLOBAL_MAP[id];
  }

  // Foreign securities on TASE: exactly 8-digit paper numbers starting with '6'.
  if (/^6\d{7}$/.test(id)) {
    const desc = description.trim();

    // Expected format: "(Hebrew/English description) TICKER" or "(…) TICKER LN"
    // Match everything after the last closing parenthesis.
    const parenMatch = desc.match(/\)\s+(.+)$/);
    if (parenMatch) {
      const tickerPart = parenMatch[1].trim();

      // London Stock Exchange: ticker ends with " LN" (optionally with a trailing slash, e.g. "NG/ LN").
      const lnMatch = tickerPart.match(/^(.+?)\s+LN$/);
      if (lnMatch) {
        // Strip any trailing slash from the ticker itself (e.g. "NG/" → "NG/").
        // Keep the slash as part of the TASE ticker representation for traceability;
        // callers may normalise it (e.g. "NG/" → "NG" or "NG.L") as needed.
        return { symbol: lnMatch[1].trim(), exchange: 'LSE', currency: 'GBP' };
      }

      // US exchange: any ticker without a trailing exchange suffix.
      return { symbol: tickerPart, exchange: 'US', currency: 'USD' };
    }

    // Parenthesised description was not found – store raw with UNKNOWN exchange.
    return { symbol: id, exchange: 'UNKNOWN', currency: 'USD' };
  }

  // All other paper numbers are TASE-listed securities.
  // TASE prices are quoted in Israeli Agorot (ILA = 1/100 ILS).
  return { symbol: id, exchange: 'TASE', currency: 'ILA' };
}

/**
 * Parses the Hebrew short-date format used by Leumi: DD.MM.YY → YYYY-MM-DD.
 * Falls back to today's date for unrecognised formats.
 */
export function parseLeumiDate(raw: string): string {
  const match = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const [, dd, mm, yy] = match;
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Parses a numeric string that may contain comma thousands-separators.
 * Returns NaN if the string is empty or non-numeric.
 */
function parseNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/**
 * Extracts the human-readable security name from a raw Leumi description.
 *
 * - For TASE securities (non-6-digit-8 paper numbers): the raw_description IS the name.
 * - For foreign securities on TASE (8-digit starting with 6): name is inside parens,
 *   e.g. "(JPMORGAN EQUITY PREMIUM INCOME ETF) JEPI" → "JPMORGAN EQUITY PREMIUM INCOME ETF".
 * - If no parens present (edge case): returns raw_description unchanged.
 */
export function extractDescription(rawDescription: string, tasePaperId: string): string {
  if (/^6\d{7}$/.test(tasePaperId.trim())) {
    const match = rawDescription.trim().match(/^\((.+?)\)/);
    if (match) return match[1].trim();
  }
  return rawDescription.trim();
}

// ---------------------------------------------------------------------------
// XML extraction (SpreadsheetML)
// ---------------------------------------------------------------------------

/**
 * Extracts all cell text values from a SpreadsheetML XML string.
 * Returns a 2D array: rows[rowIndex][colIndex].
 *
 * Uses regex rather than a DOM parser to avoid namespace issues in both
 * browser and server/test environments.
 */
export function extractRowsFromSpreadsheetML(xmlText: string): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<Row[^>]*>([\s\S]*?)<\/Row>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(xmlText)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];
    const cellPattern = /<Data[^>]*>([\s\S]*?)<\/Data>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
      cells.push(cellMatch[1].trim());
    }
    rows.push(cells);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parses a Leumi IRA holdings Excel export (SpreadsheetML XML, UTF-8).
 *
 * @param buffer  File content as ArrayBuffer (from FileReader or fs.readFile).
 * @returns       Array of ParsedHolding objects, one per security row.
 */
export async function parseLeumiIraXls(buffer: ArrayBuffer): Promise<ParsedHolding[]> {
  const text = new TextDecoder('utf-8').decode(buffer);
  return parseLeumiIraXmlText(text);
}

/**
 * Core synchronous parser — accepts the raw XML text string.
 * Exported for direct testing without ArrayBuffer overhead.
 */
export function parseLeumiIraXmlText(xmlText: string): ParsedHolding[] {
  const rows = extractRowsFromSpreadsheetML(xmlText);

  // Need at least 6 rows (4 header + 1 column-header + 1 data)
  if (rows.length < 6) return [];

  // Row 2 (index 1): ["תאריך:", "DD.MM.YY", "תיק:", "account-number", ...]
  const dateRow = rows[1];
  const as_of_date = dateRow.length >= 2 ? parseLeumiDate(dateRow[1]) : new Date().toISOString().slice(0, 10);

  // Rows 6+ (index 5+) are security holdings; row 5 (index 4) is the header row.
  const holdings: ParsedHolding[] = [];

  for (const row of rows.slice(5)) {
    // Minimum: tase_id (col 0), description (col 1), avg_cost (col 4), qty (col 5)
    if (row.length < 6) continue;

    // Col 0 may contain "PAPERNUM Hebrew description" in some Leumi exports.
    // Extract ONLY the leading non-whitespace token as the canonical paper number.
    const tase_id = (row[0]?.trim() ?? '').split(/\s+/)[0];
    const raw_description = row[1]?.trim() ?? '';
    const avg_cost_raw = row[4]?.trim() ?? '';
    const qty_raw = row[5]?.trim() ?? '';
    // Col 6: שער אחרון (last price); Col 7: שווי אחזקה ב ₪ (holding value in ILS)
    // Col 10: רווח ב ₪ (unrealized P&L in ILS)
    const mark_price_raw = row[6]?.trim() ?? '';
    const market_value_local_raw = row[7]?.trim() ?? '';
    const unrealized_pnl_raw = row[10]?.trim() ?? '';

    if (!tase_id || !raw_description) continue;

    const quantity = parseNumber(qty_raw);
    if (isNaN(quantity) || quantity <= 0) continue;

    const avg_cost_val = parseNumber(avg_cost_raw);
    const average_cost = isNaN(avg_cost_val) ? null : avg_cost_val;

    const mark_price_val = parseNumber(mark_price_raw);
    const mark_price = isNaN(mark_price_val) ? null : mark_price_val;

    const market_value_local_val = parseNumber(market_value_local_raw);
    const market_value_local = isNaN(market_value_local_val) ? null : market_value_local_val;

    const unrealized_pnl_val = parseNumber(unrealized_pnl_raw);
    const unrealized_pnl = isNaN(unrealized_pnl_val) ? null : unrealized_pnl_val;

    const { symbol, exchange, currency } = deriveExchange(raw_description, tase_id);
    const description = extractDescription(raw_description, tase_id);

    // For TASE positions: mark_price is in ILA (agorot). Compute the canonical
    // ILS market_value (quantity × agorot / 100) so the import endpoint stores a
    // correct initial value before the Yahoo worker first runs.
    // Non-TASE positions (US/LSE) report prices in their native currency; no
    // division needed — market_value remains null until the worker refreshes.
    const market_value: number | null =
      exchange === 'TASE' && mark_price !== null
        ? parseFloat(((quantity * mark_price) / 100).toFixed(2))
        : null;

    holdings.push({
      symbol,
      exchange,
      quantity,
      average_cost,
      currency,
      raw_description,
      tase_id,
      as_of_date,
      description,
      mark_price,
      market_value_local,
      dividend_yield: null,
      market_value,
      cost_basis_total: null,
      unrealized_pnl,
    });
  }

  return holdings;
}

// ---------------------------------------------------------------------------
// CSV conversion (for the existing FastAPI import endpoint)
// ---------------------------------------------------------------------------

/**
 * Converts an array of ParsedHolding objects to a CSV string matching the
 * import endpoint expected format.
 *
 * Holdings with exchange='UNKNOWN' are excluded and returned in `unmappable`.
 *
 * @returns { csv, unmappable } where unmappable is the list of excluded holdings.
 */
export function holdingsToCsv(holdings: ParsedHolding[]): {
  csv: string;
  unmappable: ParsedHolding[];
} {
  const header = 'ticker,quantity,average_cost,currency,as_of_date,description,mark_price,market_value,market_value_local,dividend_yield,cost_basis_total,unrealized_pnl';
  const mappable: ParsedHolding[] = [];
  const unmappable: ParsedHolding[] = [];

  for (const h of holdings) {
    if (h.exchange === 'UNKNOWN') {
      unmappable.push(h);
    } else {
      mappable.push(h);
    }
  }

  const rows = mappable.map((h) => {
    const avg = h.average_cost !== null ? String(h.average_cost) : '';
    const desc = h.description ? `"${h.description.replace(/"/g, '""')}"` : '';
    const markPr = (h.mark_price ?? null) !== null ? String(h.mark_price) : '';
    const mktVal = (h.market_value ?? null) !== null ? String(h.market_value) : '';
    const mktValLocal = (h.market_value_local ?? null) !== null ? String(h.market_value_local) : '';
    const divYld = (h.dividend_yield ?? null) !== null ? String(h.dividend_yield) : '';
    const costBasisTotal = (h.cost_basis_total ?? null) !== null ? String(h.cost_basis_total) : '';
    const unrealizedPnl = (h.unrealized_pnl ?? null) !== null ? String(h.unrealized_pnl) : '';
    return `${h.symbol},${h.quantity},${avg},${h.currency},${h.as_of_date},${desc},${markPr},${mktVal},${mktValLocal},${divYld},${costBasisTotal},${unrealizedPnl}`;
  });

  return { csv: [header, ...rows].join('\n'), unmappable };
}
