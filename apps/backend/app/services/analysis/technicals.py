"""
Technical Indicators — EMA, Bollinger Bands, RSI, MACD, Support/Resistance.

Operates on plain lists of floats (closing prices) — no pandas dependency required.
numpy is used only for standard-deviation in Bollinger Bands.
"""

from __future__ import annotations

from typing import List, Optional, Tuple
from pydantic import BaseModel
import numpy as np


# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------

class BollingerBands(BaseModel):
    upper: List[float]
    middle: List[float]
    lower: List[float]


class MACDResult(BaseModel):
    macd_line: List[float]
    signal_line: List[float]
    histogram: List[float]


class SupportResistanceLevel(BaseModel):
    price: float
    kind: str  # "support" or "resistance"
    strength: int  # number of touches


class TechnicalIndicatorsResult(BaseModel):
    ema_50: List[float]
    ema_200: List[float]
    bollinger: BollingerBands
    rsi: List[float]
    macd: MACDResult
    support_resistance: List[SupportResistanceLevel]


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------

def calculate_ema(prices: List[float], period: int) -> List[float]:
    """
    Exponential Moving Average.

    Returns a list the same length as *prices*; the first (period-1) entries
    are float('nan') because there is insufficient data.
    """
    if period < 1:
        raise ValueError("Period must be ≥ 1")
    if len(prices) < period:
        return [float("nan")] * len(prices)

    k = 2.0 / (period + 1)
    ema: List[float] = [float("nan")] * (period - 1)

    # Seed with SMA
    sma = sum(prices[:period]) / period
    ema.append(round(sma, 4))

    for price in prices[period:]:
        prev = ema[-1]
        ema.append(round(price * k + prev * (1.0 - k), 4))

    return ema


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------

def calculate_bollinger_bands(
    prices: List[float],
    period: int = 20,
    num_std: float = 2.0,
) -> BollingerBands:
    """
    Bollinger Bands: SMA ± num_std × σ over a rolling window.

    First (period-1) values are NaN.
    """
    n = len(prices)
    upper: List[float] = [float("nan")] * (period - 1)
    middle: List[float] = [float("nan")] * (period - 1)
    lower: List[float] = [float("nan")] * (period - 1)

    for i in range(period - 1, n):
        window = prices[i - period + 1: i + 1]
        sma = float(np.mean(window))
        std = float(np.std(window, ddof=0))
        middle.append(round(sma, 4))
        upper.append(round(sma + num_std * std, 4))
        lower.append(round(sma - num_std * std, 4))

    return BollingerBands(upper=upper, middle=middle, lower=lower)


# ---------------------------------------------------------------------------
# RSI (Wilder's smoothing)
# ---------------------------------------------------------------------------

def calculate_rsi(prices: List[float], period: int = 14) -> List[float]:
    """
    Relative Strength Index using Wilder's smoothing method.

    First *period* values are NaN.
    """
    if len(prices) < period + 1:
        return [float("nan")] * len(prices)

    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]

    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    rsi_values: List[float] = [float("nan")] * period

    if avg_loss == 0:
        rsi_values.append(100.0)
    else:
        rs = avg_gain / avg_loss
        rsi_values.append(round(100.0 - 100.0 / (1.0 + rs), 2))

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            rsi_values.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsi_values.append(round(100.0 - 100.0 / (1.0 + rs), 2))

    return rsi_values


# ---------------------------------------------------------------------------
# MACD
# ---------------------------------------------------------------------------

def calculate_macd(
    prices: List[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> MACDResult:
    """
    MACD = EMA(fast) - EMA(slow), Signal = EMA(MACD, signal period).
    Histogram = MACD - Signal.
    """
    ema_fast = calculate_ema(prices, fast)
    ema_slow = calculate_ema(prices, slow)

    macd_line: List[float] = []
    for f, s in zip(ema_fast, ema_slow):
        if _isnan(f) or _isnan(s):
            macd_line.append(float("nan"))
        else:
            macd_line.append(round(f - s, 4))

    # Signal line: EMA of the non-NaN portion of MACD
    valid_macd = [v for v in macd_line if not _isnan(v)]
    signal_ema = calculate_ema(valid_macd, signal) if len(valid_macd) >= signal else []

    # Re-align signal to full length
    nan_prefix = len(macd_line) - len(valid_macd)
    full_signal = [float("nan")] * nan_prefix + signal_ema

    histogram: List[float] = []
    for m, s_val in zip(macd_line, full_signal):
        if _isnan(m) or _isnan(s_val):
            histogram.append(float("nan"))
        else:
            histogram.append(round(m - s_val, 4))

    return MACDResult(
        macd_line=macd_line,
        signal_line=full_signal,
        histogram=histogram,
    )


# ---------------------------------------------------------------------------
# Support / Resistance detection (pivot-point method)
# ---------------------------------------------------------------------------

def detect_support_resistance(
    prices: List[float],
    window: int = 5,
    tolerance_pct: float = 0.5,
) -> List[SupportResistanceLevel]:
    """
    Detect local minima (support) and maxima (resistance) using a rolling
    window, then cluster nearby levels within *tolerance_pct* %.

    Returns levels sorted by strength (most touches first).
    """
    if len(prices) < 2 * window + 1:
        return []

    pivots: List[Tuple[float, str]] = []

    for i in range(window, len(prices) - window):
        left = prices[i - window: i]
        right = prices[i + 1: i + window + 1]
        p = prices[i]

        if all(p <= x for x in left) and all(p <= x for x in right):
            pivots.append((p, "support"))
        elif all(p >= x for x in left) and all(p >= x for x in right):
            pivots.append((p, "resistance"))

    if not pivots:
        return []

    # Cluster nearby pivots
    tol = tolerance_pct / 100.0
    clusters: List[dict] = []

    for price, kind in sorted(pivots, key=lambda x: x[0]):
        merged = False
        for c in clusters:
            if c["kind"] == kind and abs(price - c["price"]) / c["price"] <= tol:
                c["price"] = (c["price"] * c["strength"] + price) / (c["strength"] + 1)
                c["strength"] += 1
                merged = True
                break
        if not merged:
            clusters.append({"price": round(price, 2), "kind": kind, "strength": 1})

    clusters.sort(key=lambda c: c["strength"], reverse=True)
    return [
        SupportResistanceLevel(price=c["price"], kind=c["kind"], strength=c["strength"])
        for c in clusters
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _isnan(v: float) -> bool:
    return v != v  # NaN != NaN
