from typing import List
import logging
from .interfaces import MarketDataProvider
from .data.mock_provider import MockDataProvider
from .logic.leap_selector import LeapSelector
from .logic.ic_generator import ICCandidateGenerator
from .logic.validator import Validator
from .models import TaxCondorRecommendation, LeapRecommendation

logger = logging.getLogger(__name__)

class TaxCondorService:
    def __init__(self, provider: MarketDataProvider = None):
        self.provider = provider or MockDataProvider()
        self.leap_selector = LeapSelector(self.provider)
        self.ic_generator = ICCandidateGenerator(self.provider)
        self.validator = Validator()

    async def get_recommendation(self, symbol: str, budget: float = 1000.0) -> List[TaxCondorRecommendation]:
        logger.info(f"Starting recommendation process for {symbol} with budget {budget}")
        
        # 1. Get Data (Implicit in provider calls)
        spot = await self.provider.get_spot_price(symbol)
        vol = await self.provider.get_volatility(symbol)
        
        # 2. Select LEAP
        logger.info("Selecting best LEAP...")
        leap_leg = await self.leap_selector.select_best_leap(symbol)
        if not leap_leg:
            logger.warning("No LEAP leg found.")
            return []
        logger.info(f"Selected LEAP: {leap_leg}")
            
        leap_rec = LeapRecommendation(leg=leap_leg, reason="Best fit for delta 0.70")
        
        # 3. Generate ICs
        logger.info("Generating Iron Condor candidates...")
        ics = await self.ic_generator.generate(symbol)
        logger.info(f"Generated {len(ics)} IC candidates.")
        
        # 4. Validate & Rank
        logger.info("Validating and ranking...")
        recommendations = self.validator.rank_and_validate(leap_rec, ics, budget, spot_price=spot)
        logger.info(f"Final recommendations count: {len(recommendations)}")
        
        # Enrich with underlying data
        for rec in recommendations:
            rec.underlying_price = spot
            rec.underlying_iv = vol

        return recommendations[:10]
