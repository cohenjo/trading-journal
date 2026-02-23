
import pytest
from app.services.plan_service import PlanService

def test_debug_2035_scenario():
    # Setup similar to user's 2035 state
    # IBKR Account with 2.8M ILS is Key.
    # We want to see if it withdraws.
    
    plan_data = {
        "items": [
            {
                "id": "ibkr",
                "name": "IBKR",
                "category": "Account",
                "value": 2800000, 
                "currency": "ILS",
                "account_settings": {
                    "type": "Broker",
                    "withdrawal_priority": 1,
                    "max_withdrawal_rate": 4.0 # Assuming 4% rule
                }
            },
            {
                "id": "exp_retire",
                "name": "Retirement Expense",
                "category": "Expense",
                "value": 400000, # Large expense causing deficit
                "start_condition": "Date",
                "start_date": "2035-01-01",
                "frequency": "Yearly"
            }
        ]
    }
    
    finance_snapshot = { "data": { "items": [] }}
    
    settings = { "primaryUser": { "birthYear": 1980 }, "mainCurrency": "ILS" }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    p_2035 = next((p for p in projection if p['year'] == 2035), None)
    
    print(f"DEBUG Withdrawals Req: {p_2035['withdrawals']}")
    print(f"DEBUG Income: {p_2035['income']}")
    print(f"DEBUG Expenses: {p_2035['expenses']}")
    print(f"DEBUG Accounts Count: {len(p_2035['accounts'])}")
    acc_names = [a['name'] for a in p_2035['accounts']]
    print(f"DEBUG Account Names: {acc_names}")
    print(f"DEBUG Withdrawal Details: {p_2035.get('withdrawal_details')}")
    
    # We expect some withdrawal from IBKR
    # If Details is empty, that's the bug.
    
    # Also verify why it might be 0
    # Check account value in 2035
    acc_ibkr = next((a for a in p_2035['accounts'] if a['name'] == 'IBKR'), None)
    print(f"DEBUG IBKR Value 2035: {acc_ibkr['value']}")

if __name__ == "__main__":
    test_debug_2035_scenario()
