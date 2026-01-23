
import sys
import os
import json
import traceback

# Add backend to path
sys.path.append(os.getcwd())

from app.services.plan_service import PlanService

from app.schema.finance_models import FinanceSnapshot
from app.api.plans import SimulationRequest

fallback_finances_dict = { 
    "net_worth": 0, 
    "total_assets": 0,
    "total_liabilities": 0,
    "date": "2026-01-23",
    "data": { "items": [], "total_investments": 0, "total_savings": 0 } 
}

# Mimic the API Pydantic parsing
try:
    print("Parsing/Validation SimulationRequest...")
    req = SimulationRequest(
        plan={"items": [], "milestones": [], "settings": {}}, 
        finances=fallback_finances_dict, 
        settings={}
    )
    print("Parsing OK.")
    print(f"Finances type: {type(req.finances)}")
    
    # Run Service
    results = PlanService.calculate_projection(req.plan.model_dump(), req.finances, req.settings)
    print("Service OK.")

except Exception:
    traceback.print_exc()

