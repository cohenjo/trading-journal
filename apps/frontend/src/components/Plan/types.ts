export interface PlanItem {
  id: string;
  name: string;
  category: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Account';
  sub_category?: string;
  owner: string;
  value: number;
  growth_rate: number; // Used for generic growth or Account Growth
  
  // Advanced Financials
  tax_rate?: number; // For Income

  // Account Specifics
  account_settings?: {
      type: 'Taxable' | '401k' | 'Roth' | 'HSA' | 'Savings';
      bond_allocation: number; // %
      dividend_yield: number; // %
      fees: number; // %
      withdrawal_priority?: number; // 1 = First, 2 = Second...
  };

  // Asset Specifics
  depreciation_rate?: number; // % change per year (negative for depreciation)
  financing?: {
    down_payment: number;
    interest_rate: number;
    term_months: number;
    monthly_payment?: number; // Optional override
  };
  recurrence?: {
    rule: 'Replace' | 'None';
    period_years: number;
  };
  sale?: {
    rule: 'Never' | 'Date' | 'Age';
    date?: string;
    age?: number; // Asset age (e.g., sell when car is 7 years old) or Owner age? Context implies "buy new car every 7 years" -> Asset Age.
  };

  // Time Range
  start_date?: string; // ISO Date String
  end_date?: string;
  
  // New Time Range References
  start_condition?: 'Date' | 'Now' | 'Milestone' | 'Age'; 
  start_reference?: string; // Milestone ID or Age Value
  
  end_condition?: 'Date' | 'Forever' | 'Milestone' | 'Age';
  end_reference?: string;

  frequency: 'Monthly' | 'Yearly' | 'OneTime';
  details?: Record<string, any>;
}

export interface PlanMilestone {
  id: string;
  name: string;
  date?: string;
  year_offset?: number;
  type: string;
}

export interface PlanData {
  items: PlanItem[];
  milestones: PlanMilestone[];
  settings: Record<string, any>;
}

export interface Plan {
    id?: number;
    name: string;
    description?: string;
    data: PlanData;
    created_at?: string;
    updated_at?: string;
}
