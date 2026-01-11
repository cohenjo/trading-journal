class Option:
    def __init__(self, strike, is_call, qty):
        self.strike = strike
        self.is_call = is_call
        self.qty = qty  # +1 long, -1 short