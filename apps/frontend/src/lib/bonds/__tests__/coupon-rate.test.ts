import { describe, it, expect } from 'vitest';
import { displayCouponRate, parseCouponRate, MISSING_COUPON } from '../coupon-rate';

describe('displayCouponRate', () => {
  describe('percentage convention (default)', () => {
    it('formats 0 as "0.000%"', () => {
      expect(displayCouponRate(0)).toBe('0.000%');
    });

    it('formats 3.875 as "3.875%"', () => {
      expect(displayCouponRate(3.875)).toBe('3.875%');
    });

    it('formats 100 as "100.000%"', () => {
      expect(displayCouponRate(100)).toBe('100.000%');
    });

    it('formats 4.25 as "4.250%"', () => {
      expect(displayCouponRate(4.25)).toBe('4.250%');
    });

    it('formats a whole-number rate like 5 as "5.000%"', () => {
      expect(displayCouponRate(5)).toBe('5.000%');
    });

    it('explicit kind: "percentage" behaves identically to default', () => {
      expect(displayCouponRate(3.875, { kind: 'percentage' })).toBe('3.875%');
    });
  });

  describe('decimal convention', () => {
    it('converts 0.0425 to "4.250%"', () => {
      expect(displayCouponRate(0.0425, { kind: 'decimal' })).toBe('4.250%');
    });

    it('converts 0.03875 to "3.875%"', () => {
      expect(displayCouponRate(0.03875, { kind: 'decimal' })).toBe('3.875%');
    });

    it('converts 0 to "0.000%"', () => {
      expect(displayCouponRate(0, { kind: 'decimal' })).toBe('0.000%');
    });

    it('converts 1 (100% coupon) to "100.000%"', () => {
      expect(displayCouponRate(1, { kind: 'decimal' })).toBe('100.000%');
    });
  });

  describe('missing / invalid values', () => {
    it('returns "—" for null', () => {
      expect(displayCouponRate(null)).toBe(MISSING_COUPON);
    });

    it('returns "—" for undefined', () => {
      expect(displayCouponRate(undefined)).toBe(MISSING_COUPON);
    });

    it('returns "—" for NaN', () => {
      expect(displayCouponRate(NaN)).toBe(MISSING_COUPON);
    });

    it('returns "—" for Infinity', () => {
      expect(displayCouponRate(Infinity)).toBe(MISSING_COUPON);
    });

    it('returns "—" for -Infinity', () => {
      expect(displayCouponRate(-Infinity)).toBe(MISSING_COUPON);
    });
  });

  describe('decimals option', () => {
    it('renders 2 decimal places with decimals: 2', () => {
      expect(displayCouponRate(4.875, { decimals: 2 })).toBe('4.88%');
    });

    it('renders 0 decimal places with decimals: 0', () => {
      expect(displayCouponRate(4.5, { decimals: 0 })).toBe('5%');
    });

    it('renders 5 decimal places with decimals: 5', () => {
      expect(displayCouponRate(3.875, { decimals: 5 })).toBe('3.87500%');
    });

    it('uses decimals with decimal kind', () => {
      expect(displayCouponRate(0.04875, { kind: 'decimal', decimals: 2 })).toBe('4.88%');
    });
  });
});

describe('parseCouponRate', () => {
  it('returns the number for a valid number', () => {
    expect(parseCouponRate(4.25)).toBe(4.25);
  });

  it('returns the number for a numeric string', () => {
    expect(parseCouponRate('3.875')).toBe(3.875);
  });

  it('returns 0 for the number 0', () => {
    expect(parseCouponRate(0)).toBe(0);
  });

  it('returns null for null', () => {
    expect(parseCouponRate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseCouponRate(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseCouponRate(NaN)).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(parseCouponRate('abc')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseCouponRate('')).toBeNull();
  });
});
