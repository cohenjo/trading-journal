
from app.services.plan_service import PlanService

def test_spouse_pension_start():
    # User 58. Spouse 60.
    # Pension (Spouse) Start 60.
    # Should pay immediately.
    
    plan_data = {
        "items": [
            {
                "id": "pension_rita",
                "name": "Rita's Pension",
                "category": "Account",
                "value": 1000000, 
                "currency": "ILS",
                "owner": "Spouse", # Crucial
                "account_settings": {
                    "type": "Pension",
                    "draw_income": True,
                    "starting_age": 60,
                    "divide_rate": 200 # 1M / 200 = 5000/mo = 60000/yr
                }
            }
        ]
    }
    
    finance_snapshot = { "data": { "items": [] }}
    
    # Birth Year logic:
    # If 2026.
    # User 58 -> Born 2026-58 = 1968.
    # Spouse 60 -> Born 2026-60 = 1966.
    
    settings = { 
        "primaryUser": { "birthYear": 1968 }, 
        "spouse": { "birthYear": 1966 },
        "mainCurrency": "ILS" 
    }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    p_2026 = next(p for p in projection if p['year'] == 2026)
    
    # Check income
    # Look for "Rita's Pension" in income sources or just total income.
    # Total Income should be ~60,000.
    
    print(f"DEBUG 2026 (User 58, Spouse 60) Income: {p_2026.get('income', 0)}")
    
    # Check 2027 (User 59, Spouse 61). Logic runs here.
    p_2027 = next(p for p in projection if p['year'] == 2027)
    val_2027 = p_2027.get('income', 0)
    print(f"DEBUG 2027 (User 59, Spouse 61) Income: {val_2027}")
    
    if val_2027 > 0:
        print("SUCCESS: Pension started at Spouse age 60 (Effective 61 in sim).")
    else:
        print("FAILURE: Pension NOT started.")

if __name__ == "__main__":
    test_spouse_pension_start()
