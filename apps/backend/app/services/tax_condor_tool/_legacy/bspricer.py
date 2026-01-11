import numpy as np
from math import log, sqrt, exp
from scipy.stats import norm

class BlackScholesPricer:
    def price(self, option, S, T, vol):
        K = option.strike
        if T <= 0:
            return max(0.0, S - K) if option.is_call else max(0.0, K - S)

        d1 = (log(S / K) + 0.5 * vol**2 * T) / (vol * sqrt(T))
        d2 = d1 - vol * sqrt(T)

        if option.is_call:
            return S * norm.cdf(d1) - K * norm.cdf(d2)
        else:
            return K * norm.cdf(-d2) - S * norm.cdf(-d1)
        


from scipy.stats import norm
import numpy as np
from math import log, sqrt

def bs_greeks(S, K, T, vol, is_call):
    d1 = (log(S / K) + 0.5 * vol**2 * T) / (vol * sqrt(T))
    d2 = d1 - vol * sqrt(T)

    delta = norm.cdf(d1) if is_call else norm.cdf(d1) - 1
    theta = (
        -S * norm.pdf(d1) * vol / (2 * sqrt(T))
    ) / 365

    return delta, theta