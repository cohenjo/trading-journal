B_month_ic = B_year / (rolls_per_year * ICs_per_leap)


def build_ic(candidate):
    sc, lc, sp, lp = candidate["structure"]

    return IronCondor(
        short_call=Option(sc, True, -1),
        long_call=Option(lc, True, +1),
        short_put=Option(sp, False, -1),
        long_put=Option(lp, False, +1),
        greeks=candidate["greeks"],
        credit=None  # filled later by pricing
    )