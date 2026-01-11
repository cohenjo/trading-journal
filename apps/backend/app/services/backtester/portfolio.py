from datetime import date, datetime
from typing import Dict, List, Optional
from pydantic import BaseModel

class Position(BaseModel):
    conid: int
    symbol: str
    expiration: Optional[date] = None
    strike: Optional[float] = None
    right: Optional[str] = None
    quantity: float
    avg_price: float
    current_price: float = 0.0
    
    @property
    def market_value(self) -> float:
        return self.quantity * self.current_price * 100 # Assuming 100 multiplier

    @property
    def unrealized_pnl(self) -> float:
        return (self.current_price - self.avg_price) * self.quantity * 100

class Portfolio:
    def __init__(self, initial_capital: float):
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.positions: Dict[int, Position] = {} # conid -> Position
        self.realized_pnl = 0.0
        self.trade_log: List[dict] = []

    @property
    def total_equity(self) -> float:
        pos_value = sum(p.market_value for p in self.positions.values())
        return self.cash + pos_value

    @property
    def total_unrealized_pnl(self) -> float:
        return sum(p.unrealized_pnl for p in self.positions.values())

    def update_price(self, conid: int, price: float):
        if conid in self.positions:
            self.positions[conid].current_price = price

    def add_trade(self, date: datetime, conid: int, symbol: str, action: str, quantity: float, price: float, commission: float = 0.0, expiration: date = None, strike: float = None, right: str = None):
        """
        Execute a trade and update portfolio state.
        """
        cost = quantity * price * 100
        
        if action == "BUY":
            self.cash -= (cost + commission)
            if conid in self.positions:
                pos = self.positions[conid]
                
                if pos.quantity < 0:
                    # Closing Short Position (Buying back)
                    # PnL = (Entry Price - Exit Price) * Qty * 100
                    # Entry Price = pos.avg_price
                    # Exit Price = price
                    # Qty = quantity (positive)
                    
                    # Check if we are closing fully or partially
                    qty_to_close = min(abs(pos.quantity), quantity)
                    
                    pnl = (pos.avg_price - price) * qty_to_close * 100
                    self.realized_pnl += (pnl - commission)
                    
                    pos.quantity += quantity # quantity is positive, pos.quantity is negative. e.g. -1 + 1 = 0
                    
                    if pos.quantity == 0:
                        del self.positions[conid]
                    elif pos.quantity > 0:
                        # We flipped from short to long? (Unlikely in this strategy but possible)
                        # The remaining quantity is new long position
                        # Reset avg price for the new long portion?
                        # Simplified: Just update quantity. The avg_price for the short portion is gone.
                        # The new long portion should have avg_price = price
                        pos.avg_price = price
                else:
                    # Adding to Long Position
                    total_cost = (pos.quantity * pos.avg_price * 100) + cost
                    pos.quantity += quantity
                    if pos.quantity != 0:
                        pos.avg_price = total_cost / (pos.quantity * 100)
            else:
                # New Long Position
                self.positions[conid] = Position(
                    conid=conid, 
                    symbol=symbol, 
                    expiration=expiration,
                    strike=strike,
                    right=right,
                    quantity=quantity, 
                    avg_price=price, 
                    current_price=price
                )
                
        elif action == "SELL":
            self.cash += (cost - commission)
            if conid in self.positions:
                pos = self.positions[conid]
                
                if pos.quantity > 0:
                    # Closing Long Position (Selling)
                    # PnL = (Exit Price - Entry Price) * Qty * 100
                    qty_to_close = min(pos.quantity, quantity)
                    
                    pnl = (price - pos.avg_price) * qty_to_close * 100
                    self.realized_pnl += (pnl - commission)
                    
                    pos.quantity -= quantity
                    if pos.quantity == 0:
                        del self.positions[conid]
                    elif pos.quantity < 0:
                        # Flipped to short
                        pos.avg_price = price
                else:
                    # Adding to Short Position (Selling more)
                    # pos.quantity is negative. quantity is positive (amount to sell).
                    # New quantity = pos.quantity - quantity (more negative)
                    # We need to average the price.
                    # Current value = abs(pos.quantity) * pos.avg_price
                    # New value = quantity * price
                    current_val = abs(pos.quantity) * pos.avg_price * 100
                    new_val = quantity * price * 100
                    total_val = current_val + new_val
                    
                    pos.quantity -= quantity
                    pos.avg_price = total_val / (abs(pos.quantity) * 100)

            else:
                # New Short Position
                self.positions[conid] = Position(
                    conid=conid, 
                    symbol=symbol, 
                    expiration=expiration,
                    strike=strike,
                    right=right,
                    quantity=-quantity, 
                    avg_price=price, 
                    current_price=price
                )

        self.trade_log.append({
            "date": date,
            "action": action,
            "conid": conid,
            "symbol": symbol,
            "quantity": float(quantity),
            "price": float(price),
            "commission": float(commission),
            "equity": float(self.total_equity),
            "realized_pnl": float(self.realized_pnl)
        })
