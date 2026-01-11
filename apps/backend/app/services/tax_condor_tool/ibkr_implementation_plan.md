# IBKR Data Provider Implementation Plan

## 1. Architecture Refactoring (Sync -> Async)

The current `MarketDataProvider` interface and its consumers (`LeapSelector`, `ICCandidateGenerator`, `TaxCondorService`) are synchronous. `ib_async` requires an asynchronous environment. We must refactor the core logic to be `async`.

### Steps:
1.  **Update Interface**: Modify `apps/backend/app/services/tax_condor_tool/interfaces.py`.
    ```python
    class MarketDataProvider(ABC):
        @abstractmethod
        async def get_spot_price(self, symbol: str) -> float: pass
        # ... all methods async
    ```
2.  **Update Mock**: Update `MockDataProvider` to use `async def`.
3.  **Update Logic**: Update `LeapSelector` and `ICCandidateGenerator` to `await` provider calls.
4.  **Update Service**: Update `TaxCondorService.get_recommendation` to be `async`.
5.  **Update API**: Update `apps/backend/app/api/tax_condor.py` to `await service.get_recommendation(...)`.

## 2. IBKR Provider Implementation

Create `apps/backend/app/services/tax_condor_tool/data/ibkr_provider.py`.

### Class Structure
```python
class IBKRDataProvider(MarketDataProvider):
    def __init__(self, ib: IB):
        self.ib = ib

    async def get_spot_price(self, symbol: str) -> float:
        # 1. Qualify contract (Index or Stock)
        # 2. reqTickers
        # 3. Return market price
        pass

    async def get_expirations(self, symbol: str) -> List[date]:
        # 1. reqSecDefOptParams
        # 2. Parse expirations
        pass

    async def get_option_chain(self, symbol: str, expiration: date) -> List[OptionLeg]:
        # 1. reqSecDefOptParams (cached or fresh) to get strikes
        # 2. Filter strikes (e.g., +/- 20% of spot) to reduce load
        # 3. Create Contract objects for Calls and Puts
        # 4. reqTickers for all contracts (batch request)
        # 5. Map results to OptionLeg with Greeks
        pass
```

### Connection Management
- The `IB` instance should be a **singleton** managed by the FastAPI application lifespan.
- **Startup**: Connect to TWS/Gateway.
- **Shutdown**: Disconnect.
- **Health Check**: Ensure connection is active before making requests.

## 3. Configuration & Dependency Injection

- Add `DATA_PROVIDER` env var (values: `MOCK`, `IBKR`).
- In `TaxCondorService` initialization, choose the provider based on env var.
- Pass the global `IB` instance to `IBKRDataProvider` if selected.

## 4. Data Fetching Strategy

### Option Chain Optimization
Fetching a full option chain is expensive.
- **Filtering**: Only fetch strikes within a certain percentage of the spot price (e.g., 80% to 120%).
- **Concurrency**: `ib_async` handles concurrency, but we should be mindful of pacing violations.
- **Greeks**: Ensure `GenericTickList` includes 13 (modelOption) or 100, 101, 104, 106 to get Delta, Gamma, Vega, Theta.

## 5. Implementation Steps

1.  **Refactor to Async**: Modify interfaces and existing logic.
2.  **Global IB Instance**: Add `ib_client` to `main.py` lifespan.
3.  **Implement IBKRDataProvider**: Write the class in `data/ibkr_provider.py`.
4.  **Integrate**: Wire it up in `TaxCondorService`.
5.  **Test**: Verify with TWS Gateway running.
