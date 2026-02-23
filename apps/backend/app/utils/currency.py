from typing import Dict

# Hardcoded rates for now. Base currency is ILS.
RATES: Dict[str, float] = {
    'ILS': 1.0,
    'USD': 3.0,
    'EUR': 3.5,
    'ILA': 0.01, # Agorot to ILS (1/100) - Special case handling might be needed elsewhere if handled as unit
    # But usually conversion logic assumes full units. 
    # If ILA is passed as a currency code, we can treat it as 0.01 ILS.
}

def convert_currency(amount: float, from_curr: str, to_curr: str) -> float:
    """
    Convert amount from one currency to another using fixed rates.
    """
    if not amount:
        return 0.0
    
    # Normalization
    from_curr = from_curr.upper()
    to_curr = to_curr.upper()
    
    # Handle Agorot (ILA)
    # yfinance returns 'ILA' for TA stocks. 
    # 1 ILA = 0.01 ILS. 
    # If we define rate 0.01 relative to ILS (Base), the math works:
    # ILS Value = Amount * Rate(ILA) = Amount * 0.01
    # Target Value = ILS Value / Rate(Target)
    
    from_rate = RATES.get(from_curr, 1.0)
    to_rate = RATES.get(to_curr, 1.0)
    
    in_base = amount * from_rate
    return in_base / to_rate

def normalize_currency(curr: str, ticker: str = "") -> str:
    """
    Normalize currency code. 
    e.g. ILA -> ILS (and caller should divide value by 100? Or we handle it via rate?)
    
    If we use the rate approach, we keep ILA as the currency code for calculation, 
    but for display we might want ILS.
    
    Strategy:
    If yfinance returns ILA, it means the raw number is in Agorot.
    We generally want to store/display value in ILS.
    So we should convert the raw value and change currency label to ILS.
    """
    curr = curr.upper() if curr else ""
    if curr == 'ILA':
        return 'ILS'
    if curr == 'USD':
        return 'USD'
    
    # Fallback by ticker
    if not curr and ticker.endswith('.TA'):
        return 'ILS'
        
    return curr or 'USD' # Default
