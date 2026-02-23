
from app.services.plan_service import PlanService

def test_unallocated_cash_origin():
    # Test if 'Cash' category item in snapshot creates Unallocated Cash
    
    plan_data = { "items": [] }
    
    finance_snapshot = { 
        "data": { 
            "items": [
                {
                    "id": "item1",
                    "name": "My Wallet",
                    "category": "Cash", # Suspicious category
                    "value": 5000,
                    "currency": "ILS"
                },
                 {
                    "id": "item2",
                    "name": "My Checking",
                    "category": "Checking", # Suspicious category
                    "value": 2000,
                    "currency": "ILS"
                }
            ] 
        }
    }
    settings = { "primaryUser": { "birthYear": 1980 }, "mainCurrency": "ILS" }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    # Check 2026 Unallocated Cash (it's initialized before loop)
    # Actually, calculate_projection returns LIST of years.
    # The `unallocated_cash` is internal state.
    # But it shows up in "Withdrawal: Unallocated Cash" if we have deficit?
    # Or "Unallocated Cash" in savings if we have Surplus?
    # Or just implicit.
    
    # We can inspect the "Withdrawal: Unallocated Cash" if we intentionally create a deficit.
    
    # Let's verify by printing DEBUG logs if I can, OR inspect the first year.
    # If unallocated cash exists and grows (2%), if we have NO expenses/income, it just sits there.
    # It doesn't show up in `accounts`.
    # It doesn't show up in `savings_details` unless we ADD to it.
    
    # It DOES show up if we withdraw from it.
    # So let's force a deficit.
    
    plan_data = {
        "items": [
            {
                "id": "expense",
                "name": "Big Expense",
                "category": "Expense",
                "value": 10000,
                "start_condition": "Date", # Immediate
                "start_date": "2026-01-01"
            }
        ]
    }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    p_2026 = projection[0]
    
    details = p_2026.get('withdrawal_details', [])
    print(f"DEBUG Details: {details}")
    
    # Expectation: 5000+2000 = 7000 Unallocated.
    # Expense 10000.
    # Withdrawal from Unallocated: 7000.
    # Withdrawal from Debt? 3000.
    
    unallocated_withdrawal = next((x for x in details if "Unallocated Cash" in x['name'] or "Cash Savings" in x['name']), None)
    
    if unallocated_withdrawal:
        print(f"FAILURE: Found Unallocated Cash withdrawal: {unallocated_withdrawal['value']}")
    else:
        print("SUCCESS: No Unallocated Cash used (Checking/Cash items ignored?)")

if __name__ == "__main__":
    test_unallocated_cash_origin()
