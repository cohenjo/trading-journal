export type MoneyString = string;
export type OptionsStrategyKind = 'csp' | 'vertical_spread' | 'roll_chain' | 'ungrouped';
export type OptionsStrategyStatus = 'open' | 'closed' | 'expired' | 'assigned' | 'mixed';
export type OptionsRollClassification = 'positive' | 'negative' | 'neutral';

export interface MonthlyMetric {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  cashFlow: MoneyString;
  realizedPnl: MoneyString;
  cumulativeCashFlow: MoneyString;
  cumulativeRealizedPnl: MoneyString;
  varianceGap: MoneyString;
  cumulativeVarianceGap: MoneyString;
  tradeCount: number;
  rollCount: number;
  rollPositiveCount: number;
  rollNegativeCount: number;
  rollNeutralCount: number;
  rollEfficiencyPct: MoneyString | null;
  lastComputedAt: string;
}

export interface OptionsTradeSummary {
  id: string;
  accountId: string;
  strategyGroupId: string | null;
  eventType: string;
  side: string;
  tradeTime: string;
  tradeDate: string;
  quantity: MoneyString;
  price: MoneyString;
  grossAmount: MoneyString;
  commission: MoneyString;
  fees: MoneyString;
  netCashFlow: MoneyString;
  realizedPnl: MoneyString;
  currency: string;
  underlyingSymbol?: string;
  expiry?: string;
  strike?: MoneyString;
  right?: 'call' | 'put';
}

export interface RollEvent {
  id: string;
  accountId: string;
  strategyGroupId: string;
  detectedAt: string;
  detectionStatus: string;
  classification: OptionsRollClassification;
  closedLegRealizedPnl: MoneyString;
  incrementalCashFlow: MoneyString;
  oldExpiry: string | null;
  newExpiry: string | null;
  oldStrike: MoneyString | null;
  newStrike: MoneyString | null;
  heuristicVersion: string;
  closedTrade: OptionsTradeSummary | null;
  openedTrade: OptionsTradeSummary | null;
}

export interface StrategyGroup {
  id: string;
  accountId: string;
  underlyingSymbol: string;
  kind: OptionsStrategyKind;
  status: OptionsStrategyStatus;
  openedAt: string;
  closedAt: string | null;
  netCashFlow: MoneyString;
  realizedPnl: MoneyString;
  capitalAtRisk: MoneyString | null;
  notes: string | null;
  trades: OptionsTradeSummary[];
  rollEvents: RollEvent[];
}

export interface OptionsFreshness {
  asOf: string | null;
  source: string | null;
  status: string | null;
}

export interface OptionsEnabledAccount {
  id: string;
  label: string;
  accountId: string;
  accountType: string;
}

export interface RollEfficiencyCounts {
  positive: number;
  negative: number;
  neutral: number;
}
