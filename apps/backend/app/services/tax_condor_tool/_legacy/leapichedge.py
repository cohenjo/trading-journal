import numpy as np
from numpy.linalg import lstsq

class LeapICHedge:
    """
    LEAP + Iron Condor hedging with loss-harvest constraints
    Greeks order: [delta, gamma, theta, vega]
    """

    def __init__(self, g_leap, S):
        self.g_leap = np.array(g_leap, dtype=float)
        self.S = S

    # ---------- core math ----------

    def portfolio_greeks(self, g_ic, N_ic):
        return self.g_leap + N_ic * g_ic

    def pnl(self, G, state):
        return float(G @ state)

    # ---------- constraints ----------

    def check_constraints(
        self,
        g_ic,
        N_ic,
        scenarios,
        alpha,
        beta,
        B_month_ic
    ):
        """
        scenarios: dict with keys ['bull', 'flat', 'bear']
        """

        # LEAP-only PnL
        leap_pnl = {
            k: self.pnl(self.g_leap, s)
            for k, s in scenarios.items()
        }

        # IC-only PnL
        ic_pnl = {
            k: N_ic * self.pnl(g_ic, s)
            for k, s in scenarios.items()
        }

        # 1️⃣ Theta coverage
        if N_ic * g_ic[2] < abs(self.g_leap[2]):
            return False, "Theta not covered"

        # 2️⃣ Bullish proportional loss
        leap_gain = leap_pnl["bull"]
        ic_loss = -ic_pnl["bull"]

        if ic_loss <= 0:
            return False, "IC does not lose in bull case"

        if abs(ic_loss - alpha * leap_gain) > 0.1 * leap_gain:
            return False, "Bullish loss ratio violated"

        # 3️⃣ Monthly loss budget
        if ic_loss > B_month_ic:
            return False, "Monthly loss budget exceeded"

        # 4️⃣ Downside protection
        total_bear = leap_pnl["bear"] + ic_pnl["bear"]
        if total_bear < beta * leap_pnl["bear"]:
            return False, "Downside protection insufficient"

        return True, "OK"

    # ---------- evaluation ----------

    def evaluate_candidates(
        self,
        ic_candidates,
        scenarios,
        alpha,
        beta,
        B_month_ic,
        N_ic
    ):
        """
        ic_candidates: list of Greek vectors
        """
        valid = []

        for g_ic in ic_candidates:
            ok, reason = self.check_constraints(
                np.array(g_ic),
                N_ic,
                scenarios,
                alpha,
                beta,
                B_month_ic
            )

            if ok:
                valid.append(g_ic)

        return valid
    

def validate_ic_repricing(
    ic,
    pricer,
    scenarios,
    alpha,
    beta,
    leap_pnl_scenarios,
    N_ic,
    loss_budget,
    max_crash_loss
):
    ic_pnl = {}

    for k, (S1, T1, vol1) in scenarios.items():
        ic_pnl[k] = N_ic * ic.pnl_reprice(
            pricer,
            S0=S,
            T0=T,
            vol0=vol,
            S1=S1,
            T1=T1,
            vol1=vol1
        )

    # Bullish proportional loss
    if abs(-ic_pnl["bull"] - alpha * leap_pnl_scenarios["bull"]) > 0.1 * leap_pnl_scenarios["bull"]:
        return False

    # Monthly loss budget
    if -ic_pnl["bull"] > loss_budget:
        return False

    # Downside protection
    if leap_pnl_scenarios["bear"] + ic_pnl["bear"] < beta * leap_pnl_scenarios["bear"]:
        return False

    # Crash control
    if ic_pnl["crash"] < -max_crash_loss:
        return False

    return True