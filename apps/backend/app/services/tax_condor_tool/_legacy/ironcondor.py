class IronCondor:
    def __init__(
        self,
        short_call, long_call,
        short_put, long_put,
        greeks,
        credit
    ):
        self.short_call = short_call
        self.long_call = long_call
        self.short_put = short_put
        self.long_put = long_put

        self.g = np.array(greeks)
        self.credit = credit

    def margin(self, N):
        call_width = abs(self.long_call.strike - self.short_call.strike)
        put_width = abs(self.short_put.strike - self.long_put.strike)
        return 100 * max(call_width, put_width) * N

    def pnl_reprice(self, pricer, S0, T0, vol0, S1, T1, vol1):
        legs = [
            self.short_call,
            self.long_call,
            self.short_put,
            self.long_put,
        ]

        pnl = 0.0
        for opt in legs:
            p0 = pricer.price(opt, S0, T0, vol0)
            p1 = pricer.price(opt, S1, T1, vol1)
            pnl += opt.qty * (p1 - p0)

        return 100 * pnl