import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseSchwabCsv,
  isSchwabCsv,
  parseCsvRow,
} from './schwab-csv-parser';

const FIXTURE_PATH = join(__dirname, '__tests__/fixtures/schwab-positions-sample.csv');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');

// ── Detection tests ──────────────────────────────────────────────────────────

describe('isSchwabCsv', () => {
  it('detects Schwab format by quoted preamble', () => {
    expect(isSchwabCsv('"Positions for account Joint Tenant')).toBe(true);
  });

  it('detects Schwab format by unquoted preamble', () => {
    expect(isSchwabCsv('Positions for account ...')).toBe(true);
  });

  it('returns false for generic CSV', () => {
    expect(isSchwabCsv('ticker,quantity,currency')).toBe(false);
  });

  it('returns false for Leumi XLS XML', () => {
    expect(isSchwabCsv('<?xml version="1.0"')).toBe(false);
  });
});

// ── parseCsvRow tests ────────────────────────────────────────────────────────

describe('parseCsvRow', () => {
  it('parses simple comma-separated values', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsvRow('"hello, world",foo')).toEqual(['hello, world', 'foo']);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsvRow('"say ""hi""",bar')).toEqual(['say "hi"', 'bar']);
  });

  it('handles empty fields', () => {
    expect(parseCsvRow('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles trailing comma (Schwab rows end with comma)', () => {
    expect(parseCsvRow('"ABR","200","6.865","Equity",')).toHaveLength(5);
  });
});

// ── parseSchwabCsv — fixture tests ──────────────────────────────────────────

describe('parseSchwabCsv — fixture', () => {
  let positions: ReturnType<typeof parseSchwabCsv>;

  beforeAll(() => {
    positions = parseSchwabCsv(fixtureText);
  });

  it('parses exactly 5 equity/ETF positions (skips Cash and Positions Total)', () => {
    expect(positions).toHaveLength(5);
  });

  it('first symbol is ABR', () => {
    expect(positions[0].symbol).toBe('ABR');
  });

  it('second symbol is ADC', () => {
    expect(positions[1].symbol).toBe('ADC');
  });

  it('third symbol is JEPQ', () => {
    expect(positions[2].symbol).toBe('JEPQ');
  });

  it('parses description correctly', () => {
    expect(positions[0].description).toBe('ARBOR RLTY TR INC REIT');
    expect(positions[2].description).toBe('JPMORGAN NASDAQ EQUITY PREMIUM INCOME ETF');
    expect(positions[3].description).toBe('WALMART INC');
  });

  it('parses quantity as number', () => {
    expect(positions[0].quantity).toBe(200);
    expect(positions[2].quantity).toBe(155);
    expect(positions[3].quantity).toBe(300);
  });

  it('parses mark_price (Price column) correctly', () => {
    expect(positions[0].mark_price).toBeCloseTo(6.865);
    expect(positions[1].mark_price).toBeCloseTo(76.825);
    expect(positions[2].mark_price).toBeCloseTo(59.6786);
  });

  it('parses dividend_yield from percentage string', () => {
    // "16.64%" → 0.1664
    expect(positions[0].dividend_yield).toBeCloseTo(0.1664, 4);
    // "4.2%" → 0.042
    expect(positions[1].dividend_yield).toBeCloseTo(0.042, 4);
    // "0.76%" → 0.0076
    expect(positions[3].dividend_yield).toBeCloseTo(0.0076, 4);
  });

  it('parses market_value from $-prefixed string', () => {
    expect(positions[0].market_value).toBeCloseTo(1373.0);
    expect(positions[2].market_value).toBeCloseTo(9250.18);
  });

  it('parses cost_basis_total from $-prefixed string', () => {
    expect(positions[0].cost_basis_total).toBeCloseTo(2550.0);
    expect(positions[2].cost_basis_total).toBeCloseTo(8321.65);
  });

  it('sets exchange to US for all positions', () => {
    positions.forEach(p => expect(p.exchange).toBe('US'));
  });

  it('sets currency to USD for all positions', () => {
    positions.forEach(p => expect(p.currency).toBe('USD'));
  });

  it('sets market_value_local to null (USD-only account)', () => {
    positions.forEach(p => expect(p.market_value_local).toBeNull());
  });

  it('sets as_of_date from preamble date', () => {
    positions.forEach(p => expect(p.as_of_date).toBe('2026-05-11'));
  });

  it('sets tase_id to empty string (not TASE)', () => {
    positions.forEach(p => expect(p.tase_id).toBe(''));
  });

  it('skips Cash & Cash Investments row', () => {
    const symbols = positions.map(p => p.symbol);
    expect(symbols).not.toContain('Cash & Cash Investments');
    expect(symbols).not.toContain('CASH & CASH INVESTMENTS');
  });

  it('skips Positions Total row', () => {
    const symbols = positions.map(p => p.symbol);
    expect(symbols).not.toContain('Positions Total');
    expect(symbols).not.toContain('POSITIONS TOTAL');
  });

  it('SGOV has low dividend yield', () => {
    const sgov = positions.find(p => p.symbol === 'SGOV');
    expect(sgov).toBeDefined();
    expect(sgov!.dividend_yield).toBeCloseTo(0.0356, 4);
  });
});

// ── parseSchwabCsv — edge cases ──────────────────────────────────────────────

describe('parseSchwabCsv — edge cases', () => {
  it('returns [] for empty input', () => {
    expect(parseSchwabCsv('')).toEqual([]);
  });

  it('returns [] if fewer than 3 lines', () => {
    expect(parseSchwabCsv('"Positions for account"\n')).toEqual([]);
  });

  it('returns [] if no header row found', () => {
    const csv = '"Positions for account"\nfoo,bar\nbaz,qux\n';
    expect(parseSchwabCsv(csv)).toEqual([]);
  });

  it('skips rows with zero quantity', () => {
    const csv = [
      '"Positions for account test as of 2026/05/11"',
      '"Symbol","Description","Qty (Quantity)","Price","Price Chng $","Price Chng %","Mkt Val (Market Value)","Day Chng $","Day Chng %","Cost Basis","Gain $","Gain %","Ratings","Reinvest?","Reinvest Capital Gains?","% of Acct","Div Yld (Dividend Yield)","P/E Ratio","Asset Type"',
      '"ZRO","ZERO HOLDING","0","10.00","0","0%","$0","$0","0%","$0","$0","0%","-","No","N/A","0%","0%","N/A","Equity"',
    ].join('\n');
    expect(parseSchwabCsv(csv)).toHaveLength(0);
  });

  it('handles N/A dividend yield as null', () => {
    const csv = [
      '"Positions for account test as of 2026/05/11"',
      '"Symbol","Description","Qty (Quantity)","Price","Price Chng $","Price Chng %","Mkt Val (Market Value)","Day Chng $","Day Chng %","Cost Basis","Gain $","Gain %","Ratings","Reinvest?","Reinvest Capital Gains?","% of Acct","Div Yld (Dividend Yield)","P/E Ratio","Asset Type"',
      '"XYZ","XYZ CORP","50","100","0","0%","$5,000","$0","0%","$4,000","$1,000","25%","-","No","N/A","2%","N/A","N/A","Equity"',
    ].join('\n');
    const results = parseSchwabCsv(csv);
    expect(results).toHaveLength(1);
    expect(results[0].dividend_yield).toBeNull();
  });
});
