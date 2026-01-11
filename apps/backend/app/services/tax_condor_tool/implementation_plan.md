# Tax Condor Tool Implementation Plan

## Goal
Create a service that recommends a "Tax Condor" trade structure: a long-term LEAP option coupled with a short-term Iron Condor (IC) for tax harvesting and theta decay financing.

## Phase 1: Core Refactoring & Structure
Organize the existing snippets into a cohesive Python package structure within `apps/backend/app/services/tax_condor_tool`.

### Directory Structure
```
apps/backend/app/services/tax_condor_tool/
├── __init__.py
├── models.py             # Pydantic models for API/Service communication
├── interfaces.py         # Abstract base classes (MarketDataProvider)
├── core/
│   ├── __init__.py
│   ├── pricer.py         # BlackScholesPricer (refactored from bspricer.py)
│   ├── structures.py     # Option, IronCondor classes
│   └── greeks.py         # Greek calculation utilities
├── logic/
│   ├── __init__.py
│   ├── leap_selector.py  # Logic to pick the best LEAP
│   ├── ic_generator.py   # ICCandidateGenerator (refactored)
│   └── validator.py      # LeapICHedge constraints & scoring
└── data/
    ├── __init__.py
    └── mock_provider.py  # Mock implementation of MarketDataProvider
```

## Phase 2: Data Abstraction
Define how the tool gets market data.

### `MarketDataProvider` Interface
*   `get_spot_price(symbol: str) -> float`
*   `get_volatility(symbol: str, days: int) -> float`
*   `get_option_chain(symbol: str, expiration: date) -> List[OptionData]`

### `MockDataProvider`
*   Returns static data for testing (e.g., Spot=450, Vol=0.20).
*   Generates a synthetic option chain for testing selection logic.

## Phase 3: Logic Implementation

### 1. LEAP Selection (`leap_selector.py`)
*   **Input**: Symbol, Target Delta (e.g., 0.70), Min Days to Expiration (e.g., 365).
*   **Logic**: Find the call option closest to the target delta with the appropriate expiration.
*   **Output**: Selected LEAP `Option` object with Greeks.

### 2. IC Generation (`ic_generator.py`)
*   **Input**: Spot Price, Volatility, Expiration (30-45 days).
*   **Logic**: Generate valid IC structures (strikes, widths) based on "Broken Wing" rules.
*   **Output**: List of `IronCondor` candidates.

### 3. Validation & Ranking (`validator.py`)
*   **Input**: Selected LEAP, IC Candidates, Loss Budget.
*   **Logic**:
    *   Check Theta Coverage: `IC_Theta * N >= LEAP_Theta`.
    *   Check Bullish Loss Ratio: `IC_Loss ~= 0.25 * LEAP_Gain`.
    *   Check Downside Protection.
*   **Output**: Ranked list of valid `TaxCondorTrade` objects.

## Phase 4: Service Orchestration
Create `TaxCondorService` class to tie it all together.

```python
class TaxCondorService:
    def get_recommendation(self, symbol: str, budget: float):
        # 1. Get Data
        spot = self.provider.get_spot_price(symbol)
        
        # 2. Select LEAP
        leap = self.leap_selector.select_best_leap(symbol, spot)
        
        # 3. Generate ICs
        ics = self.ic_generator.generate(spot)
        
        # 4. Validate & Rank
        recommendations = self.validator.rank(leap, ics, budget)
        
        return recommendations
```

## Phase 5: API Endpoint
Expose the service via FastAPI.

*   `POST /api/tools/tax-condor/recommend`
*   **Request**: `{ "symbol": "NDX", "capital": 50000 }`
*   **Response**: JSON object with LEAP details and top 3 recommended ICs.

## Phase 6: Frontend Display
*   Simple React component to display the recommendation.
*   Show "Why this trade?" (Greeks, PnL scenarios).
