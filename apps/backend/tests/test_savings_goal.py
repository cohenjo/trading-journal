
def test_savings_goal_cap():
    # Test that surplus respects savings goal
    from app.services.plan_service import PlanService
    
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
                    "inflow_priority": 1,
                    "savings_goal": 60000 # Cap at 60k
                }
            },
            {
                "id": "ibkr",
                "name": "IBKR",
                "category": "Account",
                "value": 0,
                "currency": "ILS",
                "account_settings": {
                    "type": "Broker",
                    "inflow_priority": 2
                }
            },
            {
                "id": "job",
                "name": "Job",
                "category": "Income",
                "value": 100000, # Surplus
                "start_condition": "Date",
                "start_date": "2026-01-01"
            }
        ]
    }
    
    finance_snapshot = { "data": { "items": [] }}
    settings = { "primaryUser": { "birthYear": 1980 }, "mainCurrency": "ILS" }
    
    projection = PlanService.calculate_projection(plan_data, finance_snapshot, settings)
    
    p_2026 = next(p for p in projection if p['year'] == 2026)
    
    # Net Flow ~100k (Tax 0 for simple test)
    # Leumi starts at 50k. Goal 60k. Space 10k.
    # Should take 10k.
    # Remaining 90k should go to IBKR.
    
    leumi = next(a for a in p_2026['accounts'] if a['name'] == "Leumi")
    ibkr = next(a for a in p_2026['accounts'] if a['name'] == "IBKR")
    
    print(f"DEBUG Leumi Value: {leumi['value']}")
    print(f"DEBUG IBKR Value: {ibkr['value']}")
    
    assert leumi['value'] == 60000.0, f"Leumi should be capped at 60k, got {leumi['value']}"
    assert ibkr['value'] > 0, "IBKR should receive overflow"
    # IBKR roughly 90k + growth
    
    print("Test Savings Goal Cap Passed!")

if __name__ == "__main__":
    test_savings_goal_cap()
