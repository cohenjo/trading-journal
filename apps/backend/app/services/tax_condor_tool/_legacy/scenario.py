def make_price_scenarios(S, T, vol):
    dS = 0.03 * S
    dt = 30 / 365

    return {
        "bull":  (S + dS, T - dt, vol + 0.01),
        "flat":  (S,       T - dt, vol),
        "bear":  (S - dS,  T - dt, vol + 0.04),
        "crash": (S - 2*dS,T - dt, vol + 0.08),
    }