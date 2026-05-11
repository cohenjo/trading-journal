import { describe, it, expect } from 'vitest';
import { normalizeAccountType, VALID_ACCOUNT_TYPES } from './account-type';

describe('normalizeAccountType', () => {
  it.each([
    ['IBKR',    'ibkr'   ],
    ['Schwab',  'schwab' ],
    ['IRA',     'ira'    ],
    ['SCHWAB',  'schwab' ],
    ['ibkr',    'ibkr'   ],
    ['schwab',  'schwab' ],
    ['ira',     'ira'    ],
    [' IBKR ',  'ibkr'   ],  // trims surrounding whitespace
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeAccountType(input)).toBe(expected);
  });

  it.each([
    ['foo'],
    ['FIDELITY'],
    ['vanguard'],
    [''],
    ['  '],
    ['ibkr2'],
  ])('returns null for unknown value "%s"', (input) => {
    expect(normalizeAccountType(input)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeAccountType(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeAccountType(undefined)).toBeNull();
  });

  it('VALID_ACCOUNT_TYPES contains exactly ibkr, schwab, ira in that order', () => {
    expect([...VALID_ACCOUNT_TYPES]).toEqual(['ibkr', 'schwab', 'ira']);
  });
});
