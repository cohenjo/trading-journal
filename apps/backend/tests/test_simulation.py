
from fastapi.testclient import TestClient
from app.services.plan_service import PlanService
from main import app

client = TestClient(app)

def test_plan_simulation_structure():
    # 1. Define a Mock Plan
    plan_data = {
        "items": [
            {
                "id": "job1",
                "name": "My Job",
                "category": "Income",
                "sub_category": "Earned Income", 
                "owner": "You",
                "value": 100000,
                "growth_rate": 0,
                "start_condition": "Now",
                "tax_rate": 20
            },
            {
                "id": "rent1",
                "name": "Apartment Rent",
                "category": "Expense",
                "sub_category": "Housing",
                "owner": "You",
                "value": 30000,
                "growth_rate": 0,
                "start_condition": "Now"
            },
             {
                "id": "acc1",
                "name": "My 401k",
                "category": "Account",
                "owner": "You",
                "value": 50000,
                "growth_rate": 5,
                "details": {
                    "account_settings": { "type": "401k" }
                }
            }
        ],
        "milestones": [],
        "settings": {}
    }

    request_payload = {
        "plan": plan_data,
        "finances": None, # Will use defaults or trigger empty if no DB access, but service handles None
        "settings": { "primaryUser": { "birthYear": 1990 } }
    }

    # 2. Call the Endpoint
    response = client.post("/api/plans/simulate", json=request_payload)
    
    if response.status_code != 200:
        print(response.json())

    # 3. Assertions
    assert response.status_code == 200
    data = response.json()
    
    assert isinstance(data, list)
    assert len(data) > 0
    
    first_year = data[0]
    
    # Check Schema Keys
    assert "income_details" in first_year
    assert "expense_details" in first_year
    assert "savings_details" in first_year
    
    # Check Calculations (Year 1)
    # Income: 100k
    assert first_year["income"] == 100000.0
    
    # Tax: 20% of 100k = 20k
    assert first_year["tax_paid"] == 20000.0
    
    # Expenses: 30k
    assert first_year["expenses"] == 30000.0
    
    # Net Flow = 100k - 20k - 30k = 50k
    # Should flow into savings
    # Expected Net Worth improvement roughly 50k + investment growth
    
    # Check Details
    incomes = first_year["income_details"]
    assert len(incomes) == 1
    assert incomes[0]["name"] == "My Job"
    assert incomes[0]["value"] == 100000.0
    
    expenses = first_year["expense_details"]
    assert len(expenses) == 1
    assert expenses[0]["name"] == "Apartment Rent"
    
    # Savings Breakdown check
    # We expect some savings if Net Flow is positive
    savings = first_year["savings_details"]
    assert len(savings) > 0
    total_savings_flow = sum(s["value"] for s in savings)
    assert total_savings_flow == 50000.0

