from typing import List, Dict, Any, Optional, Union
from sqlmodel import Session
from datetime import datetime
from pydantic import BaseModel
from app.schema.plan_models import PlanData, PlanItem
from app.schema.finance_models import FinanceSnapshot
from app.services.plan_components import MilestoneManager, AccountManager, RealAssetManager, PlanInterfaces

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
    withdrawal_details: List[Dict[str, Any]]
    milestones_hit: List[str]
    liquid_net_worth: float
    total_dividend_income: float


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
    def _convert(amount: float, from_curr: str, to_curr: str) -> float:
        if not amount: return 0.0
        # Rates: USD=3 ILS, EUR=3.5 ILS. Base ILS=1
        rates = {
            'ILS': 1.0,
            'USD': 3.0,
            'EUR': 3.5
        }
        from_rate = rates.get(from_curr, 1.0)
        to_rate = rates.get(to_curr, 1.0)
        
        in_ils = amount * from_rate
        return in_ils / to_rate

    @staticmethod
    def calculate_projection(
        plan_data: Dict[str, Any],
        finance_snapshot: Optional[Union[FinanceSnapshot, Dict[str, Any]]],
        user_settings: Dict[str, Any] = {},
        db: Optional[Session] = None
    ) -> List[Dict[str, Any]]:
        
        # 1. Config & Initialization
        current_year = datetime.now().year
        _birth_year = user_settings.get("primaryUser", {}).get("birthYear", 1980)
        birth_year = PlanService._safe_int(_birth_year, 1980)
        main_currency = user_settings.get("mainCurrency", "ILS")
        
        end_age = 95
        end_year = birth_year + end_age
        
        # 2. Instantiate Managers
        # Load Accounts & Assets
        accounts = AccountManager.load_accounts(plan_data, finance_snapshot, user_settings, db=db)
        real_assets_list, unallocated_cash_diff = RealAssetManager.load_real_assets(plan_data, finance_snapshot, user_settings)
        
        account_manager = AccountManager(accounts, user_settings, birth_year)
        real_asset_manager = RealAssetManager(real_assets_list)
        
        # Unallocated Cash start (usually 0 unless debt found in snapshot)
        unallocated_cash = unallocated_cash_diff
        
        # Milestones
        milestones = plan_data.get('milestones', [])
        milestone_manager = MilestoneManager(milestones, birth_year, user_settings, accounts)
        
        # Plan Items (Income/Expense/Assignments)
        items = plan_data.get('items', [])

        # 3. Simulation Loop
        projection = []
        
        for year in range(current_year, end_year + 1):
            age = year - birth_year
            
            # Dynamic Milestones (Stub)
            liq_nw = account_manager.get_liquid_accounts_value() + unallocated_cash
            milestone_manager.check_dynamic_milestones(year, liq_nw, 0.0) # expenses passed as 0 for now to avoid circular dep
            
            # Determine active milestones/annuities
            resolved_milestones = milestone_manager.resolved_milestones
            active_annuities = account_manager.active_annuities
            
            dividend_payouts = []
            
            if year > current_year:
                # A. Growth Phase
                unallocated_cash, year_div_payouts, active_annuities = account_manager.process_growth_and_income(
                    year, unallocated_cash, resolved_milestones
                )
                dividend_payouts = year_div_payouts
                real_asset_manager.process_growth()
            else:
                # For the first year, calculate "current" dividend income for display
                # without actually applying growth/payouts to the balance.
                for acc in account_manager.accounts:
                    gross_dividend = 0.0
                    if acc.get('dividend_mode') == 'Fixed' and acc.get('dividend_fixed_amount'):
                         gross_dividend = acc['dividend_fixed_amount']
                    else:
                        yield_rate = acc.get('yield', 0.0)
                        if yield_rate > 0:
                            gross_dividend = acc['value'] * (yield_rate / 100.0)
                    
                    if gross_dividend > 0:
                        # We don't apply it to value or taxes here, just for reporting total_dividend_income
                        dividend_payouts.append({
                            "name": f"Dividend: {acc['name']}",
                            "type": "Dividend Income",
                            "gross": gross_dividend
                        })
            
            # B. Income & Expense Phase
            withdrawal_details_list = []
            year_gross_income = 0.0
            year_taxable_income = 0.0
            year_tax_paid = 0.0
            year_expense = 0.0
            
            income_details_list = []
            expense_details_list = []
            
            for item in items:
                cat = item.get('category')
                if cat not in ['Income', 'Expense', 'Asset']:
                    continue
                
                # Use Manager for Condition Checks
                start_y = milestone_manager.get_year_from_condition(item, 'start_condition', 'start_reference', 'start_date')
                end_y = milestone_manager.get_year_from_condition(item, 'end_condition', 'end_reference', 'end_date')
                
                if year >= start_y and year <= end_y:
                    base_val_raw = PlanService._safe_float(item.get('value', 0))
                    base_val = PlanService._convert(base_val_raw, item.get('currency', 'ILS'), main_currency)
                    
                    item_growth = PlanService._safe_float(item.get('growth_rate', 0))
                    years_passed = year - current_year
                    
                    # Frequency
                    freq = item.get('frequency', 'Yearly')
                    multiplier = 1.0
                    if freq == 'OneTime':
                        if year != start_y: continue
                    elif freq == 'Monthly': multiplier = 12.0
                    elif freq == 'Weekly': multiplier = 52.0
                    elif freq == 'Bi-Weekly': multiplier = 26.0
                    elif freq == 'Daily': multiplier = 365.0
                    
                    base_val *= multiplier
                    
                    if cat == 'Asset':
                         # Asset Purchase
                         is_purchase = False
                         if year == start_y: is_purchase = True
                         
                         recurrence = item.get('recurrence') or {}
                         if recurrence.get('rule') == 'Replace':
                             period = PlanService._safe_int(recurrence.get('period_years', 10), 10)
                             if period > 0 and year > start_y and (year - start_y) % period == 0:
                                 is_purchase = True

                         if is_purchase:
                             cost = base_val * ((1 + 0.03) ** years_passed) # 3% asset inflation stub
                             
                             financing = item.get('details', {}).get('financing', None)
                             if financing:
                                 down_pct = PlanService._safe_float(financing.get('down_payment', 0)) / base_val_raw if base_val_raw else 0
                                 down_amt = cost * down_pct
                                 year_expense += down_amt
                                 expense_details_list.append({
                                     "name": f"Down Payment: {item.get('name')}",
                                     "value": round(down_amt, 2),
                                     "type": "Asset Purchase"
                                 })
                             else:
                                 year_expense += cost
                                 expense_details_list.append({
                                     "name": f"Purchase: {item.get('name')}",
                                     "value": round(cost, 2),
                                     "type": "Asset Purchase"
                                 })

                             # Add to Real Asset Manager
                             real_asset_manager.add_asset(item, base_val_raw, cost)

                    else:
                        # Income / Expense
                        current_val = base_val * ((1 + item_growth/100.0) ** years_passed)
                        
                        if cat == 'Income':
                            year_gross_income += current_val
                            tax_rate = PlanService._safe_float(item.get('tax_rate', 0))
                            tax_amount = current_val * (tax_rate/100.0)
                            year_tax_paid += tax_amount
                            year_taxable_income += current_val
                            
                            income_details_list.append({
                                "name": item.get('name'),
                                "type": item.get('sub_category', 'Earned Income'),
                                "value": round(current_val, 2),
                            })
                        else:
                            year_expense += current_val
                            expense_details_list.append({
                                "name": item.get('name'),
                                "type": item.get('sub_category', 'General'),
                                "value": round(current_val, 2)
                            })

            # Add Dividend Payouts to Income
            for div in dividend_payouts:
                gross = div.get('gross', 0.0)
                year_gross_income += gross
                year_tax_paid += div.get('tax', 0.0)
                year_taxable_income += gross
                
                # Show Gross in Sankey usually if Tax is shown separate
                div_display = div.copy()
                div_display['value'] = round(gross, 2)
                income_details_list.append(div_display)

            # Add Pension Payouts
            for ann in active_annuities:
                val = ann['payout']
                t_rate = ann.get('tax_rate', 0.0)
                year_gross_income += val
                year_tax_paid += val * (t_rate / 100.0)
                year_taxable_income += val
                
                income_details_list.append({
                    "name": f"Pension: {ann['name']}",
                    "type": "Pension Income",
                    "value": round(val, 2)
                })

            year_net_income = year_gross_income - year_tax_paid
            net_flow = year_net_income - year_expense
            
            savings_breakdown = []
            withdrawals = 0.0
            
            if net_flow > 0:
                # Savings
                _, unallocated_cash, savings_breakdown = account_manager.process_savings(net_flow, unallocated_cash)
            else:
                # Deficit
                deficit = abs(net_flow)
                _, unallocated_cash, withdrawals, withdrawal_details_list = account_manager.process_deficit(deficit, unallocated_cash)
            
            # Summaries
            total_net_worth = 0.0
            liquid_net_worth = 0.0
            total_real_assets = 0.0
            
            # From Managers
            liq, debt = real_asset_manager.get_liquid_assets_value(items)
            liquid_net_worth += liq
            
            # Accounts
            liquid_net_worth += account_manager.get_liquid_accounts_value()
                
            liquid_net_worth += unallocated_cash
            
            # Total Real Assets (for display)
            for ra in real_asset_manager.real_assets:
                total_real_assets += ra['value']
            
            # Calculate Total Net Worth independent of Liquid NW
            total_accounts_val = sum(a['value'] for a in account_manager.accounts)
            total_net_worth = total_accounts_val + unallocated_cash + total_real_assets - debt
            
            projection.append({
                "year": year,
                "age": age,
                "net_worth": round(total_net_worth, 2),
                "liquid_net_worth": round(liquid_net_worth, 2), # New Field
                "liquid_assets": round(liquid_net_worth, 2), # Legacy
                "real_assets": round(total_real_assets, 2),
                "debt": 0.0, # TODO
                "income": round(year_gross_income, 2),
                "taxable_income": round(year_taxable_income, 2),
                "tax_paid": round(year_tax_paid, 2),
                "expenses": round(year_expense, 2),
                "withdrawals": round(withdrawals, 2),
                "accounts": [a.copy() for a in account_manager.accounts], # Snapshot
                "withdrawal_details": withdrawal_details_list,
                "income_details": income_details_list,
                "expense_details": expense_details_list,
                "savings_details": savings_breakdown,
                "milestones_hit": milestone_manager.get_hits_for_year(year),
                "total_dividend_income": round(sum(div.get('gross', 0.0) for div in dividend_payouts), 2)
            })
            
        return projection
