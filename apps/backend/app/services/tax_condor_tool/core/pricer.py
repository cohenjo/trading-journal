import math
from scipy.stats import norm
from datetime import date

class BlackScholesPricer:
    @staticmethod
    def price(S: float, K: float, T: float, r: float, sigma: float, is_call: bool) -> float:
        if T <= 0:
            return max(0.0, S - K) if is_call else max(0.0, K - S)

        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        if is_call:
            return float(S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2))
        else:
            return float(K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1))

    @staticmethod
    def greeks(S: float, K: float, T: float, r: float, sigma: float, is_call: bool):
        if T <= 0:
            return 0.0, 0.0, 0.0, 0.0

        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        delta = float(norm.cdf(d1) if is_call else norm.cdf(d1) - 1)
        gamma = float(norm.pdf(d1) / (S * sigma * math.sqrt(T)))
        theta = float(-(S * norm.pdf(d1) * sigma) / (2 * math.sqrt(T)) - r * K * math.exp(-r * T) * norm.cdf(d2 if is_call else -d2))
        vega = float(S * norm.pdf(d1) * math.sqrt(T))

        # Normalize Theta/Vega to standard conventions (per day, per 1% vol change)
        theta = theta / 365.0
        vega = vega / 100.0

        return delta, gamma, theta, vega
