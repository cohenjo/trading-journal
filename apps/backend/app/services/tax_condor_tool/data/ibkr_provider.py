import asyncio
import math
from datetime import datetime, date
from typing import List, Optional, Set
import logging

from ib_async import IB, Index, Option, Contract, Stock
from ..interfaces import MarketDataProvider
from ..models import OptionLeg, GreekVector
from ..core.pricer import BlackScholesPricer

logger = logging.getLogger(__name__)

class IBKRDataProvider(MarketDataProvider):
    def __init__(self, ib: IB):
        self.ib = ib
        self.risk_free_rate = 0.045 # Approximate current rate

    def _get_contract(self, symbol: str) -> Contract:
        s = symbol.upper()
        if s == "NDX":
            return Index("NDX", "NASDAQ")
        elif s == "SPX":
            return Index("SPX", "CBOE")
        elif s == "VIX":
            return Index("VIX", "CBOE")
        elif s == "RUT":
            return Index("RUT", "CBOE")
        else:
            # Assume Stock/ETF
            return Stock(s, "SMART", "USD")

    async def get_spot_price(self, symbol: str) -> float:
        logger.info(f"Getting spot price for {symbol}")
        contract = self._get_contract(symbol)
        await self.ib.qualifyContractsAsync(contract)
        logger.info(f"Qualified contract: {contract}")
        
        # Request market data
        tickers = await self.ib.reqTickersAsync(contract)
        if not tickers:
            logger.warning(f"Could not fetch ticker for {symbol}")
            return 0.0
        
        ticker = tickers[0]
        logger.info(f"Got ticker: {ticker}")
        # Prefer last, then close, then market price
        price = ticker.last if ticker.last and ticker.last > 0 else ticker.close
        if not price or price <= 0 or math.isnan(price):
             price = ticker.marketPrice()
             
        result = price if price and not math.isnan(price) else 0.0
        logger.info(f"Spot price for {symbol}: {result}")
        return result

    async def get_volatility(self, symbol: str, days: int = 30) -> float:
        # Placeholder: Return a default or try to fetch VIX if applicable
        return 0.20 

    async def get_expirations(self, symbol: str) -> List[date]:
        logger.info(f"Getting expirations for {symbol}")
        contract = self._get_contract(symbol)
        await self.ib.qualifyContractsAsync(contract)
        
        # reqSecDefOptParams
        logger.info(f"Requesting opt params for {contract.symbol} conId={contract.conId}")
        chains = await self.ib.reqSecDefOptParamsAsync(
            contract.symbol, '', contract.secType, contract.conId
        )
        logger.info(f"Got {len(chains)} chains")
        
        expirations = set()
        for chain in chains:
            for exp in chain.expirations:
                try:
                    d = datetime.strptime(exp, '%Y%m%d').date()
                    expirations.add(d)
                except ValueError:
                    pass
        
        result = sorted(list(expirations))
        logger.info(f"Found {len(result)} expirations")
        return result

    async def get_option_chain(self, symbol: str, expiration: date, limit: int = 100) -> List[OptionLeg]:
        logger.info(f"Getting option chain for {symbol} exp={expiration} limit={limit}")
        contract = self._get_contract(symbol)
        await self.ib.qualifyContractsAsync(contract)
        
        spot = await self.get_spot_price(symbol)
        if spot == 0:
            logger.warning("Spot price is 0, cannot filter strikes.")
            return []

        logger.info(f"Requesting opt params for chain generation...")
        chains = await self.ib.reqSecDefOptParamsAsync(
            contract.symbol, '', contract.secType, contract.conId
        )
        
        exp_str = expiration.strftime('%Y%m%d')
        
        # Filter strikes around spot to avoid requesting too many tickers
        # 5% range for speed and relevance (was 10%)
        min_strike = spot * 0.95
        max_strike = spot * 1.05
        logger.info(f"Filtering strikes between {min_strike} and {max_strike}")
        
        contracts = []
        seen_contracts = set() # Avoid duplicates if multiple chains cover same options
        
        for chain in chains:
            if exp_str in chain.expirations:
                relevant_strikes = [k for k in chain.strikes if min_strike <= k <= max_strike]
                
                for strike in relevant_strikes:
                    for right in ['C', 'P']:
                        # Unique key for deduplication (ignoring tradingClass for key to avoid duplicates across exchanges)
                        key = (symbol, exp_str, strike, right)
                        if key in seen_contracts:
                            continue
                        seen_contracts.add(key)

                        # Use SMART to let IBKR route. 
                        # Omit tradingClass to let IBKR resolve the best contract (avoids "No security definition" for obscure trading classes)
                        c = Option(symbol, exp_str, strike, right, 'SMART', multiplier='100', currency='USD')
                        contracts.append(c)
        
        logger.info(f"Generated {len(contracts)} potential contracts")
        if not contracts:
            return []

        # Sort contracts by distance from spot to prioritize ATM options
        contracts.sort(key=lambda c: abs(c.strike - spot))

        # Limit to 'limit' contracts for safety/speed in this iteration
        if len(contracts) > limit:
            logger.info(f"Truncating contract list from {len(contracts)} to {limit} for performance.")
            contracts = contracts[:limit]

        # Qualify contracts
        # qualifyContractsAsync might fail for some. We should handle that.
        # It returns a list of qualified contracts.
        try:
            logger.info("Qualifying contracts...")
            await self.ib.qualifyContractsAsync(*contracts)
            logger.info("Contracts qualified.")
        except Exception as e:
            logger.error(f"Error qualifying contracts: {e}")
            # Filter out those that failed (conId == 0)
            contracts = [c for c in contracts if c.conId > 0]
            
        # Double check if any contracts remain
        contracts = [c for c in contracts if c.conId > 0]
        
        if not contracts:
            logger.warning("No contracts could be qualified.")
            return []
        
        # Request market data
        # GenericTickList 13 might help with model greeks if not default
        logger.info(f"Requesting tickers for {len(contracts)} contracts...")
        tickers = await self.ib.reqTickersAsync(*contracts)
        logger.info(f"Got {len(tickers)} tickers")
        
        # Prepare for fallback calculation
        T = (expiration - date.today()).days / 365.0
        vol = await self.get_volatility(symbol)

        legs = []
        for t in tickers:
            # We need greeks. If modelGreeks is None, we can't use this option for the tool.
            # Sometimes greeks take a moment to populate? reqTickersAsync waits for a snapshot.
            
            greeks = None
            if t.modelGreeks and t.modelGreeks.delta is not None:
                greeks = GreekVector(
                    delta=t.modelGreeks.delta or 0,
                    gamma=t.modelGreeks.gamma or 0,
                    theta=t.modelGreeks.theta or 0,
                    vega=t.modelGreeks.vega or 0
                )
            
            price = t.marketPrice()
            if not price or math.isnan(price) or price <= 0:
                price = t.close if t.close and not math.isnan(t.close) else 0
            
            # If price is still 0/nan, maybe use model price?
            if (not price or price <= 0) and t.modelGreeks and t.modelGreeks.optPrice:
                price = t.modelGreeks.optPrice

            iv = None
            if t.modelGreeks:
                iv = t.modelGreeks.impliedVol

            # Fallback: Calculate Greeks and Price if missing
            if not greeks or not price or price <= 0:
                is_call = t.contract.right == 'C'
                calc_price = BlackScholesPricer.price(spot, t.contract.strike, T, self.risk_free_rate, vol, is_call)
                calc_greeks = BlackScholesPricer.greeks(spot, t.contract.strike, T, self.risk_free_rate, vol, is_call)
                
                if not price or price <= 0:
                    price = calc_price
                
                if not greeks:
                    greeks = GreekVector(
                        delta=calc_greeks[0],
                        gamma=calc_greeks[1],
                        theta=calc_greeks[2],
                        vega=calc_greeks[3]
                    )
            
            if iv is None:
                iv = vol

            # Extract Bid/Ask/Mid
            bid = t.bid if t.bid and t.bid > 0 else None
            ask = t.ask if t.ask and t.ask > 0 else None
            mid = None
            if bid and ask:
                mid = (bid + ask) / 2.0
            elif price:
                mid = price

            leg = OptionLeg(
                symbol=t.contract.symbol,
                strike=t.contract.strike,
                expiration=expiration,
                option_type="call" if t.contract.right == 'C' else "put",
                action="buy", 
                quantity=0,
                greeks=greeks,
                price=price,
                bid=bid,
                ask=ask,
                mid=mid,
                implied_volatility=iv
            )
            legs.append(leg)
            
        logger.info(f"Returning {len(legs)} option legs from IBKR provider.")
        return legs
