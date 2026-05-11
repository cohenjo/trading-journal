import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveExchange,
  parseLeumiDate,
  parseLeumiIraXmlText,
  holdingsToCsv,
  extractRowsFromSpreadsheetML,
  type ParsedHolding,
} from './leumi-xls-parser';

// ---------------------------------------------------------------------------
// deriveExchange — pure function, 95%+ branch coverage required
// ---------------------------------------------------------------------------

describe('deriveExchange', () => {
  // LSE holdings
  it('maps BARCLAYS PLC (BARC LN) to LSE', () => {
    const result = deriveExchange('(BARCLAYS PLC) BARC LN', '60007751');
    expect(result).toEqual({ symbol: 'BARC', exchange: 'LSE', currency: 'GBP' });
  });

  it('maps RIO TINTO PLC (RIO LN) to LSE', () => {
    const result = deriveExchange('(RIO TINTO PLC) RIO LN', '60008327');
    expect(result).toEqual({ symbol: 'RIO', exchange: 'LSE', currency: 'GBP' });
  });

  it('maps LEGAL & GEN GRP (LGEN LN) to LSE', () => {
    const result = deriveExchange('(LEGAL & GEN GRP) LGEN LN', '60008989');
    expect(result).toEqual({ symbol: 'LGEN', exchange: 'LSE', currency: 'GBP' });
  });

  it('maps NATIONAL GRID PLC (NG/ LN) to LSE — ticker has trailing slash', () => {
    const result = deriveExchange('(NATIONAL GRID PLC) NG/ LN', '60100398');
    expect(result).toEqual({ symbol: 'NG/', exchange: 'LSE', currency: 'GBP' });
  });

  it('maps ROLLS-ROYCE HOLD (RR/ LN) to LSE — ticker has trailing slash', () => {
    const result = deriveExchange('(ROLLS-ROYCE HOLD) RR/ LN', '60144514');
    expect(result).toEqual({ symbol: 'RR/', exchange: 'LSE', currency: 'GBP' });
  });

  // US holdings
  it('maps ניאוס נאסד"ק 100 הכנסה גבוהה (QQQI) to US', () => {
    const result = deriveExchange('(ניאוס נאסד"ק 100 הכנסה גבוהה) QQQI', '60398411');
    expect(result).toEqual({ symbol: 'QQQI', exchange: 'US', currency: 'USD' });
  });

  it('maps איי-שיירס JPX ניקיי 400 (JPXN) to US', () => {
    const result = deriveExchange('(איי-שיירס JPX ניקיי 400) JPXN', '60457875');
    expect(result).toEqual({ symbol: 'JPXN', exchange: 'US', currency: 'USD' });
  });

  it('maps איי-שיירס MSCI הודו (INDA) to US', () => {
    const result = deriveExchange('(איי-שיירס MSCI הודו) INDA', '60157418');
    expect(result).toEqual({ symbol: 'INDA', exchange: 'US', currency: 'USD' });
  });

  it('maps קאלאמוס הכנסה מניות ארה"ב (CAIE) to US', () => {
    const result = deriveExchange('(קאלאמוס הכנסה מניות ארה"ב) CAIE', '60472882');
    expect(result).toEqual({ symbol: 'CAIE', exchange: 'US', currency: 'USD' });
  });

  // TASE holdings — 6-digit paper numbers
  it('maps לאומי (604611) to TASE', () => {
    const result = deriveExchange('לאומי', '604611');
    expect(result).toEqual({ symbol: '604611', exchange: 'TASE', currency: 'ILA' });
  });

  it('maps ניו-מד אנרג יהש (475020) to TASE', () => {
    const result = deriveExchange('ניו-מד אנרג יהש', '475020');
    expect(result).toEqual({ symbol: '475020', exchange: 'TASE', currency: 'ILA' });
  });

  it('maps כלל עסקי ביטוח (224014) to TASE', () => {
    const result = deriveExchange('כלל עסקי ביטוח', '224014');
    expect(result).toEqual({ symbol: '224014', exchange: 'TASE', currency: 'ILA' });
  });

  // TASE holdings — 7-digit paper numbers (ETFs, funds)
  it('maps ISHARES CORE MSCI EM IMI UCITS ETF (1159169) to TASE', () => {
    const result = deriveExchange('ISHARES CORE MSCI EM IMI UCITS ETF', '1159169');
    expect(result).toEqual({ symbol: '1159169', exchange: 'TASE', currency: 'ILA' });
  });

  it('maps קסם DJ US Dividend ETF (1146067) to TASE — Israeli TASE ETF with English name', () => {
    const result = deriveExchange('קסם DJ US Dividend ETF', '1146067');
    expect(result).toEqual({ symbol: '1146067', exchange: 'TASE', currency: 'ILA' });
  });

  // TASE holdings — 8-digit numbers starting with 5 (mutual funds)
  it('maps Israeli mutual fund (5130737) to TASE', () => {
    const result = deriveExchange('אי בי אי מחקה Shiller Barclays CAPE® US Core Mid-Month Sector', '5130737');
    expect(result).toEqual({ symbol: '5130737', exchange: 'TASE', currency: 'ILA' });
  });

  it('maps תכלית NASDAQ 100 TTF (5123179) to TASE', () => {
    const result = deriveExchange('תכלית NASDAQ 100 TTF מנוטרלת מט"ח', '5123179');
    expect(result).toEqual({ symbol: '5123179', exchange: 'TASE', currency: 'ILA' });
  });

  // Unknown / edge cases
  it('returns UNKNOWN for 8-digit starting with 6 but no parenthesis in name', () => {
    const result = deriveExchange('SOME FOREIGN SECURITY NO PARENS', '60999999');
    expect(result).toEqual({ symbol: '60999999', exchange: 'UNKNOWN', currency: 'USD' });
  });

  it('returns TASE for empty description with non-foreign paper number', () => {
    const result = deriveExchange('', '123456');
    expect(result).toEqual({ symbol: '123456', exchange: 'TASE', currency: 'ILA' });
  });

  it('does not misclassify 7-digit starting with 6 (not 8-digit) as foreign', () => {
    // 6-digit or 7-digit numbers starting with 6 should still be TASE
    const result = deriveExchange('פועלים', '662577');
    expect(result).toEqual({ symbol: '662577', exchange: 'TASE', currency: 'ILA' });
  });

  it('does not misclassify 9-digit starting with 6 as foreign', () => {
    const result = deriveExchange('חברה כלשהי', '600000001');
    expect(result).toEqual({ symbol: '600000001', exchange: 'TASE', currency: 'ILA' });
  });
});

// ---------------------------------------------------------------------------
// parseLeumiDate
// ---------------------------------------------------------------------------

describe('parseLeumiDate', () => {
  it('converts DD.MM.YY to YYYY-MM-DD', () => {
    expect(parseLeumiDate('11.05.26')).toBe('2026-05-11');
  });

  it('converts a different valid date', () => {
    expect(parseLeumiDate('01.01.25')).toBe('2025-01-01');
  });

  it('returns today for invalid format', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(parseLeumiDate('not-a-date')).toBe(today);
  });

  it('returns today for empty string', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(parseLeumiDate('')).toBe(today);
  });
});

// ---------------------------------------------------------------------------
// extractRowsFromSpreadsheetML
// ---------------------------------------------------------------------------

describe('extractRowsFromSpreadsheetML', () => {
  it('extracts rows and cells from minimal SpreadsheetML', () => {
    const xml = `
      <Row><Cell><Data ss:Type="String">שלום</Data></Cell><Cell><Data ss:Type="Number">42</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">עולם</Data></Cell></Row>
    `;
    const rows = extractRowsFromSpreadsheetML(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['שלום', '42']);
    expect(rows[1]).toEqual(['עולם']);
  });

  it('returns empty array for XML with no Row elements', () => {
    expect(extractRowsFromSpreadsheetML('<Workbook></Workbook>')).toEqual([]);
  });

  it('handles empty cells', () => {
    const xml = `<Row><Cell><Data ss:Type="String"></Data></Cell><Cell><Data ss:Type="String">hello</Data></Cell></Row>`;
    const rows = extractRowsFromSpreadsheetML(xml);
    expect(rows[0]).toEqual(['', 'hello']);
  });
});

// ---------------------------------------------------------------------------
// parseLeumiIraXmlText — using synthetic fixture
// ---------------------------------------------------------------------------

describe('parseLeumiIraXmlText', () => {
  const fixturePath = join(__dirname, '__tests__', 'fixtures', 'leumi-ira-sample.xls');
  const fixtureXml = readFileSync(fixturePath, 'utf-8');

  it('parses the redacted fixture without throwing', () => {
    expect(() => parseLeumiIraXmlText(fixtureXml)).not.toThrow();
  });

  it('returns 7 holdings from the fixture', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    expect(holdings).toHaveLength(7);
  });

  it('parses the as_of_date from row 2 as 2026-05-11', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    expect(holdings.every(h => h.as_of_date === '2026-05-11')).toBe(true);
  });

  it('correctly identifies TASE holdings (604611 = לאומי)', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const leumi = holdings.find(h => h.tase_id === '604611');
    expect(leumi).toBeDefined();
    expect(leumi!.exchange).toBe('TASE');
    expect(leumi!.symbol).toBe('604611');
    expect(leumi!.currency).toBe('ILA');
    expect(leumi!.quantity).toBe(1010);
    expect(leumi!.average_cost).toBe(3593.44);
  });

  it('correctly identifies TASE holdings (475020 = ניו-מד אנרג יהש)', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const newmed = holdings.find(h => h.tase_id === '475020');
    expect(newmed).toBeDefined();
    expect(newmed!.exchange).toBe('TASE');
    expect(newmed!.symbol).toBe('475020');
    expect(newmed!.raw_description).toBe('ניו-מד אנרג יהש');
  });

  it('correctly identifies JPXN as US exchange', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const jpxn = holdings.find(h => h.symbol === 'JPXN');
    expect(jpxn).toBeDefined();
    expect(jpxn!.exchange).toBe('US');
    expect(jpxn!.currency).toBe('USD');
    expect(jpxn!.quantity).toBe(60);
    expect(jpxn!.average_cost).toBe(99.20);
  });

  it('correctly identifies QQQI as US exchange with Hebrew description', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const qqqi = holdings.find(h => h.symbol === 'QQQI');
    expect(qqqi).toBeDefined();
    expect(qqqi!.exchange).toBe('US');
    expect(qqqi!.currency).toBe('USD');
    // Hebrew must survive round-trip
    expect(qqqi!.raw_description).toContain('ניאוס נאסד"ק');
  });

  it('correctly identifies BARC LN as LSE', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const barc = holdings.find(h => h.symbol === 'BARC');
    expect(barc).toBeDefined();
    expect(barc!.exchange).toBe('LSE');
    expect(barc!.currency).toBe('GBP');
    expect(barc!.quantity).toBe(2159);
  });

  it('correctly identifies RIO LN as LSE', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const rio = holdings.find(h => h.symbol === 'RIO');
    expect(rio).toBeDefined();
    expect(rio!.exchange).toBe('LSE');
  });

  it('correctly identifies NG/ LN as LSE with slash in ticker', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const ng = holdings.find(h => h.tase_id === '60100398');
    expect(ng).toBeDefined();
    expect(ng!.exchange).toBe('LSE');
    expect(ng!.symbol).toBe('NG/');
  });

  it('all quantities are positive', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    expect(holdings.every(h => h.quantity > 0)).toBe(true);
  });

  it('preserves Hebrew text in raw_description round-trip', () => {
    const holdings = parseLeumiIraXmlText(fixtureXml);
    const hebrewHoldings = holdings.filter(h => h.raw_description.match(/[\u0590-\u05FF]/));
    // At least the 2 TASE holdings and the US holdings with Hebrew names
    expect(hebrewHoldings.length).toBeGreaterThanOrEqual(4);
    // Specific Hebrew string test
    const leumi = holdings.find(h => h.tase_id === '604611');
    expect(leumi!.raw_description).toBe('לאומי');
  });

  it('returns empty array for XML with fewer than 6 rows', () => {
    const shortXml = `<Row><Cell><Data ss:Type="String">title</Data></Cell></Row>`;
    expect(parseLeumiIraXmlText(shortXml)).toEqual([]);
  });

  it('skips rows with zero or invalid quantity', () => {
    const badRow = `
      <Row><Cell><Data>title</Data></Cell></Row>
      <Row><Cell><Data>11.05.26</Data></Cell><Cell><Data>date</Data></Cell></Row>
      <Row><Cell><Data>summary1</Data></Cell></Row>
      <Row><Cell><Data>summary2</Data></Cell></Row>
      <Row><Cell><Data>header</Data></Cell></Row>
      <Row>
        <Cell><Data>604611</Data></Cell>
        <Cell><Data>לאומי</Data></Cell>
        <Cell><Data>לא קיים</Data></Cell>
        <Cell><Data>קיים</Data></Cell>
        <Cell><Data>3593.44</Data></Cell>
        <Cell><Data>0</Data></Cell>
      </Row>
    `;
    const holdings = parseLeumiIraXmlText(badRow);
    expect(holdings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// holdingsToCsv
// ---------------------------------------------------------------------------

describe('holdingsToCsv', () => {
  const baseDateIso = '2026-05-11';

  const holdings: ParsedHolding[] = [
    {
      symbol: 'QQQI',
      exchange: 'US',
      quantity: 700,
      average_cost: 54.57,
      currency: 'USD',
      raw_description: '(ניאוס נאסד"ק 100 הכנסה גבוהה) QQQI',
      tase_id: '60398411',
      as_of_date: baseDateIso,
    },
    {
      symbol: 'BARC',
      exchange: 'LSE',
      quantity: 2159,
      average_cost: 1.98,
      currency: 'GBP',
      raw_description: '(BARCLAYS PLC) BARC LN',
      tase_id: '60007751',
      as_of_date: baseDateIso,
    },
    {
      symbol: '604611',
      exchange: 'TASE',
      quantity: 1010,
      average_cost: 3593.44,
      currency: 'ILA',
      raw_description: 'לאומי',
      tase_id: '604611',
      as_of_date: baseDateIso,
    },
    {
      symbol: '60999998',
      exchange: 'UNKNOWN',
      quantity: 100,
      average_cost: null,
      currency: 'USD',
      raw_description: 'MYSTERY SECURITY',
      tase_id: '60999998',
      as_of_date: baseDateIso,
    },
  ];

  it('produces CSV with correct header row', () => {
    const { csv } = holdingsToCsv(holdings);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ticker,quantity,average_cost,currency,as_of_date');
  });

  it('includes mappable holdings (US, LSE, TASE) in CSV', () => {
    const { csv } = holdingsToCsv(holdings);
    expect(csv).toContain('QQQI,700,54.57,USD,2026-05-11');
    expect(csv).toContain('BARC,2159,1.98,GBP,2026-05-11');
    expect(csv).toContain('604611,1010,3593.44,ILA,2026-05-11');
  });

  it('excludes UNKNOWN holdings from CSV', () => {
    const { csv } = holdingsToCsv(holdings);
    expect(csv).not.toContain('60999998');
    expect(csv).not.toContain('MYSTERY SECURITY');
  });

  it('returns UNKNOWN holding in unmappable array', () => {
    const { unmappable } = holdingsToCsv(holdings);
    expect(unmappable).toHaveLength(1);
    expect(unmappable[0].tase_id).toBe('60999998');
    expect(unmappable[0].raw_description).toBe('MYSTERY SECURITY');
  });

  it('handles null average_cost with empty field', () => {
    const { csv } = holdingsToCsv([
      {
        symbol: 'QQQI',
        exchange: 'US',
        quantity: 100,
        average_cost: null,
        currency: 'USD',
        raw_description: 'test',
        tase_id: '60398411',
        as_of_date: baseDateIso,
      },
    ]);
    expect(csv).toContain('QQQI,100,,USD,2026-05-11');
  });

  it('returns empty unmappable for all-mappable input', () => {
    const { unmappable } = holdingsToCsv(holdings.slice(0, 3));
    expect(unmappable).toHaveLength(0);
  });

  it('produces only header for empty input', () => {
    const { csv, unmappable } = holdingsToCsv([]);
    expect(csv).toBe('ticker,quantity,average_cost,currency,as_of_date');
    expect(unmappable).toHaveLength(0);
  });
});
