
import pytest
from app.services.plan_service import PlanService

def test_granular_withdrawal_details():
    # Setup: 
    # 1. Finances with RSU account (200k)
    # 2. Plan with High Expense (forcing withdrawal)
    # 3. Verify that 'withdrawal_details' in projection contains specific item.

    plan_data = {
        "items": [
            {
                "id": "exp1",
                "name": "Big Expense",
                "category": "Expense",
                "value": 50000, # Per year
                "currency": "ILS",
                "start_condition": "Date",
                "start_date": "2026-01-01",
                "frequency": "Yearly"
            },
            {
                "id": "acc1",
                "name": "My RSU",
                "category": "Account",
                "value": 100000,
                "currency": "ILS",
                "account_settings": {
                    "type": "RSU",
                    "withdrawal_priority": 1,
                    "growth_rate": 0
                }
            }
        ]
    }

    finance_snapshot = {
        "data": {
            "items": []
        }
    }

    settings = {
        "primaryUser": { "birthYear": 1990 },
        "mainCurrency": "ILS"
    }

    # Run Simulation
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    # Check Year 2026 (first year)
    p_2026 = next((p for p in projection if p['year'] == 2026), None)
    assert p_2026 is not None
    
    print(f"DEBUG: Withdrawals: {p_2026['withdrawals']}")
    print(f"DEBUG: Details: {p_2026.get('withdrawal_details')}")
    
    assert p_2026['withdrawals'] > 0
    assert 'withdrawal_details' in p_2026
    assert len(p_2026['withdrawal_details']) > 0
    assert p_2026['withdrawal_details'][0]['name'] == "Withdrawal: My RSU"
    assert p_2026['withdrawal_details'][0]['type'] == "Portfolio Withdrawal"

def test_cash_withdrawal_details():
    # Setup: 
    # Year 1: High Income -> Builds Unallocated Cash
    # Year 2: High Expense -> Uses Cash
    # Verify 'withdrawal_details' in Year 2 has "Withdrawal: Cash Savings"
    
    expected_withdrawal = {
        "name": "Withdrawal: Unallocated Cash",
        "type": "Portfolio Withdrawal",
        "value": 50000.0
    }
    plan_data = {
        "items": [
            {
                "id": "inc1",
                "name": "Big Income",
                "category": "Income",
                "value": 100000, 
                "currency": "ILS",
                "start_condition": "Date",
                "start_date": "2026-01-01",
                "end_condition": "Date",
                "end_date": "2026-12-31", # Only Year 1
                "frequency": "Yearly"
            },
            {
                "id": "exp1",
                "name": "Big Expense",
                "category": "Expense",
                "value": 50000, 
                "currency": "ILS",
                "start_condition": "Date",
                "start_date": "2027-01-01", # Starts Year 2
                "frequency": "Yearly"
            }
        ]
    }
    
    finance_snapshot = { "data": { "items": [] } }
    
    settings = {
        "primaryUser": { "birthYear": 1990 },
        "mainCurrency": "ILS"
    }

    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    # Check Year 2027 (Year 2)
    p_2027 = next((p for p in projection if p['year'] == 2027), None)
    assert p_2027 is not None
    
    print(f"DEBUG 2027 Withdrawals: {p_2027['withdrawals']}")
    print(f"DEBUG 2027 Details: {p_2027.get('withdrawal_details')}")
    
    assert p_2027['withdrawals'] > 0
    assert 'withdrawal_details' in p_2027
    assert len(p_2027['withdrawal_details']) > 0
    assert p_2027['withdrawal_details'][0]['name'] == "Withdrawal: Unallocated Cash"

if __name__ == "__main__":
    # test_granular_withdrawal_details()
    test_cash_withdrawal_details() 
    print("Test passed!")
