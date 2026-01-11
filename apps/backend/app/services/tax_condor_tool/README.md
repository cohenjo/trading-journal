# Tax Condor Tool

A service for recommending "Tax Condor" trades: a long-term LEAP option coupled with a short-term Iron Condor for tax harvesting and theta decay financing.

## Structure

*   **`core/`**: Fundamental financial math and structures.
    *   `pricer.py`: Black-Scholes pricing engine.
    *   `structures.py`: Data structures for Options and Iron Condors.
*   **`data/`**: Data providers.
    *   `mock_provider.py`: Synthetic data for testing.
    *   `interfaces.py`: Abstract base class for data providers.
*   **`logic/`**: Business logic.
    *   `leap_selector.py`: Selects the best LEAP based on delta/expiration.
    *   `ic_generator.py`: Generates valid Iron Condor candidates.
    *   `validator.py`: Ranks and validates candidates against constraints.
*   **`service.py`**: Main entry point (`TaxCondorService`).
*   **`models.py`**: Pydantic models for data exchange.

## Usage

```python
from app.services.tax_condor_tool.service import TaxCondorService

service = TaxCondorService() # Uses MockDataProvider by default
recs = service.get_recommendation("NDX", budget=5000)
```

## Next Steps

1.  Implement `IBKRDataProvider` in `data/` to fetch live market data.
2.  Expose via FastAPI endpoint.
3.  Build Frontend UI.

---

# Original README (Legacy)

# LEAP + Iron Condor Loss-Harvesting Hedge

This project implements a **systematic, tax-aware hedging framework** that combines:

- A **long-dated LEAP option** (directional, convex exposure)
- A **rolling short-term Iron Condor (often broken-wing)** used to:
  - Finance LEAP theta decay
  - Intentionally harvest losses
  - Transfer a controlled portion of upside gains into realized losses
  - Cushion downside moves via asymmetric structure

The system is designed for **monthly automation**, **Greek-based reasoning**, and **future broker integration**.

---

## High-Level Idea

We are *not* trying to delta-hedge the LEAP.

Instead, we:
- Allocate a **loss-harvesting budget**
- Roll Iron Condors monthly
- Ensure IC losses:
  - Are intentional
  - Are bounded
  - Offset a defined fraction of LEAP gains
  - Reduce LEAP losses in down markets

This is a **controlled PnL transfer system**, not a classical hedge.

---

## Core Concepts

- **LEAP**  
  Long-dated option providing convex upside and long-term exposure.

- **Iron Condor (IC)**  
  Short-dated options structure providing:
  - Positive theta
  - Negative gamma
  - Asymmetric payoff via broken wings

- **Monthly Roll**  
  ICs are closed and reopened every ~30–45 days to:
  - Reset risk
  - Realize gains/losses
  - Rebalance Greeks

---

## Key Constraints (Business Rules)

- IC theta must cover LEAP theta
- IC losses in bullish scenarios should be ~25–33% of LEAP gains
- Monthly IC losses must stay within a predefined budget
- IC structure must cushion a portion of LEAP losses on downside
- Margin / buying power usage must be acceptable

---

## Code Structure Overview

### Core Components

| Component | Purpose |
|--------|--------|
| `LeapICHedge` | Portfolio-level logic, constraints, scenario evaluation |
| `IronCondor` | Structural IC representation (legs, margin, repricing) |
| `Option` | Individual option leg |
| `BlackScholesPricer` | Simple pricing engine (pluggable) |
| `ICCandidateGenerator` | Auto-generation of IC candidates |
| Scenario builders | Market stress definitions |

---

## Status

✔ Greek-based modeling  
✔ Loss-budget constraints  
✔ Scenario-based validation  
✔ Broken-wing IC generation  
✔ Margin estimation  
✔ Black–Scholes repricing  
⬜ Broker price integration  
⬜ Order execution  
⬜ Persistent trade tracking  

---

## Disclaimer

This is an experimental research system.
It is **not investment advice** and is intended for personal use and learning.