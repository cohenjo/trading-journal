from typing import List, Dict, Any, Optional, Union, Set
from sqlmodel import Session
from datetime import datetime, date

class PlanInterfaces:
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

class MilestoneManager:
    def __init__(self, milestones: List[Dict], birth_year: int, user_settings: Dict, accounts: List[Dict]):
        self.milestones = milestones
        self.birth_year = birth_year
        self.user_settings = user_settings
        self.accounts = accounts # Needed for pension milestones
        self.resolved_milestones: Dict[str, int] = {}
        self.dynamic_milestones_hit: Set[str] = set()
        self.current_year = datetime.now().year
        self.end_age = 95 # Default

        self._resolve_static_milestones()

    def _resolve_static_milestones(self):
        # 1. Resolve Simple Date/Age/Offset milestones
        for m in self.milestones:
            m_type = m.get('type')
            if m_type == 'Custom' or m_type == 'Retirement': 
                if m.get('date'):
                    try:
                        self.resolved_milestones[m['id']] = datetime.strptime(str(m['date'])[:10], "%Y-%m-%d").year
                    except: 
                        pass
                elif m.get('year_offset') is not None:
                    self.resolved_milestones[m['id']] = self.current_year + PlanInterfaces._safe_int(m['year_offset'])
                elif m.get('details', {}).get('age') is not None:
                    target_age = PlanInterfaces._safe_int(m['details']['age'])
                    m_owner = m.get('owner', 'You')
                    target_birth_year = self.birth_year
                    if m_owner == 'Spouse':
                        target_birth_year = PlanInterfaces._safe_int(self.user_settings.get("spouse", {}).get("birthYear", self.birth_year), self.birth_year)
                    self.resolved_milestones[m['id']] = target_birth_year + target_age
                else:
                    self.resolved_milestones[m['id']] = self.current_year
            elif m_type == 'Life Expectancy':
                target_age = PlanInterfaces._safe_int(m.get('details', {}).get('age', self.end_age), self.end_age)
                m_owner = m.get('owner', 'You')
                if m_owner == 'Spouse':
                    s_birth_year = self.user_settings.get("spouse", {}).get("birthYear", self.birth_year)
                    target_birth_year = PlanInterfaces._safe_int(s_birth_year, self.birth_year)
                else:
                    target_birth_year = self.birth_year
                self.resolved_milestones[m['id']] = target_birth_year + target_age

        # 1.5. Resolve Virtual Pension Milestones
        for acc in self.accounts:
            if acc.get('type') == 'Pension':
                acc_id = acc.get('id')
                if acc_id:
                     s_age = acc.get('starting_age', 67)
                     owner = acc.get('owner', 'You')
                     target_birth_year = self.birth_year
                     if owner == 'Spouse':
                         target_birth_year = PlanInterfaces._safe_int(self.user_settings.get("spouse", {}).get("birthYear", self.birth_year), self.birth_year)
                     
                     ms_year = target_birth_year + s_age
                     virtual_id = f"pension_ms_{acc_id}"
                     self.resolved_milestones[virtual_id] = ms_year

    def get_year_from_condition(self, item, target_cond_field='start_condition', target_ref_field='start_reference', target_date_field='start_date') -> int:
        cond = item.get(target_cond_field)
        ref = item.get(target_ref_field)
        date_val = item.get(target_date_field)
        
        if cond == 'Date' and date_val:
            try:
                return datetime.strptime(str(date_val)[:10], "%Y-%m-%d").year
            except:
                return self.current_year
                
        if cond == 'Age' and ref:
            return self.birth_year + PlanInterfaces._safe_int(ref)

        if cond == 'Milestone' and ref:
            if ref in self.resolved_milestones:
                 return self.resolved_milestones[ref]
            else: 
                 # Fallback: Broken Pension Link? 
                 if str(ref).startswith('pension_ms_'):
                     p_acc = next((a for a in self.accounts if a.get('type') == 'Pension'), None)
                     if p_acc:
                         s_age = p_acc.get('starting_age', 67)
                         owner = p_acc.get('owner', 'You')
                         t_by = self.birth_year
                         if owner == 'Spouse':
                             t_by = PlanInterfaces._safe_int(self.user_settings.get("spouse", {}).get("birthYear", self.birth_year), self.birth_year)
                         return t_by + s_age

                 if target_cond_field == 'end_condition':
                     return self.current_year # Fallback end now
                 return 9999 # Future placeholder

        # Defaults
        if target_cond_field == 'end_condition':
            return self.current_year + 100
        return self.current_year

    def check_dynamic_milestones(self, year: int, liquid_net_worth: float, annual_expenses: float):
        # Check FI
        self.dynamic_milestones_hit.clear() # Reset just in case usually, but here we accumulate? 
        # Actually standard logic is we find it once.
        
        fi_milestone = next((m for m in self.milestones if m.get('type') == 'Financial Independence'), None)
        if fi_milestone:
             multiplier = PlanInterfaces._safe_float(fi_milestone.get('details', {}).get('expense_multiplier', 25.0), 25.0)
             if liquid_net_worth > (multiplier * annual_expenses):
                 m_id = fi_milestone['id']
                 if m_id not in self.resolved_milestones:
                     self.resolved_milestones[m_id] = year
                     self.dynamic_milestones_hit.add(m_id)
                     
    def get_hits_for_year(self, year: int) -> List[str]:
        return [m_id for m_id, m_year in self.resolved_milestones.items() if m_year == year]



class AccountManager:
    @staticmethod
    def load_accounts(plan_data: Dict, finance_snapshot: Any, user_settings: Dict, db: Optional[Session] = None) -> List[Dict]:
        # Helper to find plan config for a snapshot item
        items = plan_data.get('items', [])
        
        def find_item_config(name: str, category: str):
            for i in items:
                if i.get('name') == name and i.get('category') == category:
                    return i
            return None

        main_currency = user_settings.get("mainCurrency", "ILS")
        accounts = []
        
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
                val = PlanInterfaces._safe_float(f_item.get('value', 0))
                item_currency = f_item.get('currency', 'ILS')

                if cat in ['Savings', 'Investments', 'Cash', 'Checking', 'Bank', 'Liquid']:
                    config = find_item_config(name, 'Account') or {}
                    
                    # 1. Defaults from Finance Snapshot
                    f_details = f_item.get('details', {})
                    f_type = (f_item.get('type') or '').lower()
                    
                    # Infer Type
                    acc_type = 'Taxable'
                    if 'broker' in f_type: acc_type = 'Broker'
                    elif '401k' in f_type: acc_type = '401k'
                    elif 'roth' in f_type: acc_type = 'Roth'
                    elif 'ira' in f_type: acc_type = 'IRA'
                    elif 'hishtalmut' in f_type: acc_type = 'Hishtalmut'
                    elif 'espp' in f_type: acc_type = 'ESPP'
                    elif 'rsu' in f_type: acc_type = 'RSU'
                    elif 'hsa' in f_type: acc_type = 'HSA'
                    elif 'pension' in f_type: acc_type = 'Pension'
                    elif 'savings' in f_type: acc_type = 'Savings'
                    
                    snapshot_settings = {}
                    if 'draw_income' in f_details: snapshot_settings["draw_income"] = f_details.get('draw_income')
                    if 'divide_rate' in f_details: snapshot_settings["divide_rate"] = PlanInterfaces._safe_float(f_details.get('divide_rate'))
                    if 'starting_age' in f_details: snapshot_settings["starting_age"] = PlanInterfaces._safe_int(f_details.get('starting_age'))
                    if 'monthly_contribution' in f_details: snapshot_settings["monthly_contribution"] = PlanInterfaces._safe_float(f_details.get('monthly_contribution'))
                    if f_details.get('max_withdrawal_rate') is not None: snapshot_settings["max_withdrawal_rate"] = PlanInterfaces._safe_float(f_details.get('max_withdrawal_rate'))
                    if f_details.get('max_withdrawal_cap') is not None: snapshot_settings["max_withdrawal_cap"] = PlanInterfaces._safe_float(f_details.get('max_withdrawal_cap'))
                    
                    # PRIORITY MAPPING
                    if f_item.get('withdrawal_priority') or f_details.get('withdrawal_priority'):
                        snapshot_settings["withdrawal_priority"] = f_item.get('withdrawal_priority') or f_details.get('withdrawal_priority')
                    if f_item.get('inflow_priority') or f_details.get('inflow_priority'):
                        snapshot_settings["inflow_priority"] = f_item.get('inflow_priority') or f_details.get('inflow_priority')

                    # DIVIDEND DEFAULTS - Only override if explicit in snapshot
                    if 'dividend_policy' in f_details: snapshot_settings["dividend_policy"] = f_details.get('dividend_policy')
                    if 'dividend_mode' in f_details: snapshot_settings["dividend_mode"] = f_details.get('dividend_mode')
                    
                    div_amount = f_details.get('dividend_fixed_amount')
                    
                    # DASHBOARD FALLBACK: If missing from snapshot but DB available, check Dividend Dashboard
                    if div_amount is None and db is not None:
                        try:
                            from app.schema.dividend_models import DividendAccount, DividendPosition, DividendTickerData
                            from app.utils.currency import convert_currency
                            
                            # Find linked dividend account
                            stmt = select(DividendAccount).where(DividendAccount.linked_id == f_item.get('id'))
                            div_acc = db.exec(stmt).first()
                            
                            if div_acc:
                                # Fetch positions and calculate total annual income
                                d_positions = db.exec(select(DividendPosition).where(DividendPosition.account == div_acc.name)).all()
                                if d_positions:
                                    tickers = [p.ticker for p in d_positions]
                                    td_list = db.exec(select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))).all()
                                    td_map = {t.ticker: t for t in td_list}
                                    
                                    total_income = 0.0
                                    for p in d_positions:
                                        td = td_map.get(p.ticker)
                                        if td:
                                            # Dashboard positions are in their own currency, convert to account currency
                                            # Wait, usually we want it in 'currency' of 'f_item' (USD for IBKR)
                                            item_curr = f_item.get('currency', 'USD')
                                            income_local = p.shares * td.dividend_rate
                                            total_income += convert_currency(income_local, td.currency, item_curr)
                                    
                                    if total_income > 0:
                                        div_amount = total_income
                                        snapshot_settings["dividend_mode"] = "Fixed"
                                        # Log it for transparency
                                        # print(f"DEBUG: Dashboard Fallback for {div_acc.name}: {div_amount} {f_item.get('currency')}")
                        except Exception as e:
                            # Silent failure for fallback, just log it
                            pass

                    if div_amount is not None: snapshot_settings["dividend_fixed_amount"] = PlanInterfaces._safe_float(div_amount)
                    
                    if 'dividend_growth_rate' in f_details: snapshot_settings["dividend_growth_rate"] = PlanInterfaces._safe_float(f_details.get('dividend_growth_rate'))
                    if 'dividend_tax_rate' in f_details: snapshot_settings["dividend_tax_rate"] = PlanInterfaces._safe_float(f_details.get('dividend_tax_rate'))
                    if 'dividend_payout_start_condition' in f_details: snapshot_settings["dividend_payout_start_condition"] = f_details.get('dividend_payout_start_condition')
                    if 'dividend_payout_start_reference' in f_details: snapshot_settings["dividend_payout_start_reference"] = f_details.get('dividend_payout_start_reference')
                    
                    snapshot_settings["type"] = acc_type

                    # 2. Merge with Plan Config
                    # PRIORITY: For linked accounts, snapshot/sync data (values, dividends, priorities) 
                    # should take precedence over manual Plan overrides to ensure "Sync" works.
                    plan_settings = config.get('account_settings') or config.get('details', {}).get('account_settings', {})
                    merged_settings = {**plan_settings, **snapshot_settings}
                    currency = config.get('currency', item_currency)
                    
                    # PRIORITY: ENFORCE SNAPSHOT/CURRENT FINANCES SOURCE OF TRUTH
                    # User requested to ignore Plan overrides for priority if item exists in Snapshot.
                    # "let's only use the priority set in the current-finances"
                    
                    final_withdrawal_priority = PlanInterfaces._safe_int(
                        snapshot_settings.get('withdrawal_priority', 50)
                    )
                    final_inflow_priority = PlanInterfaces._safe_int(
                         snapshot_settings.get('inflow_priority', 100)
                    )
                    
                    accounts.append({
                        "id": f_item.get('id'), 
                        "owner": f_item.get('owner', 'You'),
                        "name": name,
                        "value": AccountManager._convert(val, currency, main_currency),
                        "type": merged_settings.get('type', 'Taxable'),
                        "growth": PlanInterfaces._safe_float(merged_settings.get('growth_rate', config.get('growth_rate', 5.0))),
                        "yield": PlanInterfaces._safe_float(merged_settings.get('dividend_yield', 0.0)),
                        "fees": PlanInterfaces._safe_float(merged_settings.get('fees', 0.0)),
                        "priority": final_withdrawal_priority,
                        "withdrawal_priority": final_withdrawal_priority,
                        "inflow_priority": final_inflow_priority,
                        "monthly_contribution": PlanInterfaces._safe_float(merged_settings.get('monthly_contribution', 0.0)),
                        "starting_age": PlanInterfaces._safe_int(merged_settings.get('starting_age', 67)),
                        "draw_income": bool(merged_settings.get('draw_income', False)),
                        "divide_rate": PlanInterfaces._safe_float(merged_settings.get('divide_rate', 200.0)),
                        "tax_rate": PlanInterfaces._safe_float(merged_settings.get('tax_rate', 0.0)),
                        "max_withdrawal_rate": PlanInterfaces._safe_float(merged_settings.get('max_withdrawal_rate', 0.0)) if merged_settings.get('max_withdrawal_rate') is not None else None,
                        "max_withdrawal_cap": AccountManager._convert(PlanInterfaces._safe_float(merged_settings.get('max_withdrawal_cap', 0.0)), currency, main_currency) if merged_settings.get('max_withdrawal_cap') is not None else None,
                        "savings_goal": AccountManager._convert(PlanInterfaces._safe_float(merged_settings.get('savings_goal', 0.0)), currency, main_currency) if merged_settings.get('savings_goal') is not None else None,
                        
                        "dividend_policy": merged_settings.get('dividend_policy', 'Accumulate'),
                        "dividend_mode": merged_settings.get('dividend_mode', 'Percent'),
                        "dividend_fixed_amount": AccountManager._convert(PlanInterfaces._safe_float(merged_settings.get('dividend_fixed_amount', 0.0)), currency, main_currency) if merged_settings.get('dividend_fixed_amount') is not None else None,
                        "dividend_growth_rate": PlanInterfaces._safe_float(merged_settings.get('dividend_growth_rate', 0.0)),
                        "dividend_tax_rate": PlanInterfaces._safe_float(merged_settings.get('dividend_tax_rate', 0.0)),
                        "dividend_payout_start_condition": merged_settings.get('dividend_payout_start_condition'),
                        "dividend_payout_start_reference": merged_settings.get('dividend_payout_start_reference')
                    })

        # Load "Manual" Accounts
        for p_item in items:
            if p_item.get('category') == 'Account':
                if not any(a['name'] == p_item['name'] for a in accounts):
                    details = p_item.get('details', {})
                    acc_set = p_item.get('account_settings') or details.get('account_settings', {})
                    currency = p_item.get('currency', 'ILS')
                    
                    
                    final_withdrawal_priority = PlanInterfaces._safe_int(
                        p_item.get('withdrawal_priority') or 
                        acc_set.get('withdrawal_priority', 50)
                    )
                    final_inflow_priority = PlanInterfaces._safe_int(
                        p_item.get('inflow_priority') or 
                        acc_set.get('inflow_priority', 100)
                    )

                    accounts.append({
                        "id": p_item.get('id'),
                        "owner": p_item.get('owner', 'You'),
                        "name": p_item['name'],
                        "value": AccountManager._convert(PlanInterfaces._safe_float(p_item.get('value', 0)), currency, main_currency),
                        "type": acc_set.get('type', 'Taxable'),
                        "growth": PlanInterfaces._safe_float(p_item.get('growth_rate', 5.0)),
                        "yield": PlanInterfaces._safe_float(acc_set.get('dividend_yield', 0.0)),
                        "fees": PlanInterfaces._safe_float(acc_set.get('fees', 0.0)),
                        "priority": final_withdrawal_priority,
                        "withdrawal_priority": final_withdrawal_priority,
                        "inflow_priority": final_inflow_priority,
                        "monthly_contribution": PlanInterfaces._safe_float(acc_set.get('monthly_contribution', 0.0)),
                        "starting_age": PlanInterfaces._safe_int(acc_set.get('starting_age', 67)),
                        "draw_income": bool(acc_set.get('draw_income', False)),
                        "divide_rate": PlanInterfaces._safe_float(acc_set.get('divide_rate', 200.0)),
                        "tax_rate": PlanInterfaces._safe_float(acc_set.get('tax_rate', 0.0)),
                        "max_withdrawal_rate": PlanInterfaces._safe_float(acc_set.get('max_withdrawal_rate', 0.0)) if acc_set.get('max_withdrawal_rate') is not None else None,
                        "max_withdrawal_cap": AccountManager._convert(PlanInterfaces._safe_float(acc_set.get('max_withdrawal_cap', 0.0)), currency, main_currency) if acc_set.get('max_withdrawal_cap') is not None else None,
                        "savings_goal": AccountManager._convert(PlanInterfaces._safe_float(acc_set.get('savings_goal', 0.0)), currency, main_currency) if acc_set.get('savings_goal') is not None else None,
                        
                        "dividend_policy": acc_set.get('dividend_policy', 'Accumulate'),
                        "dividend_mode": acc_set.get('dividend_mode', 'Percent'),
                        "dividend_fixed_amount": AccountManager._convert(PlanInterfaces._safe_float(acc_set.get('dividend_fixed_amount', 0.0)), currency, main_currency) if acc_set.get('dividend_fixed_amount') is not None else None,
                        "dividend_growth_rate": PlanInterfaces._safe_float(acc_set.get('dividend_growth_rate', 0.0)),
                        "dividend_tax_rate": PlanInterfaces._safe_float(acc_set.get('dividend_tax_rate', 0.0)),
                        "dividend_payout_start_condition": acc_set.get('dividend_payout_start_condition'),
                        "dividend_payout_start_reference": acc_set.get('dividend_payout_start_reference')
                    })
        return accounts

    @staticmethod
    def _convert(amount: float, from_curr: str, to_curr: str) -> float:
        if not amount: return 0.0
        rates = { 'ILS': 1.0, 'USD': 3.0, 'EUR': 3.5 }
        from_rate = rates.get(from_curr, 1.0)
        to_rate = rates.get(to_curr, 1.0)
        in_ils = amount * from_rate
        return in_ils / to_rate

    def __init__(self, accounts: List[Dict], user_settings: Dict, birth_year: int):
        self.accounts = accounts
        self.user_settings = user_settings
        self.birth_year = birth_year
        self.active_annuities = []
        self.current_year = datetime.now().year

    def process_growth_and_income(self, year: int, unallocated_cash: float, resolved_milestones: Dict[str, int]) -> tuple[float, List[Dict], List[Dict], float]:
        # Returns: (new_unallocated_cash, dividend_payouts, new_annuities, total_account_value)
        
        age = year - self.birth_year
        dividend_payouts = []
        
        for acc in self.accounts:
            # 1. Pension Conversion Check
            if acc.get('type') == 'Pension' and acc.get('draw_income') and acc['value'] > 0:
                 trigger_age = acc.get('starting_age', 67)
                 
                 effective_age = age 
                 if acc.get('owner') == 'Spouse':
                     spouse_by = PlanInterfaces._safe_int(self.user_settings.get("spouse", {}).get("birthYear", self.birth_year), self.birth_year)
                     effective_age = year - spouse_by
                     
                 if effective_age >= trigger_age:
                     div_rate = acc.get('divide_rate', 200.0)
                     if div_rate > 0:
                         annual_payout = (acc['value'] / div_rate) * 12
                         self.active_annuities.append({
                             "name": acc['name'],
                             "payout": annual_payout,
                             "tax_rate": acc.get('tax_rate', 0.0)
                         })
                         acc['value'] = 0.0
                         continue

            # 2. Monthly Contributions
            m_contrib = acc.get('monthly_contribution', 0.0)
            if m_contrib > 0:
                is_active = True
                check_age = age
                if acc.get('owner') == 'Spouse':
                     s_by = PlanInterfaces._safe_int(self.user_settings.get("spouse", {}).get("birthYear", self.birth_year), self.birth_year)
                     check_age = year - s_by

                if acc.get('type') == 'Pension' and check_age >= acc.get('starting_age', 67):
                    is_active = False
                
                if is_active:
                    ann_c = m_contrib * 12
                    acc['value'] += ann_c
                    unallocated_cash -= ann_c

            # 3. Apply Growth & Dividend Logic
            growth_rate = acc['growth']
            fees = acc['fees']
            yield_rate = acc['yield']
            
            # A. Calc Gross Dividend
            gross_dividend = 0.0
            if acc.get('dividend_mode') == 'Fixed' and acc.get('dividend_fixed_amount'):
                if 'current_fixed_dividend' not in acc:
                    acc['current_fixed_dividend'] = PlanInterfaces._safe_float(acc.get('dividend_fixed_amount', 0))
                else:
                    div_growth = acc.get('dividend_growth_rate', 0.0)
                    acc['current_fixed_dividend'] *= (1 + div_growth / 100.0)
                
                gross_dividend = acc['current_fixed_dividend']
            else:
                gross_dividend = acc['value'] * (yield_rate / 100.0)
            
            # B. Apply Tax
            div_tax_rate = acc.get('dividend_tax_rate', 0.0)
            net_dividend = gross_dividend * (1 - div_tax_rate / 100.0)
            
            # C. Apply Policy
            cap_appreciation = acc['value'] * (growth_rate / 100.0)
            fee_amount = acc['value'] * (fees / 100.0)
            
            acc['value'] += cap_appreciation - fee_amount
            
            effective_policy = acc.get('dividend_policy', 'Accumulate')
            start_cond = acc.get('dividend_payout_start_condition')
            
            if effective_policy == 'Payout' and start_cond and start_cond != 'Immediate':
                 trigger_year = self.current_year
                 ref = acc.get('dividend_payout_start_reference')
                 
                 if start_cond == 'Age':
                     trigger_year = self.birth_year + PlanInterfaces._safe_int(ref, 67)
                 elif start_cond == 'Date':
                     trigger_year = PlanInterfaces._safe_int(ref, self.current_year)
                 elif start_cond == 'Milestone':
                     ref_str = str(ref)
                     if ref_str in resolved_milestones:
                         trigger_year = resolved_milestones[ref_str]
                     else:
                         trigger_year = 9999
                 
                 if year < trigger_year:
                     effective_policy = 'Accumulate'

            if effective_policy == 'Payout':
                if acc['value'] > 0:
                    dividend_payouts.append({
                        "name": f"Dividend: {acc['name']}",
                        "type": "Dividend Income",
                        "value": net_dividend,
                        "gross": gross_dividend,
                        "tax": gross_dividend - net_dividend
                    })
            else:
                acc['value'] += net_dividend
        
        # Unallocated Cash Inflation
        unallocated_cash *= 1.02 
        
        return unallocated_cash, dividend_payouts, self.active_annuities

    def process_savings(self, net_flow: float, unallocated_cash: float) -> tuple[float, float, List[Dict]]:
        # Returns: (remaining_net_flow, new_unallocated_cash, savings_breakdown)
        savings_breakdown = []
        if net_flow <= 0:
            return net_flow, unallocated_cash, savings_breakdown

        sorted_inflow_accs = sorted(self.accounts, key=lambda x: x.get('inflow_priority', 100))
        remaining_flow = net_flow
        
        for acc in sorted_inflow_accs:
            if remaining_flow <= 0: break
            
            if acc.get('type') == 'Pension' and acc.get('draw_income'):
                 continue
                 
            amount = remaining_flow
            
            if acc.get('savings_goal') is not None and acc.get('savings_goal', 0) > 0:
                potential_val = acc['value']
                goal_limit = acc['savings_goal']
                
                if potential_val >= goal_limit:
                    continue
                    
                space_left = goal_limit - potential_val
                amount = min(amount, space_left)
                
            if amount > 0:
                acc['value'] += amount
                remaining_flow -= amount
                
                savings_breakdown.append({
                    "name": acc['name'], 
                    "value": round(amount, 2), 
                    "type": "Investment" if 'savings' not in acc['name'].lower() else "Cash"
                })
        
        if remaining_flow > 0:
            unallocated_cash += remaining_flow
            savings_breakdown.append({
                "name": "Unallocated Cash",
                "value": round(remaining_flow, 2),
                "type": "Cash"
            })
            
        return 0.0, unallocated_cash, savings_breakdown

    def process_deficit(self, deficit: float, unallocated_cash: float) -> tuple[float, float, float, List[Dict]]:
        # Returns: (remaining_deficit, new_unallocated_cash, withdrawals_from_savings, withdrawal_details)
        
        withdrawals_total = deficit
        withdrawal_details_list = []
        
        if unallocated_cash >= deficit:
            withdrawal_details_list.append({
                "name": "Withdrawal: Unallocated Cash",
                "type": "Portfolio Withdrawal",
                "value": round(deficit, 2)
            })
            unallocated_cash -= deficit
            deficit = 0
            return deficit, unallocated_cash, withdrawals_total, withdrawal_details_list
        else:
            if unallocated_cash > 0:
                 withdrawal_details_list.append({
                    "name": "Withdrawal: Unallocated Cash",
                    "type": "Portfolio Withdrawal",
                    "value": round(unallocated_cash, 2)
                })
                 deficit -= unallocated_cash
                 unallocated_cash = 0
            
            # Drain Accounts
            sorted_accs = sorted(self.accounts, key=lambda x: x.get('withdrawal_priority', 50))
            
            rsu_withdrawn_this_year = 0.0
            rsu_limit_global = 200000.0
            
            for acc in sorted_accs:
                if deficit <= 0: break
                
                current_val = acc['value']
                if current_val <= 0: continue
                
                allowed_amount = current_val
                
                if acc.get('max_withdrawal_cap') is not None:
                     allowed_amount = min(allowed_amount, acc['max_withdrawal_cap'])
                     
                if acc.get('max_withdrawal_rate') is not None:
                     rate_limit = current_val * (acc['max_withdrawal_rate'] / 100.0)
                     allowed_amount = min(allowed_amount, rate_limit)
                     
                acc_type = (acc.get('type') or '').strip()
                if acc_type == 'RSU':
                     rsu_remaining = max(0.0, rsu_limit_global - rsu_withdrawn_this_year)
                     allowed_amount = min(allowed_amount, rsu_remaining)
                
                withdraw_amt = min(deficit, allowed_amount)
                
                if withdraw_amt > 0:
                     acc['value'] -= withdraw_amt
                     deficit -= withdraw_amt
                     
                     if acc_type == 'RSU':
                         rsu_withdrawn_this_year += withdraw_amt
                     
                     withdrawal_details_list.append({
                         "name": f"Withdrawal: {acc['name']}",
                         "type": "Portfolio Withdrawal",
                         "value": round(withdraw_amt, 2)
                     })
            
            # If still deficit, Debt (negative cash in simplified model, though caller tracks it)
            if deficit > 0:
                unallocated_cash -= deficit
                
            return deficit, unallocated_cash, withdrawals_total, withdrawal_details_list

    def get_liquid_accounts_value(self) -> float:
        val = 0.0
        for a in self.accounts:
            a_type = (a.get('type') or '').lower()
            a_name = (a.get('name') or '').lower()
            if 'pension' in a_type or 'pension' in a_name:
                continue
            val += a['value']
        return val




class RealAssetManager:
    @staticmethod
    def load_real_assets(plan_data: Dict, finance_snapshot: Any, user_settings: Dict) -> tuple[List[Dict], float]:
        # Returns (real_assets, unallocated_cash_adjustment)
        items = plan_data.get('items', [])
        
        def find_item_config(name: str, category: str):
            for i in items:
                if i.get('name') == name and i.get('category') == category:
                    return i
            return None

        main_currency = user_settings.get("mainCurrency", "ILS")
        real_assets = []
        unallocated_cash_diff = 0.0
        
        snapshot_data = None
        if finance_snapshot:
             snapshot_data = finance_snapshot.get('data') if isinstance(finance_snapshot, dict) else finance_snapshot.data
             
        if snapshot_data:
            snapshot_items = snapshot_data.get('items', [])
            for f_item in snapshot_items:
                cat = f_item.get('category')
                name = f_item.get('name')
                val = PlanInterfaces._safe_float(f_item.get('value', 0))
                item_currency = f_item.get('currency', 'ILS')
                
                if cat in ['Real Estate', 'Vehicle']:
                    config = find_item_config(name, 'Asset') or {}
                    currency = config.get('currency', item_currency)
                    
                    real_assets.append({
                        "name": name,
                        "value": AccountManager._convert(val, currency, main_currency),
                        "growth": PlanInterfaces._safe_float(config.get('growth_rate', 0.0)),
                        "depreciation": PlanInterfaces._safe_float(config.get('depreciation_rate', 0.0)),
                        "loan_balance": 0.0 
                    })
                elif cat in ['Debt', 'Liability']:
                     unallocated_cash_diff -= AccountManager._convert(val, item_currency, main_currency)
    
        return real_assets, unallocated_cash_diff

    def __init__(self, assets: List[Dict]):
        self.real_assets = assets

    def process_growth(self):
        for asset in self.real_assets:
            rate = (asset.get('growth', 0) - asset.get('depreciation', 0)) / 100.0
            asset['value'] *= (1 + rate)

    def add_asset(self, item: Dict, base_val_raw: float, cost: float):
        self.real_assets.append({
            "name": item.get('name'),
            "value": cost,
            "growth": PlanInterfaces._safe_float(item.get('growth_rate', 0)),
            "depreciation": PlanInterfaces._safe_float(item.get('depreciation_rate', 0)),
            "loan_balance": 0.0 # TODO
        })

    def get_liquid_assets_value(self, plan_items: List[Dict]) -> tuple[float, float]:
        # returns (liquid_value, debt)
        liq_val = 0.0
        liq_debt = 0.0
        
        for ra in self.real_assets:
             ra_item = next((i for i in plan_items if i.get('name') == ra['name'] and i.get('category') == 'Asset'), None)
             if ra_item:
                 sub = (ra_item.get('sub_category') or '').lower()
                 name_lower = (ra.get('name') or '').lower()
                 
                 is_illiquid = sub == 'house' or 'house' in name_lower or 'home' in name_lower
                 if not is_illiquid:
                    liq_val += ra['value']
                    liq_debt += ra.get('loan_balance', 0.0)
        return liq_val, liq_debt
