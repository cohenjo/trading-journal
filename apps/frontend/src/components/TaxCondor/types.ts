export interface GreekVector {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionLeg {
  symbol: string;
  strike: number;
  expiration: string;
  option_type: string;
  action: string;
  quantity: number;
  greeks: GreekVector;
  price: number;
  bid?: number;
  ask?: number;
  mid?: number;
  implied_volatility?: number;
}

export interface PnLSimulation {
  price_change_pct: number;
  underlying_price?: number;
  estimated_pnl: number;
}

export interface IronCondorStructure {
  short_call: OptionLeg;
  long_call: OptionLeg;
  short_put: OptionLeg;
  long_put: OptionLeg;
  net_credit: number;
  margin_requirement: number;
  greeks: GreekVector;
  days_to_expiration?: number;
  pnl_simulations?: PnLSimulation[];
  chart_data?: PnLSimulation[];
}

export interface LeapRecommendation {
  leg: OptionLeg;
  reason: string;
}

export interface TaxCondorRecommendation {
  leap: LeapRecommendation;
  iron_condor: IronCondorStructure;
  score: number;
  analysis: {
    theta_coverage: number;
    max_loss: number;
    net_credit: number;
    portfolio_delta?: number;
  };
  portfolio_pnl_simulations?: PnLSimulation[];
  portfolio_chart_data?: PnLSimulation[];
  underlying_price?: number;
  underlying_iv?: number;
}
