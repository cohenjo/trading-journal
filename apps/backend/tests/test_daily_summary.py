"""
Tests for daily summary calculation logic.

Covers: total_pnl, winning/losing trade counts, win_rate, avg_win, avg_loss.
Uses mock MatchedTrade objects to avoid DB dependency.
"""

import pytest
from unittest.mock import MagicMock
from app.utils.daily_summary import calculate_daily_summary


def _make_trade(pnl: float) -> MagicMock:
    """Create a mock MatchedTrade with the given pnl."""
    trade = MagicMock()
    trade.pnl = pnl
    return trade


# ===================================================================
# Empty / Edge Cases
# ===================================================================

class TestDailySummaryEmpty:
    def test_empty_trades_returns_zeros(self):
        result = calculate_daily_summary([])
        assert result == {
            "total_pnl": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0,
            "avg_win": 0,
            "avg_loss": 0,
        }


# ===================================================================
# Single Trade Cases
# ===================================================================

class TestDailySummarySingleTrade:
    def test_single_winning_trade(self):
        trades = [_make_trade(150.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == 150.0
        assert result["winning_trades"] == 1
        assert result["losing_trades"] == 0
        assert result["win_rate"] == 1.0
        assert result["avg_win"] == 150.0
        assert result["avg_loss"] == 0

    def test_single_losing_trade(self):
        trades = [_make_trade(-80.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == -80.0
        assert result["winning_trades"] == 0
        assert result["losing_trades"] == 1
        assert result["win_rate"] == 0.0
        assert result["avg_win"] == 0
        assert result["avg_loss"] == -80.0

    def test_breakeven_trade_counts_as_loss(self):
        """A trade with pnl == 0 is classified as losing (pnl <= 0)."""
        trades = [_make_trade(0.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == 0.0
        assert result["winning_trades"] == 0
        assert result["losing_trades"] == 1
        assert result["win_rate"] == 0.0


# ===================================================================
# Multiple Trades
# ===================================================================

class TestDailySummaryMultipleTrades:
    def test_mixed_wins_and_losses(self):
        trades = [
            _make_trade(200.0),
            _make_trade(-100.0),
            _make_trade(50.0),
            _make_trade(-30.0),
        ]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == pytest.approx(120.0)
        assert result["winning_trades"] == 2
        assert result["losing_trades"] == 2
        assert result["win_rate"] == pytest.approx(0.5)
        assert result["avg_win"] == pytest.approx(125.0)  # (200+50)/2
        assert result["avg_loss"] == pytest.approx(-65.0)  # (-100+-30)/2

    def test_all_winners(self):
        trades = [_make_trade(100.0), _make_trade(200.0), _make_trade(300.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == pytest.approx(600.0)
        assert result["winning_trades"] == 3
        assert result["losing_trades"] == 0
        assert result["win_rate"] == pytest.approx(1.0)
        assert result["avg_win"] == pytest.approx(200.0)
        assert result["avg_loss"] == 0

    def test_all_losers(self):
        trades = [_make_trade(-50.0), _make_trade(-150.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == pytest.approx(-200.0)
        assert result["winning_trades"] == 0
        assert result["losing_trades"] == 2
        assert result["win_rate"] == pytest.approx(0.0)
        assert result["avg_win"] == 0
        assert result["avg_loss"] == pytest.approx(-100.0)


# ===================================================================
# Precision / Floating Point
# ===================================================================

class TestDailySummaryPrecision:
    def test_small_pnl_values(self):
        """Verify no floating-point accumulation errors on small values."""
        trades = [_make_trade(0.01), _make_trade(0.02), _make_trade(-0.01)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == pytest.approx(0.02)
        assert result["winning_trades"] == 2
        assert result["losing_trades"] == 1

    def test_large_pnl_values(self):
        trades = [_make_trade(1_000_000.0), _make_trade(-500_000.0)]
        result = calculate_daily_summary(trades)

        assert result["total_pnl"] == pytest.approx(500_000.0)
        assert result["avg_win"] == pytest.approx(1_000_000.0)
        assert result["avg_loss"] == pytest.approx(-500_000.0)


# ===================================================================
# Parametrized Win Rate Verification
# ===================================================================

@pytest.mark.parametrize(
    "pnls, expected_win_rate",
    [
        ([100.0], 1.0),
        ([-100.0], 0.0),
        ([100.0, -100.0], 0.5),
        ([100.0, 200.0, -50.0], 2 / 3),
        ([10.0, 20.0, 30.0, -10.0, -20.0], 0.6),
    ],
    ids=["one-win", "one-loss", "50-50", "2-of-3", "3-of-5"],
)
def test_win_rate_parametrized(pnls, expected_win_rate):
    trades = [_make_trade(p) for p in pnls]
    result = calculate_daily_summary(trades)
    assert result["win_rate"] == pytest.approx(expected_win_rate)
