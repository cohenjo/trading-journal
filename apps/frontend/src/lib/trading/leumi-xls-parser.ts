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
  /** Original TASE paper number (numeric string). */
  tase_id: string;
  /** ISO 8601 date parsed from the report header (row 2). */
  as_of_date: string;
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

    const tase_id = row[0]?.trim() ?? '';
    const raw_description = row[1]?.trim() ?? '';
    const avg_cost_raw = row[4]?.trim() ?? '';
    const qty_raw = row[5]?.trim() ?? '';

    if (!tase_id || !raw_description) continue;

    const quantity = parseNumber(qty_raw);
    if (isNaN(quantity) || quantity <= 0) continue;

    const avg_cost_val = parseNumber(avg_cost_raw);
    const average_cost = isNaN(avg_cost_val) ? null : avg_cost_val;

    const { symbol, exchange, currency } = deriveExchange(raw_description, tase_id);

    holdings.push({
      symbol,
      exchange,
      quantity,
      average_cost,
      currency,
      raw_description,
      tase_id,
      as_of_date,
    });
  }

  return holdings;
}

// ---------------------------------------------------------------------------
// CSV conversion (for the existing FastAPI import endpoint)
// ---------------------------------------------------------------------------

/**
 * Converts an array of ParsedHolding objects to a CSV string matching the
 * FastAPI /positions/import endpoint expected format:
 *   ticker, quantity, average_cost, currency, as_of_date
 *
 * Holdings with exchange='UNKNOWN' are excluded.
 *
 * @returns { csv, unmappable } where unmappable is the list of excluded holdings.
 */
export function holdingsToCsv(holdings: ParsedHolding[]): {
  csv: string;
  unmappable: ParsedHolding[];
} {
  const header = 'ticker,quantity,average_cost,currency,as_of_date';
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
    return `${h.symbol},${h.quantity},${avg},${h.currency},${h.as_of_date}`;
  });

  return { csv: [header, ...rows].join('\n'), unmappable };
}
