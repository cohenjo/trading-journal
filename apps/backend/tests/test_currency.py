"""Comprehensive tests for currency conversion utilities.

Tests cover:
- Known currency conversions with hardcoded rates
- Same-currency conversions (identity)
- Round-trip conversions (A→B→A consistency)
- Edge cases: zero, negative amounts
- Unknown currency handling (fallback to 1.0 rate)
- Special case: ILA (Agorot) conversions
- Currency normalization logic
"""

import pytest
from app.utils.currency import convert_currency, normalize_currency, RATES


class TestCurrencyConversion:
    """Test suite for convert_currency function."""

    def test_same_currency_identity(self):
        """Converting to the same currency should return the original amount."""
        assert convert_currency(100.0, 'ILS', 'ILS') == 100.0
        assert convert_currency(100.0, 'USD', 'USD') == 100.0
        assert convert_currency(100.0, 'EUR', 'EUR') == 100.0
        assert convert_currency(123.45, 'ILS', 'ILS') == 123.45

    def test_ils_to_usd_conversion(self):
        """ILS to USD conversion with known rate (1 USD = 3.0 ILS)."""
        # 300 ILS = 100 USD (300 / 3.0)
        assert convert_currency(300.0, 'ILS', 'USD') == 100.0
        # 150 ILS = 50 USD
        assert convert_currency(150.0, 'ILS', 'USD') == 50.0
        # 1 ILS = 0.333... USD
        result = convert_currency(1.0, 'ILS', 'USD')
        assert abs(result - 0.3333333333333333) < 0.0001

    def test_usd_to_ils_conversion(self):
        """USD to ILS conversion with known rate (1 USD = 3.0 ILS)."""
        # 100 USD = 300 ILS
        assert convert_currency(100.0, 'USD', 'ILS') == 300.0
        # 50 USD = 150 ILS
        assert convert_currency(50.0, 'USD', 'ILS') == 150.0
        # 1 USD = 3.0 ILS
        assert convert_currency(1.0, 'USD', 'ILS') == 3.0

    def test_ils_to_eur_conversion(self):
        """ILS to EUR conversion with known rate (1 EUR = 3.5 ILS)."""
        # 350 ILS = 100 EUR
        assert convert_currency(350.0, 'ILS', 'EUR') == 100.0
        # 175 ILS = 50 EUR
        assert convert_currency(175.0, 'ILS', 'EUR') == 50.0
        # 1 ILS = 0.2857... EUR
        result = convert_currency(1.0, 'ILS', 'EUR')
        assert abs(result - 0.2857142857142857) < 0.0001

    def test_eur_to_ils_conversion(self):
        """EUR to ILS conversion with known rate (1 EUR = 3.5 ILS)."""
        # 100 EUR = 350 ILS
        assert convert_currency(100.0, 'EUR', 'ILS') == 350.0
        # 50 EUR = 175 ILS
        assert convert_currency(50.0, 'EUR', 'ILS') == 175.0
        # 1 EUR = 3.5 ILS
        assert convert_currency(1.0, 'EUR', 'ILS') == 3.5

    def test_usd_to_eur_cross_conversion(self):
        """USD to EUR cross-conversion through ILS base currency.
        
        1 USD = 3.0 ILS
        1 EUR = 3.5 ILS
        Therefore: 1 USD = 3.0/3.5 EUR = 0.857... EUR
        """
        # 100 USD = 85.71... EUR
        result = convert_currency(100.0, 'USD', 'EUR')
        assert abs(result - 85.71428571428571) < 0.0001
        
        # 1 USD = 0.857... EUR
        result = convert_currency(1.0, 'USD', 'EUR')
        assert abs(result - 0.8571428571428571) < 0.0001

    def test_eur_to_usd_cross_conversion(self):
        """EUR to USD cross-conversion through ILS base currency.
        
        1 EUR = 3.5 ILS
        1 USD = 3.0 ILS
        Therefore: 1 EUR = 3.5/3.0 USD = 1.1666... USD
        """
        # 100 EUR = 116.666... USD
        result = convert_currency(100.0, 'EUR', 'USD')
        assert abs(result - 116.66666666666667) < 0.0001
        
        # 1 EUR = 1.1666... USD
        result = convert_currency(1.0, 'EUR', 'USD')
        assert abs(result - 1.1666666666666667) < 0.0001

    def test_ila_to_ils_conversion(self):
        """ILA (Agorot) to ILS conversion.
        
        1 ILA = 0.01 ILS (100 Agorot = 1 Shekel)
        """
        # 10000 ILA = 100 ILS
        assert convert_currency(10000.0, 'ILA', 'ILS') == 100.0
        # 100 ILA = 1 ILS
        assert convert_currency(100.0, 'ILA', 'ILS') == 1.0
        # 50 ILA = 0.5 ILS
        assert convert_currency(50.0, 'ILA', 'ILS') == 0.5

    def test_ils_to_ila_conversion(self):
        """ILS to ILA (Agorot) conversion."""
        # 100 ILS = 10000 ILA
        assert convert_currency(100.0, 'ILS', 'ILA') == 10000.0
        # 1 ILS = 100 ILA
        assert convert_currency(1.0, 'ILS', 'ILA') == 100.0
        # 0.5 ILS = 50 ILA
        assert convert_currency(0.5, 'ILS', 'ILA') == 50.0

    def test_zero_amount_returns_zero(self):
        """Zero amounts should always return 0.0."""
        assert convert_currency(0.0, 'ILS', 'USD') == 0.0
        assert convert_currency(0.0, 'USD', 'EUR') == 0.0
        assert convert_currency(0.0, 'EUR', 'ILS') == 0.0
        assert convert_currency(0.0, 'ILA', 'ILS') == 0.0

    def test_negative_amount_conversion(self):
        """Negative amounts should convert correctly (for P&L, etc.)."""
        # -300 ILS = -100 USD
        assert convert_currency(-300.0, 'ILS', 'USD') == -100.0
        # -100 USD = -300 ILS
        assert convert_currency(-100.0, 'USD', 'ILS') == -300.0
        # -350 ILS = -100 EUR
        assert convert_currency(-350.0, 'ILS', 'EUR') == -100.0

    def test_case_insensitive_currency_codes(self):
        """Currency codes should be case-insensitive."""
        assert convert_currency(100.0, 'usd', 'ils') == 300.0
        assert convert_currency(100.0, 'USD', 'ILS') == 300.0
        assert convert_currency(100.0, 'Usd', 'Ils') == 300.0
        assert convert_currency(100.0, 'UsD', 'iLs') == 300.0

    def test_unknown_currency_uses_default_rate(self):
        """Unknown currencies should fallback to 1.0 rate (same as ILS)."""
        # Unknown 'XXX' currency treated as rate 1.0
        assert convert_currency(100.0, 'XXX', 'ILS') == 100.0
        assert convert_currency(100.0, 'ILS', 'XXX') == 100.0
        
        # Unknown to USD: treated as ILS to USD
        result = convert_currency(300.0, 'XXX', 'USD')
        assert result == 100.0  # Same as ILS to USD

    def test_roundtrip_conversion_consistency(self):
        """Converting A→B→A should return the original amount (within floating point precision)."""
        original = 1234.56
        
        # ILS → USD → ILS
        usd = convert_currency(original, 'ILS', 'USD')
        back_to_ils = convert_currency(usd, 'USD', 'ILS')
        assert abs(back_to_ils - original) < 0.0001
        
        # USD → EUR → USD
        eur = convert_currency(original, 'USD', 'EUR')
        back_to_usd = convert_currency(eur, 'EUR', 'USD')
        assert abs(back_to_usd - original) < 0.0001
        
        # EUR → ILS → EUR
        ils = convert_currency(original, 'EUR', 'ILS')
        back_to_eur = convert_currency(ils, 'ILS', 'EUR')
        assert abs(back_to_eur - original) < 0.0001
        
        # ILA → ILS → ILA
        ils_from_ila = convert_currency(original, 'ILA', 'ILS')
        back_to_ila = convert_currency(ils_from_ila, 'ILS', 'ILA')
        assert abs(back_to_ila - original) < 0.0001

    def test_rates_dictionary_values(self):
        """Verify the hardcoded rates are as expected."""
        assert RATES['ILS'] == 1.0
        assert RATES['USD'] == 3.0
        assert RATES['EUR'] == 3.5
        assert RATES['ILA'] == 0.01

    def test_decimal_precision_handling(self):
        """Test conversion handles decimal precision correctly."""
        # Test with various decimal amounts
        assert convert_currency(123.456, 'USD', 'ILS') == 370.368
        
        result = convert_currency(999.999, 'ILS', 'USD')
        expected = 999.999 / 3.0
        assert abs(result - expected) < 0.0001


class TestCurrencyNormalization:
    """Test suite for normalize_currency function."""

    def test_ila_normalizes_to_ils(self):
        """ILA (Agorot) should normalize to ILS for display."""
        assert normalize_currency('ILA') == 'ILS'
        assert normalize_currency('ila') == 'ILS'
        assert normalize_currency('IlA') == 'ILS'

    def test_usd_stays_usd(self):
        """USD should normalize to USD."""
        assert normalize_currency('USD') == 'USD'
        assert normalize_currency('usd') == 'USD'
        assert normalize_currency('Usd') == 'USD'

    def test_ils_stays_ils(self):
        """ILS should normalize to ILS."""
        assert normalize_currency('ILS') == 'ILS'
        assert normalize_currency('ils') == 'ILS'

    def test_eur_stays_eur(self):
        """EUR should pass through as-is (not explicitly handled, but uppercase)."""
        assert normalize_currency('EUR') == 'EUR'
        assert normalize_currency('eur') == 'EUR'

    def test_empty_string_with_ta_ticker_returns_ils(self):
        """Empty currency with .TA ticker should infer ILS."""
        assert normalize_currency('', ticker='AAPL.TA') == 'ILS'
        assert normalize_currency('', ticker='MSFT.TA') == 'ILS'

    def test_empty_string_without_ticker_returns_usd(self):
        """Empty currency without ticker should default to USD."""
        assert normalize_currency('') == 'USD'
        assert normalize_currency('', ticker='') == 'USD'
        assert normalize_currency('', ticker='AAPL') == 'USD'

    def test_case_normalization(self):
        """All currency codes should be uppercased."""
        assert normalize_currency('usd') == 'USD'
        assert normalize_currency('eur') == 'EUR'
        assert normalize_currency('gbp') == 'GBP'
        assert normalize_currency('jpy') == 'JPY'

    def test_unknown_currency_passes_through(self):
        """Unknown currencies should be uppercased and passed through."""
        assert normalize_currency('GBP') == 'GBP'
        assert normalize_currency('jpy') == 'JPY'
        assert normalize_currency('chf') == 'CHF'
