export interface RSUGrant {
  id: string;
  year: number; // e.g. 2023
  shares: number;
  vested: number;
  price: number;
}

export interface PlanItem {
  id: string;
  name: string;
  category: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Account';
  sub_category?: string;
  owner: string;
  currency?: string; // "USD", "ILS", "EUR"
  value: number;
  growth_rate: number; // Used for generic growth or Account Growth

  // Advanced Financials
  tax_rate?: number; // For Income

  // Priorities
  inflow_priority?: number;
  withdrawal_priority?: number;

  // Account Specifics
  account_settings?: {
    type: 'Taxable' | '401k' | 'Roth' | 'HSA' | 'Savings' | 'Broker' | 'ESPP' | 'RSU' | 'Hishtalmut' | 'IRA' | 'Pension';
    bond_allocation: number; // %
    dividend_yield: number; // %
    fees: number; // %
    withdrawal_priority?: number; // 1 = First, 2 = Second...

    // Dividend Policy
    dividend_policy?: 'Accumulate' | 'Payout'; // Default to Accumulate (Reinvest)
    dividend_mode?: 'Percent' | 'Fixed';
    dividend_fixed_amount?: number;
    dividend_growth_rate?: number;
    dividend_tax_rate?: number;
    dividend_payout_start_condition?: 'Immediate' | 'Age' | 'Milestone' | 'Date';
    dividend_payout_start_reference?: string | number;

    // Pension Specifics
    managing_body?: string;
    is_pension?: boolean; // Type tag
    draw_income?: boolean; // If true, converts to income at starting_age
    divide_rate?: number; // e.g. 200
    starting_age?: number; // e.g. 67
    monthly_contribution?: number; // e.g. 2000
    tax_rate?: number; // % e.g. 15

    // Savings Specifics
    savings_goal?: number;
    max_drawdown?: number; // %

    // RSU Specifics
    stock_symbol?: string;
    current_price?: number;
    rsu_grants?: RSUGrant[];
  };

  // Real Asset Specifics
  asset_settings?: {
    maintenance_cost?: number; // % of Value
    improvement_cost?: number; // % of Value
    insurance_cost?: number; // % of Value
    hoa_fees?: number; // Fixed Monthly Amount
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
  isLinked?: boolean;
  hasPlan?: boolean;
}

export interface PlanMilestone {
  id: string;
  name: string;
  date?: string;
  year_offset?: number;
  type: string;
  details?: Record<string, any>;
  icon?: string;
  color?: string;
  owner?: string;
  isLinked?: boolean;
  isVirtual?: boolean;
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
