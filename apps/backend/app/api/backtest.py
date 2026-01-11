from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from app.services.backtest_service import BacktestService

router = APIRouter()
service = BacktestService()

class BacktestRequest(BaseModel):
    year: int
    initial_capital: float = 100000.0
    step_days: int = 1
    underlying: str = "NDX" # Strategy Underlying (e.g. NDX)
    leap_underlying: str = "NDX" # LEAP Underlying (e.g. QQQ)
    strategy: str = "IRON_CONDOR"

class BacktestResponse(BaseModel):
    year: int
    initial_capital: float
    final_equity: float
    realized_pnl: float
    unrealized_pnl: float
    trades: List[Any]
    metrics: Optional[Dict[str, Any]] = None

@router.post("/run", response_model=BacktestResponse)
async def run_backtest(request: BacktestRequest):
    try:
        results = await service.run_backtest(
            request.year, 
            request.initial_capital, 
            request.step_days,
            request.underlying,
            request.leap_underlying,
            request.strategy
        )
        return results
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/years")
def get_available_years():
    # Return list of years we support
    # 2018 to current year
    import datetime
    current_year = datetime.date.today().year
    return list(range(2018, current_year + 1))
