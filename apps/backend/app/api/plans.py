from datetime import datetime
from typing import List, Optional, Union, Dict, Any
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from opentelemetry import metrics

from app.dal.database import get_session
from app.schema.plan_models import Plan, PlanData
from app.schema.finance_models import FinanceSnapshot
from app.services.plan_service import PlanService
from pydantic import BaseModel

router = APIRouter(prefix="/api/plans", tags=["plans"])
meter = metrics.get_meter(__name__)
simulation_duration_histogram = meter.create_histogram(
    "plans.simulation.duration.ms",
    unit="ms",
    description="Plan simulation endpoint duration in milliseconds.",
)
simulation_request_counter = meter.create_counter(
    "plans.simulation.request.count",
    unit="1",
    description="Number of plan simulation requests.",
)

class SimulationRequest(BaseModel):
    plan: PlanData
    finances: Optional[Union[FinanceSnapshot, Dict[str, Any]]] = None
    settings: Dict[str, Any] = {}

class ProjectionPoint(BaseModel):
    year: int
    age: int
    net_worth: float
    liquid_assets: float
    real_assets: float
    debt: float
    income: float
    taxable_income: float
    tax_paid: float
    expenses: float
    withdrawals: float
    accounts: List[Dict[str, Any]]
    income_details: List[Dict[str, Any]] = []
    expense_details: List[Dict[str, Any]] = []
    savings_details: List[Dict[str, Any]] = []
    withdrawal_details: List[Dict[str, Any]] = []
    milestones_hit: List[str] = []
    liquid_net_worth: Optional[float] = 0.0
    total_dividend_income: Optional[float] = 0.0
@router.post("/simulate", response_model=List[ProjectionPoint])
def simulate_plan(request: SimulationRequest, db: Session = Depends(get_session)):
    """
    Run a projection simulation based on the plan, optional finance snapshot, and user settings.
    """
    finances = request.finances
    # If finances not provided in request (None), fetch latest from DB
    if not finances:
        statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)
        finances = db.exec(statement).first()
    
    # If finances WAS provided but might be a Dict (from JSON payload) that didn't match strict model,
    # PlanService is now updated to handle Dict or Model.
    
    simulation_request_counter.add(1)
    start_time = time.perf_counter()
    try:
        result = PlanService.calculate_projection(
            request.plan.model_dump(),
            finances,
            request.settings,
            db=db
        )
        return result
    except Exception as e:
        import traceback
        # Log to standard error for docker capture
        print(f"Simulation Error: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        simulation_duration_histogram.record((time.perf_counter() - start_time) * 1000)

@router.get("/", response_model=List[Plan])
def get_plans(db: Session = Depends(get_session)):
    statement = select(Plan).order_by(Plan.updated_at.desc())
    plans = db.exec(statement).all()
    return plans

@router.get("/latest", response_model=Plan)
def get_latest_plan(db: Session = Depends(get_session)):
    """
    Get the most recently updated plan. 
    """
    statement = select(Plan).order_by(Plan.updated_at.desc()).limit(1)
    plan = db.exec(statement).first()
    if not plan:
        raise HTTPException(status_code=404, detail="No plans found")
    return plan

@router.get("/{plan_id}", response_model=Plan)
def get_plan(plan_id: int, db: Session = Depends(get_session)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan

@router.post("/", response_model=Plan)
def create_plan(plan_in: PlanData, name: str = "My Plan", description: Optional[str] = None, db: Session = Depends(get_session)):
    """
    Create a new plan.
    """
    plan_data_dict = plan_in.model_dump(mode='json')
    new_plan = Plan(
        name=name,
        description=description,
        data=plan_data_dict
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)
    return new_plan

@router.put("/{plan_id}", response_model=Plan)
def update_plan(plan_id: int, plan_in: PlanData, db: Session = Depends(get_session)):
    """
    Update an existing plan's data. 
    """
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
        
    plan.data = plan_in.model_dump(mode='json')
    plan.updated_at = datetime.utcnow()
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan

@router.delete("/{plan_id}", response_model=bool)
def delete_plan(plan_id: int, db: Session = Depends(get_session)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
        
    db.delete(plan)
    db.commit()
    return True
