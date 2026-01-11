from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
from app.services.tax_condor_tool.service import TaxCondorService
from app.services.tax_condor_tool.models import TaxCondorRecommendation
from app.services.tax_condor_tool.data.ibkr_provider import IBKRDataProvider
from app.services.ib_connection import ib_manager

router = APIRouter()

class RecommendationRequest(BaseModel):
    symbol: str
    budget: float = 1000.0
    use_live_data: bool = False

@router.post("/recommend", response_model=List[TaxCondorRecommendation])
async def get_recommendations(request: RecommendationRequest):
    provider = None
    if request.use_live_data:
        try:
            ib = await ib_manager.get_ib()
            provider = IBKRDataProvider(ib)
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Could not connect to IBKR: {str(e)}")

    service = TaxCondorService(provider) # Uses MockDataProvider by default if provider is None
    
    try:
        recommendations = await service.get_recommendation(request.symbol, request.budget)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating recommendations: {str(e)}")
    
    if not recommendations:
        # We return an empty list instead of 404 to indicate "no valid trades found"
        return []
        
    return recommendations
