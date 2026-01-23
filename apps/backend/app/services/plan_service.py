from typing import List, Dict, Any, Optional, Union
from datetime import datetime
from pydantic import BaseModel
from app.schema.plan_models import PlanData, PlanItem
from app.schema.finance_models import FinanceSnapshot

class ProjectionPoint(BaseModel):
    year: int
    age: int
    net_worth: float
    liquid_assets: float
    real_assets: float
    debt: float
    income: float # Gross
    taxable_income: float
    tax_paid: float
    expenses: float
    withdrawals: float
    accounts: List[Dict[str, Any]]

class PlanService:
    @staticmethod
    def _safe_float(val: Any, default: float = 0.0) -> float:
        try:
            return float(val)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _safe_int(val: Any, default: int = 0) -> int:
        try:
            return int(float(val)) # float handles "50.0" -> 50
        except (ValueError, TypeError):
            return default

    @staticmethod
    def calculate_projection(
        plan_data: Dict[str, Any],
        finance_snapshot: Optional[Union[FinanceSnapshot, Dict[str, Any]]],
        user_settings: Dict[str, Any] = {}
    ) -> List[Dict[str, Any]]:
        
        # 1. Config & Initialization
        current_year = datetime.now().year
        _birth_year = user_settings.get("primaryUser", {}).get("birthYear", 1980)
        birth_year = PlanService._safe_int(_birth_year, 1980)
            
        end_age = 95
        end_year = birth_year + end_age
        
        # Inflation / Defaults
        inflation_rate = 0.025 # 2.5%
        
        # Flatten Accounts from Finances
        # Structure: { name: str, value: float, config: Dict }
        accounts = []
        unallocated_cash = 0.0
        
        # Flatten Real Assets (House, Car)
        real_assets = []
        
        items = plan_data.get('items', [])
        milestones = plan_data.get('milestones', [])
        
        # Helper to find plan config for a snapshot item
        def find_item_config(name: str, category: str):
            for i in items:
                if i.get('name') == name and i.get('category') == category:
                    return i
            return None

        # Load from Snapshot
        snapshot_data = None
        if finance_snapshot:
            if isinstance(finance_snapshot, dict):
                 snapshot_data = finance_snapshot.get('data')
            else:
                 snapshot_data = finance_snapshot.data

        if snapshot_data:
            snapshot_items = snapshot_data.get('items', [])
            for f_item in snapshot_items:
                cat = f_item.get('category')
                name = f_item.get('name')
                val = PlanService._safe_float(f_item.get('value', 0))
                
                if cat in ['Savings', 'Investments']:
                    config = find_item_config(name, 'Account') or {}
                    account_settings = config.get('details', {}).get('account_settings', {})
                    # If config is missing, use defaults
                    accounts.append({
                        "name": name,
                        "value": val,
                        "type": account_settings.get('type', 'Taxable'),
                        "growth": PlanService._safe_float(config.get('growth_rate', 5.0)),
                        "yield": PlanService._safe_float(account_settings.get('dividend_yield', 0.0)),
                        "fees": PlanService._safe_float(account_settings.get('fees', 0.0)),
                        "priority": PlanService._safe_int(account_settings.get('withdrawal_priority', 50))
                    })
                elif cat in ['Real Estate', 'Vehicle']:
                    config = find_item_config(name, 'Asset') or {}
                    real_assets.append({
                        "name": name,
                        "value": val,
                        "growth": PlanService._safe_float(config.get('growth_rate', 0.0)),
                        "depreciation": PlanService._safe_float(config.get('depreciation_rate', 0.0)),
                        "loan_balance": 0.0 # TODO: Link liabilities
                    })
                elif cat in ['Debt', 'Liability']:
                     # For now, treat liabilities as negative cash if not linked
                     unallocated_cash -= val
                else:
                    unallocated_cash += val

        # Load "Manual" Accounts (in Plan but not in Snapshot)
        for p_item in items:
            if p_item.get('category') == 'Account':
                # Check if already added via snapshot
                if not any(a['name'] == p_item['name'] for a in accounts):
                    details = p_item.get('details', {})
                    acc_set = details.get('account_settings', {})
                    accounts.append({
                        "name": p_item['name'],
                        "value": PlanService._safe_float(p_item.get('value', 0)),
                        "type": acc_set.get('type', 'Taxable'),
                        "growth": PlanService._safe_float(p_item.get('growth_rate', 5.0)),
                        "yield": PlanService._safe_float(acc_set.get('dividend_yield', 0.0)),
                        "fees": PlanService._safe_float(acc_set.get('fees', 0.0)),
                        "priority": PlanService._safe_int(acc_set.get('withdrawal_priority', 50))
                    })

        # Helper: Resolve Date Conditions
        def get_year_from_condition(item, target_cond_field='start_condition', target_ref_field='start_reference', target_date_field='start_date'):
            cond = item.get(target_cond_field)
            ref = item.get(target_ref_field)
            date_val = item.get(target_date_field)
            
            if cond == 'Date' and date_val:
                try:
                    return datetime.strptime(str(date_val)[:10], "%Y-%m-%d").year
                except:
                    return current_year
            if cond == 'Milestone' and ref:
                # Find milestone
                m = next((x for x in milestones if x.get('id') == ref), None)
                if m:
                    if m.get('date'):
                        try:
                            return datetime.strptime(str(m['date'])[:10], "%Y-%m-%d").year
                        except: 
                            pass
                    if m.get('year_offset') is not None:
                        return current_year + PlanService._safe_int(m['year_offset'])
            if cond == 'Age' and ref:
                # ref is age int
                return birth_year + PlanService._safe_int(ref)
            
            # Defaults
            if target_cond_field == 'end_condition':
                return current_year + 100
            if target_cond_field == 'start_condition':
                return current_year # Start Now
            return current_year

        # 2. Simulation Loop
        projection = []
        
        for year in range(current_year, end_year + 1):
            age = year - birth_year
            
            if year > current_year:
                # A. Growth Phase
                for acc in accounts:
                    rate = (acc['growth'] + acc['yield'] - acc['fees']) / 100.0
                    acc['value'] *= (1 + rate)
                
                # Unallocated Cash Inflation/Growth (Safe rate 2%)
                unallocated_cash *= 1.02 
                
                # Real Assets
                for asset in real_assets:
                    # Growth - Depreciation
                    rate = (asset.get('growth', 0) - asset.get('depreciation', 0)) / 100.0
                    asset['value'] *= (1 + rate)

            # B. Income & Expense Phase
            year_gross_income = 0.0
            year_taxable_income = 0.0 # Simplify: All income taxable unless marked?
            year_tax_paid = 0.0
            year_expense = 0.0
            
            income_details_list = []
            expense_details_list = []
            
            for item in items:
                cat = item.get('category')
                if cat not in ['Income', 'Expense', 'Asset']:
                    continue
                
                start_y = get_year_from_condition(item, 'start_condition', 'start_reference', 'start_date')
                end_y = get_year_from_condition(item, 'end_condition', 'end_reference', 'end_date')
                
                # Check Active
                if year >= start_y and year <= end_y:
                    # Calculate Inflated Value
                    base_val = PlanService._safe_float(item.get('value', 0))
                    item_growth = PlanService._safe_float(item.get('growth_rate', 0))
                    years_passed = year - current_year
                    
                    # Apply Frequency Multiplier
                    freq = item.get('frequency', 'Yearly')
                    
                    if freq == 'OneTime':
                        if year != start_y:
                            continue
                        multiplier = 1.0
                    elif freq == 'Monthly': multiplier = 12.0
                    elif freq == 'Weekly': multiplier = 52.0
                    elif freq == 'Bi-Weekly': multiplier = 26.0
                    elif freq == 'Daily': multiplier = 365.0
                    else: multiplier = 1.0
                    
                    base_val *= multiplier
                    
                    # For Assets (Purchase), we handle differently
                    if cat == 'Asset':
                        # Check Purchase Year (Start Year OR Recurrence)
                        is_purchase = False
                        if year == start_y:
                            is_purchase = True
                        
                        # Recurrence
                        recurrence = item.get('recurrence') or {}
                        if recurrence.get('rule') == 'Replace':
                            period = PlanService._safe_int(recurrence.get('period_years', 10), 10)
                            if period > 0 and year > start_y and (year - start_y) % period == 0:
                                is_purchase = True

                        if is_purchase:
                            # Purchase Cost
                            cost = base_val * ((1 + 0.03) ** years_passed)
                            
                            # Financing
                            financing = item.get('details', {}).get('financing', None)
                            if financing:
                                down_pct = PlanService._safe_float(financing.get('down_payment', 0)) / base_val if base_val else 0
                                down_amt = cost * down_pct
                                year_expense += down_amt
                                expense_details_list.append({
                                    "name": f"Down Payment: {item.get('name')}",
                                    "value": round(down_amt, 2),
                                    "category": "Asset Purchase"
                                })
                                # TODO: Add Loan to liabilities
                            else:
                                year_expense += cost
                                expense_details_list.append({
                                    "name": f"Purchase: {item.get('name')}",
                                    "value": round(cost, 2),
                                    "category": "Asset Purchase"
                                })
                                
                            # Add to Active Real Assets
                            real_assets.append({
                                "name": item.get('name'),
                                "value": cost,
                                "growth": PlanService._safe_float(item.get('growth_rate', 0)),
                                "depreciation": PlanService._safe_float(item.get('depreciation_rate', 0))
                            })
                            
                    else:
                        # Income / Expense
                        current_val = base_val * ((1 + item_growth/100.0) ** years_passed)
                        
                        if cat == 'Income':
                            year_gross_income += current_val
                            
                            # Tax logic
                            tax_rate = PlanService._safe_float(item.get('tax_rate', 0))
                            tax_amount = current_val * (tax_rate/100.0)
                            year_tax_paid += tax_amount
                            
                            # Assume all income here is "Taxable" for display purposes
                            year_taxable_income += current_val

                            income_details_list.append({
                                "name": item.get('name'),
                                "type": item.get('sub_category', 'Earned Income'), # Use sub_category or default
                                "value": round(current_val, 2),
                            })
                            
                        else:
                            year_expense += current_val
                            expense_details_list.append({
                                "name": item.get('name'),
                                "category": item.get('sub_category', 'Living Expenses'),
                                "value": round(current_val, 2)
                            })


            # Net Income
            year_net_income = year_gross_income - year_tax_paid

            # C. Net Flow Rebalancing
            net_flow = year_net_income - year_expense
            withdrawals = 0.0
            savings_breakdown = []
            
            if net_flow > 0:
                # Add to Savings (Priority: 1. Unallocated, 2. Taxable Accounts)
                # For simplicity, add 50% to unallocated, 50% to first "Taxable" account
                # If no taxable, 100% to unallocated
                taxable = next((a for a in accounts if a['type'] == 'Taxable'), None)
                if taxable:
                    amount = net_flow * 0.5
                    taxable['value'] += amount
                    unallocated_cash += amount
                    savings_breakdown.append({"name": taxable['name'], "value": round(amount, 2), "type": "Investment"})
                    savings_breakdown.append({"name": "Cash Savings", "value": round(amount, 2), "type": "Cash"})
                else:
                    unallocated_cash += net_flow
                    savings_breakdown.append({"name": "Cash Savings", "value": round(net_flow, 2), "type": "Cash"})
            else:
                # Deficit
                deficit = abs(net_flow)
                withdrawals = deficit # Tracking how much we pulled from savings
                
                # 1. Drain Cash
                if unallocated_cash >= deficit:
                    unallocated_cash -= deficit
                    deficit = 0
                else:
                    deficit -= unallocated_cash
                    unallocated_cash = 0
                    
                    # 2. Drain Accounts by Priority (Low to High)
                    # Sort active accounts by priority
                    sorted_accs = sorted(accounts, key=lambda x: x['priority'])
                    for acc in sorted_accs:
                        if deficit <= 0: break
                        if acc['value'] >= deficit:
                            acc['value'] -= deficit
                            deficit = 0
                        else:
                            deficit -= acc['value']
                            acc['value'] = 0
                    
                    # If still deficit, Debt increases (negative cash)
                    if deficit > 0:
                        unallocated_cash -= deficit
            
            # Summary
            total_accounts = sum(a['value'] for a in accounts)
            total_real = sum(a['value'] for a in real_assets)
            total_liquid = total_accounts + unallocated_cash
            net_worth = total_liquid + total_real # - debts
            
            projection.append({
                "year": year,
                "age": age,
                "net_worth": round(net_worth, 2),
                "liquid_assets": round(total_liquid, 2),
                "real_assets": round(total_real, 2),
                "debt": 0,
                "income": round(year_gross_income, 2), # Gross
                "taxable_income": round(year_taxable_income, 2),
                "tax_paid": round(year_tax_paid, 2),
                "expenses": round(year_expense, 2),
                "withdrawals": round(withdrawals, 2),
                "accounts": [{"name": a['name'], "value": round(a['value'], 2)} for a in accounts],
                "income_details": income_details_list,
                "expense_details": expense_details_list,
                "savings_details": savings_breakdown
            })


        return projection

