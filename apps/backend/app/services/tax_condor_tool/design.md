# Design & Architecture

This document explains the **math, logic, and flow** behind the LEAP + Iron Condor hedging system.

---

## 1. Mathematical Model

### Greek Vector Representation

Each position is represented by a Greek vector:

G = [Delta, Gamma, Theta, Vega]

Portfolio Greeks are additive:

G_portfolio = G_LEAP + N_IC × G_IC

---

### Scenario-Based PnL Approximation

For quick filtering, PnL is approximated as:

PnL ≈ Δ·ΔS + ½·Γ·(ΔS)² + Θ·t + Vega·Δσ

This is used for:
- Candidate filtering
- Directional sanity checks

---

### Full Repricing (Validation)

For final validation, we **reprice each option leg**:

PnL = Price(S₁, T₁, σ₁) − Price(S₀, T₀, σ₀)

This captures:
- Gamma explosion
- Volatility shocks
- Broken-wing asymmetry
- Near-expiry effects

---

## 2. Structural Modeling

### Option

An individual option leg:

- Strike
- Call / Put
- Quantity (+1 long, −1 short)

---

### Iron Condor

An IC consists of 4 legs:

- Short Call
- Long Call
- Short Put
- Long Put

Supports:
- Symmetric or broken wings
- Structural margin calculation
- Repricing-based PnL

Margin approximation:

Margin ≈ max(call spread width, put spread width) × 100 × N

---

## 3. Loss-Harvesting Budget

We start from an **annual loss budget**:

B_year

Monthly per-IC budget:

B_month_ic = B_year / (rolls_per_year × ICs_per_LEAP)

This becomes a **hard constraint**.

---

## 4. Core Constraints

### Theta Coverage

N_IC × Theta_IC ≥ |Theta_LEAP|

---

### Bullish Scenario (Gain Transfer)

Let:
- G_LEAP⁺ = LEAP gain in bull scenario
- L_IC⁺ = IC loss in bull scenario

Constraint:

L_IC⁺ ≈ α × G_LEAP⁺  
(α typically 0.25–0.33)

---

### Monthly Loss Cap

L_IC⁺ ≤ B_month_ic

---

### Downside Protection

In bearish scenarios:

LEAP_PnL + IC_PnL ≥ β × LEAP_PnL  
(β typically 0.4–0.7)

---

### Crash / Volatility Shock

Tail scenarios enforce:

IC_PnL_crash ≥ −MaxAllowedLoss

---

## 5. Scenario Design

Scenarios are asymmetric by design:

| Scenario | Price | Vol |
|-------|------|-----|
| Bull | +3% | +1 vol |
| Flat | 0% | 0 |
| Bear | −3% | +4 vol |
| Crash | −6% | +8 vol |

This reflects empirical equity behavior.

---

## 6. Auto-Generation of IC Candidates

ICs are generated structurally, not optimized blindly:

- ATM-centered
- Short strikes offset by fixed distances
- Narrow call wing
- Wider put wing (broken wing)
- Strike steps aligned to market conventions

Each candidate produces:
- Greeks
- Wing widths
- Structural margin

Poor shapes are filtered early.

---

## 7. Monthly Automation Loop

Every month:

1. Pull spot price and implied volatility
2. Recompute LEAP Greeks
3. Generate IC candidates
4. Filter by Greek constraints
5. Apply loss-budget rules
6. Validate via full repricing
7. Check margin usage
8. Rank survivors
9. Close old ICs
10. Open new ICs

The LEAP remains open.

---

## 8. Integration Points (Future Work)

### Broker Integration (Missing)

We will need:
- Real-time option prices
- Greeks from broker or model
- Margin / buying power from account
- Order placement & fills
- Position state tracking

The pricing engine is intentionally pluggable.

---

## 9. Design Philosophy

Key principles:

- Greeks for **structure**
- Repricing for **truth**
- Constraints encode **business intent**
- Monthly rolls reset risk
- Losses are **intentional and budgeted**

This is a **risk control system**, not a signal generator.

---

## 10. What This Is Not

- Not delta-neutral trading
- Not gamma scalping
- Not a prediction engine
- Not fully automated yet

It is a **controlled convex exposure allocator**.

---