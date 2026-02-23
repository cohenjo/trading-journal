
from app.services.plan_service import PlanService
import json

# Mock Data
plan_data = {
    "items": [
        {
            "id": "p1",
            "name": "Jony's Pension",
            "category": "Account",
            "value": 1000000,
            "currency": "ILS",
            "account_settings": {
                "type": "Pension"
            }
        },
        {
            "id": "s1",
            "name": "Savings",
            "category": "Account",
            "value": 500000,
            "currency": "ILS",
            "account_settings": {
                "type": "Taxable"
            }
        }
    ],
    "milestones": []
}

finance_snapshot = {
    "data": {
        "items": [
            {
                "id": "p1",
                "name": "Jony's Pension",
                "category": "Investments",
                "type": "Pension",
                "value": 1000000,
            },
            {
                "id": "s1",
                "name": "Savings",
                "category": "Savings",
                "type": "Taxable",
                "value": 500000,
            }
        ]
    }
}

user_settings = {
    "primaryUser": {"birthYear": 1980},
    "mainCurrency": "ILS"
}

print("--- Running Projection ---\n")
projection = PlanService.calculate_projection(plan_data, finance_snapshot, user_settings)

p = projection[0]
print(f"Year: {p['year']}")
print(f"Net Worth: {p['net_worth']}")
print(f"Liquid Net Worth: {p['liquid_net_worth']}")

# Pension is 1M, Savings 0.5M. Total 1.5M.
# Liquid should be 0.5M (excluding Pension).
# If Liquid is 1.5M, bug is confirmed.

expected = 500000
actual = p['liquid_net_worth']

if actual > expected:
    print(f"FAILURE: Liquid Net Worth ({actual}) includes Pension! Expected around {expected}.")
else:
    print(f"SUCCESS: Liquid Net Worth ({actual}) excludes Pension.")
