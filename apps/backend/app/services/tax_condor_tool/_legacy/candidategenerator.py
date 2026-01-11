class ICCandidateGenerator:
    def __init__(self, S, T, vol, strike_step=5):
        self.S = S
        self.T = T
        self.vol = vol
        self.strike_step = strike_step

    def generate(self):
        candidates = []

        atm = round(self.S / self.strike_step) * self.strike_step

        for short_call_offset in [10, 15, 20]:
            for short_put_offset in [10, 15, 20]:
                for call_width in [5, 10]:
                    for put_width in [15, 25, 35]:

                        short_call = atm + short_call_offset
                        long_call  = short_call + call_width

                        short_put  = atm - short_put_offset
                        long_put   = short_put - put_width

                        # --- compute Greeks ---
                        g = self._compute_ic_greeks(
                            short_call, long_call,
                            short_put, long_put
                        )

                        candidates.append({
                            "structure": (short_call, long_call, short_put, long_put),
                            "greeks": g,
                            "call_width": call_width,
                            "put_width": put_width,
                        })

        return candidates
    def _compute_ic_greeks(self, sc, lc, sp, lp):
        legs = [
            (sc, True,  -1),
            (lc, True,  +1),
            (sp, False, -1),
            (lp, False, +1),
        ]

        delta = 0.0
        theta = 0.0

        for K, is_call, qty in legs:
            d, t = bs_greeks(self.S, K, self.T, self.vol, is_call)
            delta += qty * d
            theta += qty * t

        return np.array([delta, 0.0, theta, 0.0])