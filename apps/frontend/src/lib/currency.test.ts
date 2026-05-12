import { describe, it, expect } from 'vitest';
import { CURRENCY_RATES, convertCurrency, formatCurrency, type CurrencyCode } from './currency';

describe('CURRENCY_RATES', () => {
  it('should define all supported currencies', () => {
    expect(CURRENCY_RATES).toEqual({
      ILS: 1,
      USD: 3.6,
      GBP: 4.6,
      EUR: 3.9,
    });
  });

  it('should have ILS as base currency (rate = 1)', () => {
    expect(CURRENCY_RATES.ILS).toBe(1);
  });

  it('should have valid exchange rates for USD, GBP and EUR', () => {
    expect(CURRENCY_RATES.USD).toBeGreaterThan(0);
    expect(CURRENCY_RATES.GBP).toBeGreaterThan(0);
    expect(CURRENCY_RATES.EUR).toBeGreaterThan(0);
  });
});

describe('convertCurrency', () => {
  describe('same-currency conversion (identity)', () => {
    it('should return same amount when converting ILS to ILS', () => {
      expect(convertCurrency(100, 'ILS', 'ILS')).toBe(100);
    });

    it('should return same amount when converting USD to USD', () => {
      expect(convertCurrency(100, 'USD', 'USD')).toBe(100);
    });

    it('should return same amount when converting EUR to EUR', () => {
      expect(convertCurrency(100, 'EUR', 'EUR')).toBe(100);
    });

    it('should return same amount when converting GBP to GBP', () => {
      expect(convertCurrency(100, 'GBP', 'GBP')).toBe(100);
    });
  });

  describe('known conversion values', () => {
    it('should convert 360 ILS to 100 USD correctly', () => {
      // 360 ILS * 1 = 360 in ILS base; 360 / 3.6 = 100 USD
      expect(convertCurrency(360, 'ILS', 'USD')).toBe(100);
    });

    it('should convert 100 USD to 360 ILS correctly', () => {
      // 100 USD * 3.6 = 360 in ILS base; 360 / 1 = 360 ILS
      expect(convertCurrency(100, 'USD', 'ILS')).toBe(360);
    });

    it('should convert 390 ILS to 100 EUR correctly', () => {
      // 390 ILS * 1 = 390 in ILS base; 390 / 3.9 = 100 EUR
      expect(convertCurrency(390, 'ILS', 'EUR')).toBe(100);
    });

    it('should convert 100 USD to ~92.31 EUR correctly', () => {
      // 100 USD * 3.6 = 360 in ILS base; 360 / 3.9 ≈ 92.308 EUR
      const result = convertCurrency(100, 'USD', 'EUR');
      expect(result).toBeCloseTo(92.307692, 5);
    });

    it('should convert 100 EUR to ~108.33 USD correctly', () => {
      // 100 EUR * 3.9 = 390 in ILS base; 390 / 3.6 ≈ 108.333 USD
      const result = convertCurrency(100, 'EUR', 'USD');
      expect(result).toBeCloseTo(108.333333, 5);
    });

    it('[GBP] should convert 100 GBP to ~127.78 USD', () => {
      // 100 GBP * 4.6 = 460 ILS; 460 / 3.6 ≈ 127.78 USD (not ~28 USD with old missing rate)
      const result = convertCurrency(100, 'GBP', 'USD');
      expect(result).toBeCloseTo(127.777, 2);
    });

    it('[GBP] should convert 100 USD to ~78.26 GBP', () => {
      // 100 * 3.6 = 360 ILS; 360 / 4.6 ≈ 78.26 GBP
      const result = convertCurrency(100, 'USD', 'GBP');
      expect(result).toBeCloseTo(78.260869, 4);
    });
  });

  describe('edge cases', () => {
    it('should return 0 for zero amount', () => {
      expect(convertCurrency(0, 'USD', 'ILS')).toBe(0);
    });

    it('should return 0 for null amount', () => {
      // @ts-expect-error - testing runtime behavior
      expect(convertCurrency(null, 'USD', 'ILS')).toBe(0);
    });

    it('should return 0 for undefined amount', () => {
      // @ts-expect-error - testing runtime behavior
      expect(convertCurrency(undefined, 'USD', 'ILS')).toBe(0);
    });

    it('should handle negative amounts', () => {
      expect(convertCurrency(-100, 'USD', 'ILS')).toBe(-360);
    });

    it('should handle very large amounts', () => {
      const largeAmount = 1000000000; // 1 billion
      const result = convertCurrency(largeAmount, 'USD', 'ILS');
      expect(result).toBe(3600000000); // 3.6 billion
    });

    it('should handle decimal amounts with precision', () => {
      const result = convertCurrency(123.456, 'ILS', 'USD');
      expect(result).toBeCloseTo(34.293, 3);
    });
  });

  describe('default parameters', () => {
    it('should default to ILS for both from and to when not specified', () => {
      expect(convertCurrency(100)).toBe(100);
    });

    it('should default to ILS for "to" currency when only from is specified', () => {
      expect(convertCurrency(100, 'USD')).toBe(360);
    });
  });

  describe('invalid currency codes', () => {
    it('should fallback to rate 1 for unknown "from" currency', () => {
      // Unknown currency uses rate 1, treated as ILS; JPY is not in CURRENCY_RATES
      // @ts-expect-error - testing runtime behavior
      expect(convertCurrency(100, 'JPY', 'USD')).toBeCloseTo(100 / 3.6, 5);
    });

    it('should fallback to rate 1 for unknown "to" currency', () => {
      // @ts-expect-error - testing runtime behavior
      expect(convertCurrency(100, 'USD', 'JPY')).toBe(360);
    });
  });
});

describe('formatCurrency', () => {
  describe('basic formatting', () => {
    it('should format USD with dollar sign and 2 decimals', () => {
      expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56');
    });

    it('should format ILS with shekel sign and 2 decimals', () => {
      const result = formatCurrency(1234.56, 'ILS');
      expect(result).toContain('1,234.56');
      expect(result).toContain('₪');
    });

    it('should format EUR with euro sign and 2 decimals', () => {
      const result = formatCurrency(1234.56, 'EUR');
      expect(result).toContain('1,234.56');
      expect(result).toContain('€');
    });

    it('should format GBP with pound sign and 2 decimals', () => {
      const result = formatCurrency(1234.56, 'GBP');
      expect(result).toContain('1,234.56');
      expect(result).toContain('£');
    });
  });

  describe('broker sub-unit code normalisation', () => {
    it('[ILA] normalises ILA to ILS — does not throw RangeError', () => {
      // ILA is not an ISO 4217 code; Intl.NumberFormat would throw without normalisation.
      expect(() => formatCurrency(100, 'ILA')).not.toThrow();
      const result = formatCurrency(100, 'ILA');
      expect(result).toContain('₪');
      expect(result).toContain('100.00');
    });

    it('[GBp] normalises GBp to GBP — does not throw RangeError', () => {
      expect(() => formatCurrency(100, 'GBp')).not.toThrow();
      const result = formatCurrency(100, 'GBp');
      expect(result).toContain('£');
      expect(result).toContain('100.00');
    });
  });

  describe('compact mode', () => {
    it('should format large amounts compactly with no decimals', () => {
      const result = formatCurrency(1234567, 'USD', true);
      expect(result).toMatch(/\$1M|\$1\.2M/); // Allows locale variations
    });

    it('should format thousands compactly', () => {
      const result = formatCurrency(12345, 'USD', true);
      expect(result).toMatch(/\$12K|\$12\.3K/);
    });

    it('should format small amounts without compact notation', () => {
      const result = formatCurrency(123, 'USD', true);
      expect(result).toBe('$123');
    });
  });

  describe('edge cases', () => {
    it('should format zero correctly', () => {
      expect(formatCurrency(0, 'USD')).toBe('$0.00');
    });

    it('should format negative amounts', () => {
      const result = formatCurrency(-1234.56, 'USD');
      expect(result).toContain('1,234.56');
      expect(result).toMatch(/-\$|(\$-)/); // Different locales format negatives differently
    });

    it('should format very large numbers', () => {
      const result = formatCurrency(1234567890.12, 'USD', false);
      expect(result).toContain('1,234,567,890.12');
    });

    it('should round decimals appropriately', () => {
      expect(formatCurrency(1234.999, 'USD')).toBe('$1,235.00');
    });
  });

  describe('default parameters', () => {
    it('should default to USD when currency not specified', () => {
      const result = formatCurrency(100);
      expect(result).toBe('$100.00');
    });

    it('should default to non-compact when compact not specified', () => {
      const result = formatCurrency(1000000, 'USD');
      expect(result).toBe('$1,000,000.00');
    });
  });

  describe('currency symbol placement', () => {
    it('should place currency symbol correctly for USD (prefix)', () => {
      const result = formatCurrency(100, 'USD');
      expect(result).toMatch(/^\$/);
    });

    it('should handle ILS symbol placement', () => {
      const result = formatCurrency(100, 'ILS');
      expect(result).toContain('₪');
      expect(result).toContain('100.00');
    });
  });
});

describe('CurrencyCode type', () => {
  it('should be a valid union type of supported currencies', () => {
    const currencies: CurrencyCode[] = ['ILS', 'USD', 'GBP', 'EUR'];
    currencies.forEach(code => {
      expect(CURRENCY_RATES[code]).toBeDefined();
    });
  });
});
