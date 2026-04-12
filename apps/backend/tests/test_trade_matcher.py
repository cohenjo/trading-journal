"""Comprehensive tests for trade matching and P&L calculation.

Tests cover:
- FIFO matching for stock trades (open → close)
- Partial fill matching (multiple opens to one close)
- Same-day trades (chronological matching)
- P&L calculation accuracy for long and short positions
- Multiple symbols in same batch
- Unmatched trades (opens without closes)
- Edge cases: zero quantity, missing data
"""

from datetime import datetime, date

from app.utils.trade_matcher import match_trades
from app.schema.models import Trade


class TestMatchTrades:
    """Test suite for match_trades function."""

    def test_simple_buy_sell_match(self):
        """Basic case: One buy, one sell of same symbol and quantity."""
        trades = [
            Trade(
                tradeID=1,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="AAPL",
                conid=265598,
                multiplier=1,
                dateTime=datetime(2024, 1, 10, 10, 30, 0),
                tradeDate=date(2024, 1, 10),
                quantity=100,
                tradePrice=150.0,
                tradeMoney=15000.0,
                proceeds=-15000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=1001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=2,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="AAPL",
                conid=265598,
                multiplier=1,
                dateTime=datetime(2024, 1, 15, 14, 30, 0),
                tradeDate=date(2024, 1, 15),
                quantity=-100,
                tradePrice=155.0,
                tradeMoney=-15500.0,
                proceeds=15500.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=1002,
                fifoPnlRealized=500.0,  # (155 - 150) * 100
            ),
        ]
        
        matched = match_trades(trades)
        
        assert len(matched) == 1
        assert matched[0].symbol == "AAPL"
        assert matched[0].open_transaction_id == 1001
        assert matched[0].close_transaction_id == 1002
        assert matched[0].open_price == 150.0
        assert matched[0].close_price == 155.0
        assert matched[0].pnl == 500.0

    def test_short_position_match(self):
        """Short sell followed by buy to cover."""
        trades = [
            Trade(
                tradeID=10,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="TSLA",
                conid=76792991,
                multiplier=1,
                dateTime=datetime(2024, 2, 1, 9, 30, 0),
                tradeDate=date(2024, 2, 1),
                quantity=-50,
                tradePrice=200.0,
                tradeMoney=-10000.0,
                proceeds=10000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=2001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=11,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="TSLA",
                conid=76792991,
                multiplier=1,
                dateTime=datetime(2024, 2, 5, 11, 0, 0),
                tradeDate=date(2024, 2, 5),
                quantity=50,
                tradePrice=190.0,
                tradeMoney=9500.0,
                proceeds=-9500.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=2002,
                fifoPnlRealized=500.0,  # Short profit: (200 - 190) * 50
            ),
        ]
        
        matched = match_trades(trades)
        
        assert len(matched) == 1
        assert matched[0].symbol == "TSLA"
        assert matched[0].pnl == 500.0

    def test_multiple_symbols_same_batch(self):
        """Multiple symbols traded in same batch should match independently."""
        trades = [
            # AAPL trades
            Trade(
                tradeID=20,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="AAPL",
                conid=265598,
                multiplier=1,
                dateTime=datetime(2024, 3, 1, 10, 0, 0),
                tradeDate=date(2024, 3, 1),
                quantity=100,
                tradePrice=150.0,
                tradeMoney=15000.0,
                proceeds=-15000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=3001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=21,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="AAPL",
                conid=265598,
                multiplier=1,
                dateTime=datetime(2024, 3, 5, 14, 0, 0),
                tradeDate=date(2024, 3, 5),
                quantity=-100,
                tradePrice=155.0,
                tradeMoney=-15500.0,
                proceeds=15500.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=3002,
                fifoPnlRealized=500.0,
            ),
            # MSFT trades
            Trade(
                tradeID=22,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="MSFT",
                conid=272093,
                multiplier=1,
                dateTime=datetime(2024, 3, 2, 11, 0, 0),
                tradeDate=date(2024, 3, 2),
                quantity=50,
                tradePrice=380.0,
                tradeMoney=19000.0,
                proceeds=-19000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=3003,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=23,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="MSFT",
                conid=272093,
                multiplier=1,
                dateTime=datetime(2024, 3, 6, 15, 0, 0),
                tradeDate=date(2024, 3, 6),
                quantity=-50,
                tradePrice=390.0,
                tradeMoney=-19500.0,
                proceeds=19500.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=3004,
                fifoPnlRealized=500.0,
            ),
        ]
        
        matched = match_trades(trades)
        
        assert len(matched) == 2
        
        aapl_match = [m for m in matched if m.symbol == "AAPL"][0]
        msft_match = [m for m in matched if m.symbol == "MSFT"][0]
        
        assert aapl_match.pnl == 500.0
        assert msft_match.pnl == 500.0

    def test_fifo_matching_multiple_opens(self):
        """FIFO: First in, first out - earlier open matches first."""
        trades = [
            Trade(
                tradeID=30,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="NVDA",
                conid=4815747,
                multiplier=1,
                dateTime=datetime(2024, 4, 1, 9, 30, 0),
                tradeDate=date(2024, 4, 1),
                quantity=100,
                tradePrice=800.0,
                tradeMoney=80000.0,
                proceeds=-80000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=4001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=31,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="NVDA",
                conid=4815747,
                multiplier=1,
                dateTime=datetime(2024, 4, 2, 10, 0, 0),
                tradeDate=date(2024, 4, 2),
                quantity=100,
                tradePrice=810.0,
                tradeMoney=81000.0,
                proceeds=-81000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=4002,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=32,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="NVDA",
                conid=4815747,
                multiplier=1,
                dateTime=datetime(2024, 4, 5, 14, 0, 0),
                tradeDate=date(2024, 4, 5),
                quantity=-100,
                tradePrice=850.0,
                tradeMoney=-85000.0,
                proceeds=85000.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=4003,
                fifoPnlRealized=5000.0,  # Matches first open: (850 - 800) * 100
            ),
        ]
        
        matched = match_trades(trades)
        
        # Should match first open (4001) with close (4003)
        assert len(matched) == 1
        assert matched[0].open_transaction_id == 4001
        assert matched[0].close_transaction_id == 4003
        assert matched[0].open_price == 800.0
        assert matched[0].pnl == 5000.0

    def test_same_day_trades_chronological_matching(self):
        """Same-day trades should match chronologically."""
        trades = [
            Trade(
                tradeID=40,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="SPY",
                conid=756733,
                multiplier=1,
                dateTime=datetime(2024, 5, 10, 9, 30, 0),
                tradeDate=date(2024, 5, 10),
                quantity=200,
                tradePrice=500.0,
                tradeMoney=100000.0,
                proceeds=-100000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=5001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=41,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="SPY",
                conid=756733,
                multiplier=1,
                dateTime=datetime(2024, 5, 10, 15, 45, 0),
                tradeDate=date(2024, 5, 10),
                quantity=-200,
                tradePrice=505.0,
                tradeMoney=-101000.0,
                proceeds=101000.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=5002,
                fifoPnlRealized=1000.0,
            ),
        ]
        
        matched = match_trades(trades)
        
        assert len(matched) == 1
        assert matched[0].pnl == 1000.0

    def test_unmatched_open_trades(self):
        """Open trades without corresponding closes should not match."""
        trades = [
            Trade(
                tradeID=50,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="GOOG",
                conid=208813720,
                multiplier=1,
                dateTime=datetime(2024, 6, 1, 10, 0, 0),
                tradeDate=date(2024, 6, 1),
                quantity=50,
                tradePrice=150.0,
                tradeMoney=7500.0,
                proceeds=-7500.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=6001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=51,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="GOOG",
                conid=208813720,
                multiplier=1,
                dateTime=datetime(2024, 6, 2, 11, 0, 0),
                tradeDate=date(2024, 6, 2),
                quantity=30,
                tradePrice=151.0,
                tradeMoney=4530.0,
                proceeds=-4530.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=6002,
                fifoPnlRealized=0.0,
            ),
        ]
        
        matched = match_trades(trades)
        
        # No closes, so no matches
        assert len(matched) == 0

    def test_empty_trade_list(self):
        """Empty trade list should return empty matches."""
        matched = match_trades([])
        assert matched == []

    def test_only_open_trades_no_matches(self):
        """All opens, no closes = no matches."""
        trades = [
            Trade(
                tradeID=60,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="AMZN",
                conid=3691937,
                multiplier=1,
                dateTime=datetime(2024, 7, 1, 10, 0, 0),
                tradeDate=date(2024, 7, 1),
                quantity=100,
                tradePrice=180.0,
                tradeMoney=18000.0,
                proceeds=-18000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=7001,
                fifoPnlRealized=0.0,
            ),
        ]
        
        matched = match_trades(trades)
        assert len(matched) == 0

    def test_only_close_trades_no_matches(self):
        """All closes, no opens = no matches."""
        trades = [
            Trade(
                tradeID=70,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="NFLX",
                conid=14907129,
                multiplier=1,
                dateTime=datetime(2024, 8, 1, 10, 0, 0),
                tradeDate=date(2024, 8, 1),
                quantity=-100,
                tradePrice=600.0,
                tradeMoney=-60000.0,
                proceeds=60000.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=8001,
                fifoPnlRealized=5000.0,
            ),
        ]
        
        matched = match_trades(trades)
        assert len(matched) == 0

    def test_mismatched_quantity_no_match(self):
        """Open and close with different quantities don't match."""
        trades = [
            Trade(
                tradeID=80,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="META",
                conid=107113386,
                multiplier=1,
                dateTime=datetime(2024, 9, 1, 9, 30, 0),
                tradeDate=date(2024, 9, 1),
                quantity=100,
                tradePrice=450.0,
                tradeMoney=45000.0,
                proceeds=-45000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=9001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=81,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="META",
                conid=107113386,
                multiplier=1,
                dateTime=datetime(2024, 9, 5, 14, 0, 0),
                tradeDate=date(2024, 9, 5),
                quantity=-50,  # Only half the open quantity
                tradePrice=460.0,
                tradeMoney=-23000.0,
                proceeds=23000.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=9002,
                fifoPnlRealized=500.0,
            ),
        ]
        
        matched = match_trades(trades)
        
        # Quantities don't match exactly (-50 != -100), so no match
        assert len(matched) == 0

    def test_missing_datetime_skips_trade(self):
        """Trades with None dateTime should be skipped."""
        trades = [
            Trade(
                tradeID=90,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="DIS",
                conid=4488,
                multiplier=1,
                dateTime=None,  # Missing datetime
                tradeDate=date(2024, 10, 1),
                quantity=100,
                tradePrice=90.0,
                tradeMoney=9000.0,
                proceeds=-9000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=10001,
                fifoPnlRealized=0.0,
            ),
        ]
        
        matched = match_trades(trades)
        assert len(matched) == 0

    def test_missing_transaction_id_no_match(self):
        """Trades with missing transactionID should not match."""
        trades = [
            Trade(
                tradeID=100,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="BA",
                conid=4762,
                multiplier=1,
                dateTime=datetime(2024, 11, 1, 10, 0, 0),
                tradeDate=date(2024, 11, 1),
                quantity=50,
                tradePrice=200.0,
                tradeMoney=10000.0,
                proceeds=-10000.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=None,  # Missing ID
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=101,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="BA",
                conid=4762,
                multiplier=1,
                dateTime=datetime(2024, 11, 5, 14, 0, 0),
                tradeDate=date(2024, 11, 5),
                quantity=-50,
                tradePrice=210.0,
                tradeMoney=-10500.0,
                proceeds=10500.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=11002,
                fifoPnlRealized=500.0,
            ),
        ]
        
        matched = match_trades(trades)
        assert len(matched) == 0

    def test_pnl_calculation_accuracy(self):
        """Verify P&L calculation matches expected value."""
        trades = [
            Trade(
                tradeID=110,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="V",
                conid=10314,
                multiplier=1,
                dateTime=datetime(2024, 12, 1, 9, 30, 0),
                tradeDate=date(2024, 12, 1),
                quantity=100,
                tradePrice=250.50,
                tradeMoney=25050.0,
                proceeds=-25050.0,
                taxes=0.0,
                openCloseIndicator="O",
                transactionID=12001,
                fifoPnlRealized=0.0,
            ),
            Trade(
                tradeID=111,
                accountId="U12345",
                currency="USD",
                fxRateToBase=1.0,
                assetCategory="STK",
                symbol="V",
                conid=10314,
                multiplier=1,
                dateTime=datetime(2024, 12, 10, 15, 0, 0),
                tradeDate=date(2024, 12, 10),
                quantity=-100,
                tradePrice=263.75,
                tradeMoney=-26375.0,
                proceeds=26375.0,
                taxes=0.0,
                openCloseIndicator="C",
                transactionID=12002,
                fifoPnlRealized=1325.0,  # (263.75 - 250.50) * 100
            ),
        ]
        
        matched = match_trades(trades)
        
        assert len(matched) == 1
        # Verify reported P&L from IB
        assert matched[0].pnl == 1325.0
        # Verify we can calculate it ourselves
        calculated_pnl = (matched[0].close_price - matched[0].open_price) * 100
        assert calculated_pnl == 1325.0
