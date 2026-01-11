# Inputs
S = 450
t_days = 30
g_leap = np.array([0.70, 0.0, -0.01, 0.12])

hedge = LeapICHedge(g_leap, S)

scenarios = make_scenarios(S, t_days)

# Strategy parameters
alpha = 0.25
beta = 0.6
B_year = 12000
rolls_per_year = 12
ICs_per_leap = 4
N_ic = ICs_per_leap

B_month_ic = B_year / (rolls_per_year * ICs_per_leap)

# Example IC candidates (from option chain)
ic_candidates = [
    np.array([-0.15, -0.02, 0.10, -0.08]),
    np.array([-0.10, -0.01, 0.07, -0.05]),
    np.array([-0.20, -0.03, 0.12, -0.10]),
]

valid_ics = hedge.evaluate_candidates(
    ic_candidates,
    scenarios,
    alpha,
    beta,
    B_month_ic,
    N_ic
)

print("Valid ICs:", valid_ics)

def check_margin(ic, N_ic, max_bp):
    return ic.margin(N_ic) <= max_bp