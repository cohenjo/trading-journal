
from app.services.plan_service import PlanService

def test_debug_surplus_logic():
    # Verify why money might go to Unallocated Cash instead of Broker
    
    plan_data = {
        "items": [
            {
                "id": "leumi",
                "name": "Leumi",
                "category": "Account",
                "value": 50000, 
                "currency": "ILS",
                "account_settings": {
                    "type": "Savings",
                    "inflow_priority": 10,
                    "savings_goal": 60000 
                }
            },
            {
                "id": "ibkr",
                "name": "IBKR",
                "category": "Account",
                "value": 100000,
                "currency": "ILS",
                "account_settings": {
                    "type": "Broker",
                    "inflow_priority": 20
                }
            },
            {
                "id": "job",
                "name": "Job",
                "category": "Income",
                "value": 200000, # Big surplus
                "start_condition": "Date",
                "start_date": "2026-01-01"
            }
        ]
    }
    
    finance_snapshot = { "data": { "items": [] }}
    settings = { "primaryUser": { "birthYear": 1980 }, "mainCurrency": "ILS" }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    p_2026 = next(p for p in projection if p['year'] == 2026)
    
    leumi = next(a for a in p_2026['accounts'] if a['name'] == "Leumi")
    ibkr = next(a for a in p_2026['accounts'] if a['name'] == "IBKR")
    
    savings_details = p_2026['savings_details']
    print(f"DEBUG Savings Details: {savings_details}")
    
    # Check Unallocated Cash logic
    unallocated = next((x for x in savings_details if x['name'] == "Unallocated Cash"), None)
    
    print(f"DEBUG Leumi: {leumi['value']}")
    print(f"DEBUG IBKR: {ibkr['value']}")
    
    # Leumi should accept 10k (cap 60k).
    # Net Flow ~200k.
    # IBKR should accept rest (190k).
    # Unallocated should be 0 (or not present).
    
    if unallocated:
        print(f"FAILURE: Unallocated Cash found: {unallocated['value']}")
    else:
        print("SUCCESS: No Unallocated Cash")
        
    print(f"DEBUG Logic Trace: Leumi Cap {60000}, Previous {50000}. Filled to {leumi['value']}")

if __name__ == "__main__":
    test_debug_surplus_logic()
