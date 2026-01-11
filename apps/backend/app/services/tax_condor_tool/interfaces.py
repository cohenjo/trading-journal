from abc import ABC, abstractmethod
from typing import List
from datetime import date
from .models import OptionLeg

class MarketDataProvider(ABC):
    @abstractmethod
    async def get_spot_price(self, symbol: str) -> float:
        pass

    @abstractmethod
    async def get_volatility(self, symbol: str, days: int = 30) -> float:
        pass

    @abstractmethod
    async def get_option_chain(self, symbol: str, expiration: date) -> List[OptionLeg]:
        """Returns a list of available options for a specific expiration."""
        pass

    @abstractmethod
    async def get_expirations(self, symbol: str) -> List[date]:
        """Returns available expiration dates."""
        pass
