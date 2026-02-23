import os
import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, Form, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional

from app.dal.database import get_session
from app.schema.finance_models import FinanceSnapshot
from app.schema.plan_models import Plan
from app.utils.copilot_analyzer import analyze_report
from datetime import date, datetime
from sqlalchemy.orm.attributes import flag_modified

router = APIRouter(prefix="/api/pension", tags=["pension"])

@router.post("/upload")
async def upload_pension_report(
    owner: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_session)
):
    try:
        # Save uploaded file
        # Using a reports directory at the root level of the project
        root_dir = Path(__file__).parent.parent.parent.parent.parent
        reports_dir = root_dir / "reports" / owner
        reports_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = reports_dir / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Analyze report with Copilot
        result = await analyze_report(str(file_path))
        
        fund_name = result.get('Pension Fund Name') or result.get('Name') or 'Unknown Pension Fund'
        total_amount = result.get('Total Amount', 0)
        
        if total_amount is not None:
            try:
                # String cleanup in case copilot returns a string with commas
                if isinstance(total_amount, str):
                    total_amount = total_amount.replace(',', '')
                total_amount = float(total_amount)
            except ValueError:
                total_amount = 0.0
        
        # Parse Report Date
        report_date_str = result.get('Report Date')
        target_date = date.today()
        if report_date_str:
            try:
                target_date = datetime.strptime(report_date_str, "%Y-%m-%d").date()
            except ValueError:
                pass # Fallback to today

        # 1. Update Historical Finance Snapshot
        # Find exact match for the date
        snapshot = db.exec(select(FinanceSnapshot).where(FinanceSnapshot.date == target_date)).first()
        snapshot_updated = False
        
        if not snapshot:
            # Need to clone the closest past snapshot to protect history
            closest_past = db.exec(
                select(FinanceSnapshot)
                .where(FinanceSnapshot.date < target_date)
                .order_by(FinanceSnapshot.date.desc())
                .limit(1)
            ).first()
            
            if closest_past:
                import copy
                new_data = copy.deepcopy(closest_past.data) if closest_past.data else {"items": [], "total_savings": 0, "total_investments": 0, "total_assets": 0, "total_liabilities": 0}
                snapshot = FinanceSnapshot(
                    date=target_date,
                    data=new_data,
                    net_worth=closest_past.net_worth,
                    total_assets=closest_past.total_assets,
                    total_liabilities=closest_past.total_liabilities
                )
            else:
                # No past snapshot exists, create an empty one
                snapshot = FinanceSnapshot(
                    date=target_date,
                    data={"items": [], "total_savings": 0, "total_investments": 0, "total_assets": 0, "total_liabilities": 0},
                    net_worth=0.0,
                    total_assets=0.0,
                    total_liabilities=0.0
                )
            # Add early so db.add(snapshot) at the end knows the object
            db.add(snapshot)
            db.commit() # Commit to get an attached instance if needed, or just keep it pending
            
        if snapshot:
            items = snapshot.data.get('items', [])
            
            # Find an existing pension by owner
            existing_item = next((item for item in items if item.get('owner') == owner and item.get('type') == 'Pension'), None)
            
            def safe_float(val):
                if val is None: return 0.0
                if isinstance(val, str):
                    try:
                        return float(val.replace(',', ''))
                    except ValueError:
                        return 0.0
                return float(val)

            if existing_item:
                existing_item['value'] = total_amount
                existing_item['name'] = fund_name
                if 'details' not in existing_item:
                    existing_item['details'] = {}
                deposits = safe_float(result.get('Monthly Deposits') or result.get('Deposits'))
                existing_item['details']['deposits'] = deposits
                existing_item['details']['monthly_contribution'] = deposits
                existing_item['details']['fees'] = safe_float(result.get('Fees'))
                existing_item['details']['earnings'] = safe_float(result.get('Earnings'))
                existing_item['details']['insurance_fees'] = safe_float(result.get('Insurance Fees'))
            else:
                deposits = safe_float(result.get('Monthly Deposits') or result.get('Deposits'))
                new_item = {
                    "id": str(uuid.uuid4()),
                    "category": "Investments",
                    "name": fund_name,
                    "value": total_amount,
                    "type": "Pension",
                    "owner": owner,
                    "inflow_priority": 100,
                    "withdrawal_priority": 100,
                    "currency": "ILS",
                    "details": {
                        "deposits": deposits,
                        "monthly_contribution": deposits,
                        "fees": safe_float(result.get('Fees')),
                        "earnings": safe_float(result.get('Earnings')),
                        "insurance_fees": safe_float(result.get('Insurance Fees'))
                    }
                }
                items.append(new_item)
            
            # Recalculate snapshot totals
            total_savings = sum(item.get('value', 0) for item in items if item.get('category') == 'Savings')
            total_investments = sum(item.get('value', 0) for item in items if item.get('category') == 'Investments')
            assets_category_total = sum(item.get('value', 0) for item in items if item.get('category') == 'Assets')
            total_liabilities = sum(item.get('value', 0) for item in items if item.get('category') == 'Liabilities')
            
            calculated_total_assets = total_savings + total_investments + assets_category_total
            net_worth = calculated_total_assets - total_liabilities
            
            snapshot.data['items'] = items
            snapshot.data['total_savings'] = total_savings
            snapshot.data['total_investments'] = total_investments
            snapshot.data['total_assets'] = calculated_total_assets
            snapshot.data['total_liabilities'] = total_liabilities
            snapshot.net_worth = net_worth
            snapshot.total_assets = calculated_total_assets
            snapshot.total_liabilities = total_liabilities
            
            flag_modified(snapshot, "data")
            
            db.add(snapshot)
            snapshot_updated = True
            
        # 2. Update Plan
        plan = db.exec(select(Plan).limit(1)).first()
        plan_updated = False
        
        if plan:
            plan_items = plan.data.get('items', [])
            
            pension_plan_item = next((item for item in plan_items if item.get('owner') == owner and (item.get('account_settings') or {}).get('type') == 'Pension'), None)
            
            if pension_plan_item:
                pension_plan_item['value'] = total_amount
                pension_plan_item['name'] = fund_name
            else:
                new_plan_item = {
                    "id": str(uuid.uuid4()),
                    "name": fund_name,
                    "category": "Asset",
                    "sub_category": "Pension", # Or any equivalent
                    "owner": owner,
                    "currency": "ILS",
                    "value": total_amount,
                    "growth_rate": 0.05, # Default 5%
                    "frequency": "Yearly",
                    "account_settings": {
                        "type": "Pension"
                    },
                    "details": {}
                }
                plan_items.append(new_plan_item)
                
            plan.data['items'] = plan_items
            flag_modified(plan, "data")
            
            db.add(plan)
            plan_updated = True

        if snapshot_updated or plan_updated:
            db.commit()
            if snapshot_updated:
                db.refresh(snapshot)
            if plan_updated:
                db.refresh(plan)

        return {
            "status": "success", 
            "result": result, 
            "snapshot_updated": snapshot_updated,
            "plan_updated": plan_updated
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/dashboard")
def get_pension_dashboard(db: Session = Depends(get_session)):
    try:
        # History
        statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.asc())
        all_snapshots = db.exec(statement).all()
        
        history_points = []
        historical_accounts = {} # Keep track to fill in missing months if a snapshot is missing this account
        
        # Track the latest stats to build the table
        current_accounts = {}
        
        for snap in all_snapshots:
            items = snap.data.get('items', [])
            pensions = [item for item in items if item.get('type') == 'Pension']
            
            point = {
                "date": snap.date.strftime("%Y-%m-%d"),
            }
            
            for p in pensions:
                owner = p.get('owner', 'Unknown')
                name = p.get('name', 'Unknown')
                key = f"{owner}_{name}"
                val = float(p.get('value', 0))
                
                point[key] = val
                historical_accounts[key] = val
                
                # Update current accounts tracking pointing to the latest known details
                current_accounts[key] = {
                    "id": p.get('id'),
                    "owner": owner,
                    "name": name,
                    "value": val,
                    "details": p.get('details', {})
                }
            
            # Fill in empty ones from historical (so the stacked graph doesn't drop to 0 if a snapshot missed an edit)
            for k, v in historical_accounts.items():
                if k not in point:
                    point[k] = v
                    
            history_points.append(point)

        # Projections
        projections = []
        plan_statement = select(Plan).order_by(Plan.updated_at.desc()).limit(1)
        plan = db.exec(plan_statement).first()
        
        milestones = []
        retirement_years = {"You": 2045, "Rita": 2045} # Defaults
        
        user_settings = plan.data.get('settings', {}) if plan and isinstance(plan.data, dict) else {}
        birth_year = int(user_settings.get('birthYear', 1980))
        
        if plan:
            plan_milestones = plan.data.get('milestones', [])
            for m in plan_milestones:
                if m.get('type') == 'Retirement' or 'Retirement' in m.get('name', ''):
                    owner = m.get('owner', 'You')
                    m_date_str = m.get('date')
                    if m_date_str:
                        try:
                            # e.g., "2045-01-01"
                            from datetime import datetime
                            m_year = datetime.strptime(m_date_str[:10], "%Y-%m-%d").year
                            retirement_years[owner] = m_year
                            milestones.append({"owner": owner, "name": m.get('name'), "date": m_date_str, "year": m_year})
                        except ValueError:
                            pass
                    elif m.get('details', {}).get('age') is not None:
                        target_age = int(m['details']['age'])
                        target_birth_year = birth_year
                        if owner == 'Spouse':
                            target_birth_year = int(user_settings.get("spouse", {}).get("birthYear", birth_year))
                        m_year = target_birth_year + target_age
                        retirement_years[owner] = m_year
                        milestones.append({"owner": owner, "name": m.get('name'), "year": m_year})
                            
        if history_points:
            last_date_str = history_points[-1]["date"]
            from datetime import datetime, timedelta
            import dateutil.relativedelta
            
            last_date = datetime.strptime(last_date_str, "%Y-%m-%d").date()
            
            # Find the max retirement year
            max_year = max(retirement_years.values()) if retirement_years else last_date.year + 20
            
            # Monthly step
            current_date = last_date + dateutil.relativedelta.relativedelta(months=1)
            
            r_annual = 0.0386
            r_monthly = r_annual / 12
            
            # Initialize projection values with the latest historical values
            current_proj_vals = {k: v for k, v in historical_accounts.items()}
            
            while current_date.year <= max_year:
                point = {"date": current_date.strftime("%Y-%m-%d")}
                
                for key, acc in current_accounts.items():
                    owner = acc.get('owner', 'You')
                    s_age = int(acc.get('details', {}).get('starting_age', 67))
                    t_by = birth_year
                    if owner == 'Spouse':
                        t_by = int(user_settings.get("spouse", {}).get("birthYear", birth_year))
                    trigger_year = t_by + s_age
                    
                    # Fallback to retirement_years if valid
                    ret_year = max(trigger_year, retirement_years.get(owner, 2045))
                    
                    if current_date.year <= trigger_year:
                        # Grow
                        deposits = float(acc.get('details', {}).get('deposits') or acc.get('details', {}).get('monthly_contribution') or 0.0)
                        # P * (1 + r) + C
                        new_val = current_proj_vals[key] * (1 + r_monthly) + deposits
                        current_proj_vals[key] = new_val
                    
                    point[key] = current_proj_vals[key]
                
                projections.append(point)
                current_date = current_date + dateutil.relativedelta.relativedelta(months=1)
                
        return {
            "status": "success",
            "history": history_points,
            "projections": projections,
            "accounts": list(current_accounts.values()),
            "milestones": milestones
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{pension_id}")
def delete_pension(pension_id: str, db: Session = Depends(get_session)):
    try:
        deleted_item_owner = None
        deleted_item_name = None
        
        # Delete from the latest snapshot
        latest_snapshot = db.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)).first()
        if latest_snapshot:
            items = latest_snapshot.data.get('items', [])
            original_len = len(items)
            
            # Find the item to get its name and owner
            target_item = next((item for item in items if item.get('id') == pension_id), None)
            if target_item:
                deleted_item_owner = target_item.get('owner')
                deleted_item_name = target_item.get('name')
                
            items = [item for item in items if item.get('id') != pension_id and not (item.get('type') == 'Pension' and item.get('id') == pension_id)]
            
            if len(items) != original_len:
                # Recalculate snapshot totals
                total_savings = sum(item.get('value', 0) for item in items if item.get('category') == 'Savings')
                total_investments = sum(item.get('value', 0) for item in items if item.get('category') == 'Investments')
                assets_category_total = sum(item.get('value', 0) for item in items if item.get('category') == 'Assets')
                total_liabilities = sum(item.get('value', 0) for item in items if item.get('category') == 'Liabilities')
                
                calculated_total_assets = total_savings + total_investments + assets_category_total
                net_worth = calculated_total_assets - total_liabilities
                
                latest_snapshot.data['items'] = items
                latest_snapshot.data['total_savings'] = total_savings
                latest_snapshot.data['total_investments'] = total_investments
                latest_snapshot.data['total_assets'] = calculated_total_assets
                latest_snapshot.data['total_liabilities'] = total_liabilities
                latest_snapshot.net_worth = net_worth
                latest_snapshot.total_assets = calculated_total_assets
                latest_snapshot.total_liabilities = total_liabilities
                
                flag_modified(latest_snapshot, "data")
                db.add(latest_snapshot)
        
        # Delete from Plan
        if deleted_item_owner and deleted_item_name:
            plan = db.exec(select(Plan).limit(1)).first()
            if plan:
                plan_items = plan.data.get('items', [])
                original_plan_len = len(plan_items)
                
                # Assume a plan item matches if its name and owner matches
                plan_items = [item for item in plan_items if not (item.get('name') == deleted_item_name and item.get('owner') == deleted_item_owner)]
                
                if len(plan_items) != original_plan_len:
                    plan.data['items'] = plan_items
                    flag_modified(plan, "data")
                    db.add(plan)
        
        db.commit()
        return {"status": "success"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
