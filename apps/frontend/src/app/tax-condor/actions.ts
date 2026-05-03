"use server";

import Decimal from "decimal.js";
import type {
  GreekVector,
  IronCondorStructure,
  LeapRecommendation,
  OptionLeg,
  PnLSimulation,
  TaxCondorRecommendation,
} from "@/components/TaxCondor/types";

export interface TaxCondorRecommendationRequest {
  symbol: string;
  budget?: number;
  use_live_data?: boolean;
}

interface MarketDataProvider {
  getSpotPrice(symbol: string): Promise<number>;
  getVolatility(symbol: string, days?: number): Promise<number>;
  getExpirations(symbol: string): Promise<Date[]>;
  getOptionChain(symbol: string, expiration: Date, limit?: number): Promise<OptionLeg[]>;
}

const RISK_FREE_RATE = 0.05;
const PORTFOLIO_RISK_FREE_RATE = 0.045;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysBetween(later: Date, earlier: Date): number {
  const laterMidnight = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime();
  const earlierMidnight = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime();
  return Math.round((laterMidnight - earlierMidnight) / MS_PER_DAY);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  if (value === 0) return 0.5;
  if (value <= -8) return 0;
  if (value >= 8) return 1;

  const sign = value < 0 ? -1 : 1;
  const upper = Math.abs(value);
  const intervals = 128;
  const width = upper / intervals;
  let sum = normalPdf(0) + normalPdf(upper);

  for (let index = 1; index < intervals; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4) * normalPdf(index * width);
  }

  const integral = (width / 3) * sum;
  return 0.5 + sign * integral;
}

function blackScholesPrice(
  spot: number,
  strike: number,
  yearsToExpiration: number,
  riskFreeRate: number,
  volatility: number,
  isCall: boolean,
): number {
  if (yearsToExpiration <= 0) {
    return isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }

  const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility ** 2) * yearsToExpiration) / (volatility * Math.sqrt(yearsToExpiration));
  const d2 = d1 - volatility * Math.sqrt(yearsToExpiration);

  if (isCall) {
    return new Decimal(spot)
      .mul(normalCdf(d1))
      .minus(new Decimal(strike).mul(Math.exp(-riskFreeRate * yearsToExpiration)).mul(normalCdf(d2)))
      .toNumber();
  }

  return new Decimal(strike)
    .mul(Math.exp(-riskFreeRate * yearsToExpiration))
    .mul(normalCdf(-d2))
    .minus(new Decimal(spot).mul(normalCdf(-d1)))
    .toNumber();
}

function blackScholesGreeks(
  spot: number,
  strike: number,
  yearsToExpiration: number,
  riskFreeRate: number,
  volatility: number,
  isCall: boolean,
): GreekVector {
  if (yearsToExpiration <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  }

  const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility ** 2) * yearsToExpiration) / (volatility * Math.sqrt(yearsToExpiration));
  const d2 = d1 - volatility * Math.sqrt(yearsToExpiration);
  const delta = isCall ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = normalPdf(d1) / (spot * volatility * Math.sqrt(yearsToExpiration));
  const annualTheta = -(spot * normalPdf(d1) * volatility) / (2 * Math.sqrt(yearsToExpiration)) - riskFreeRate * strike * Math.exp(-riskFreeRate * yearsToExpiration) * normalCdf(isCall ? d2 : -d2);
  const vega = spot * normalPdf(d1) * Math.sqrt(yearsToExpiration);

  return {
    delta,
    gamma,
    theta: annualTheta / 365,
    vega: vega / 100,
  };
}

class MockDataProvider implements MarketDataProvider {
  private readonly spot: number;
  private readonly volatility: number;

  constructor(spot = 450, volatility = 0.2) {
    this.spot = spot;
    this.volatility = volatility;
  }

  async getSpotPrice(symbol: string): Promise<number> {
    const normalizedSymbol = symbol.toUpperCase();
    if (normalizedSymbol === "SPY") return 500;
    if (normalizedSymbol === "QQQ") return 440;
    if (normalizedSymbol === "IWM") return 200;
    if (normalizedSymbol === "NDX") return 17500;
    if (normalizedSymbol === "SPX") return 5100;
    return this.spot;
  }

  async getVolatility(_symbol: string, _days = 30): Promise<number> {
    return this.volatility;
  }

  async getExpirations(_symbol: string): Promise<Date[]> {
    const referenceDate = today();
    return [addDays(referenceDate, 30), addDays(referenceDate, 45), addDays(referenceDate, 365), addDays(referenceDate, 400)];
  }

  async getOptionChain(symbol: string, expiration: Date, _limit = 100): Promise<OptionLeg[]> {
    const spot = await this.getSpotPrice(symbol);
    const yearsToExpiration = daysBetween(expiration, today()) / 365;
    const start = Math.trunc(spot * 0.8);
    const stop = Math.trunc(spot * 1.2);
    const step = Math.trunc(spot * 0.01) || 5;
    const chain: OptionLeg[] = [];

    for (let strike = start; strike < stop; strike += step) {
      const callPrice = blackScholesPrice(spot, strike, yearsToExpiration, RISK_FREE_RATE, this.volatility, true);
      const callGreeks = blackScholesGreeks(spot, strike, yearsToExpiration, RISK_FREE_RATE, this.volatility, true);
      chain.push(createOptionLeg(symbol, strike, expiration, "call", callGreeks, callPrice, this.volatility));

      const putPrice = blackScholesPrice(spot, strike, yearsToExpiration, RISK_FREE_RATE, this.volatility, false);
      const putGreeks = blackScholesGreeks(spot, strike, yearsToExpiration, RISK_FREE_RATE, this.volatility, false);
      chain.push(createOptionLeg(symbol, strike, expiration, "put", putGreeks, putPrice, this.volatility));
    }

    return chain;
  }
}

function createOptionLeg(
  symbol: string,
  strike: number,
  expiration: Date,
  optionType: "call" | "put",
  greeks: GreekVector,
  price: number,
  impliedVolatility: number,
): OptionLeg {
  return {
    symbol,
    strike: Number(strike),
    expiration: formatDate(expiration),
    option_type: optionType,
    action: "buy",
    quantity: 0,
    greeks,
    price,
    bid: null,
    ask: null,
    mid: null,
    implied_volatility: impliedVolatility,
    conid: null,
  };
}

function cloneLegWithPosition(leg: OptionLeg, action: "buy" | "sell", quantity: number): OptionLeg {
  return {
    ...leg,
    action,
    quantity,
    greeks: { ...leg.greeks },
  };
}

function parseExpiration(expiration: string): Date {
  const [year, month, day] = expiration.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function createIronCondor(
  shortCall: OptionLeg,
  longCall: OptionLeg,
  shortPut: OptionLeg,
  longPut: OptionLeg,
  spotPrice: number | null,
  referenceDate: Date,
): IronCondorStructure {
  const legs = [shortCall, longCall, shortPut, longPut];
  const netDelta = legs.reduce((sum, leg) => sum + leg.greeks.delta * leg.quantity, 0);
  const netGamma = legs.reduce((sum, leg) => sum + leg.greeks.gamma * leg.quantity, 0);
  const netTheta = legs.reduce((sum, leg) => sum + leg.greeks.theta * leg.quantity, 0);
  const netVega = legs.reduce((sum, leg) => sum + leg.greeks.vega * leg.quantity, 0);

  // Legacy FastAPI response shape reports option credit per share, while
  // margin_requirement remains per contract. Preserve that unit convention for
  // parity with existing tax-condor screens and backend tests.
  const credit = new Decimal(shortCall.price)
    .mul(Math.abs(shortCall.quantity))
    .plus(new Decimal(shortPut.price).mul(Math.abs(shortPut.quantity)))
    .minus(new Decimal(longCall.price).mul(Math.abs(longCall.quantity)))
    .minus(new Decimal(longPut.price).mul(Math.abs(longPut.quantity)));
  const callWidth = new Decimal(longCall.strike).minus(shortCall.strike).abs();
  const putWidth = new Decimal(shortPut.strike).minus(longPut.strike).abs();
  const margin = Decimal.max(callWidth, putWidth).mul(100);
  const dte = daysBetween(parseExpiration(shortCall.expiration), referenceDate);
  const pnlSimulations: PnLSimulation[] = [];
  const chartData: PnLSimulation[] = [];

  if (spotPrice) {
    for (const pctChange of [-0.05, -0.02, 0, 0.02, 0.05]) {
      pnlSimulations.push(calculateStructurePnlPoint(legs, spotPrice, pctChange));
    }

    const startPct = -0.1;
    const endPct = 0.1;
    const steps = 50;
    const stepSize = (endPct - startPct) / steps;
    for (let index = 0; index <= steps; index += 1) {
      chartData.push(calculateStructurePnlPoint(legs, spotPrice, startPct + index * stepSize));
    }
  }

  return {
    short_call: shortCall,
    long_call: longCall,
    short_put: shortPut,
    long_put: longPut,
    net_credit: credit.toNumber(),
    margin_requirement: margin.toNumber(),
    greeks: {
      delta: netDelta,
      gamma: netGamma,
      theta: netTheta,
      vega: netVega,
    },
    days_to_expiration: dte,
    pnl_simulations: pnlSimulations,
    chart_data: chartData,
  };
}

function calculateStructurePnlPoint(legs: OptionLeg[], spotPrice: number, pctChange: number): PnLSimulation {
  const newSpot = new Decimal(spotPrice).mul(new Decimal(1).plus(pctChange));
  const estimatedPnl = legs.reduce((total, leg) => {
    if (leg.implied_volatility == null) return total;
    const newPrice = blackScholesPrice(newSpot.toNumber(), leg.strike, 0, PORTFOLIO_RISK_FREE_RATE, leg.implied_volatility, leg.option_type === "call");
    return total.plus(new Decimal(newPrice).minus(leg.price).mul(leg.quantity).mul(100));
  }, new Decimal(0));

  return {
    price_change_pct: new Decimal(pctChange).mul(100).toNumber(),
    underlying_price: newSpot.toNumber(),
    estimated_pnl: estimatedPnl.toNumber(),
  };
}

async function selectBestLeap(provider: MarketDataProvider, symbol: string, targetDelta = 0.7, minDays = 365, referenceDate = today()): Promise<OptionLeg | null> {
  const expirations = await provider.getExpirations(symbol);
  const validExpirations = expirations.filter((expiration) => daysBetween(expiration, referenceDate) >= minDays);
  if (validExpirations.length === 0) return null;

  const chain = await provider.getOptionChain(symbol, validExpirations[0]);
  const calls = chain.filter((option) => option.option_type === "call");
  if (calls.length === 0) return null;

  const bestLeap = calls.reduce((best, current) => (
    Math.abs(current.greeks.delta - targetDelta) < Math.abs(best.greeks.delta - targetDelta) ? current : best
  ));
  return cloneLegWithPosition(bestLeap, "buy", 1);
}

async function generateIronCondorCandidates(provider: MarketDataProvider, symbol: string, targetDays = 40, referenceDate = today()): Promise<IronCondorStructure[]> {
  const spot = await provider.getSpotPrice(symbol);
  const expirations = await provider.getExpirations(symbol);
  if (expirations.length === 0) return [];

  const targetExpiration = expirations.reduce((best, current) => (
    Math.abs(daysBetween(current, referenceDate) - targetDays) < Math.abs(daysBetween(best, referenceDate) - targetDays) ? current : best
  ));
  const chain = await provider.getOptionChain(symbol, targetExpiration, 200);
  const calls = new Map<number, OptionLeg>();
  const puts = new Map<number, OptionLeg>();

  for (const option of chain) {
    if (option.option_type === "call") calls.set(option.strike, option);
    if (option.option_type === "put") puts.set(option.strike, option);
  }

  const sortedStrikes = [...calls.keys()].sort((left, right) => left - right);
  let step = 5;
  if (sortedStrikes.length > 1) {
    const validDiffs: number[] = [];
    for (let index = 0; index < sortedStrikes.length - 1; index += 1) {
      const diff = sortedStrikes[index + 1] - sortedStrikes[index];
      if (diff >= 1) validDiffs.push(diff);
    }
    step = validDiffs.length > 0 ? Math.min(...validDiffs) : 5;
  }

  const atmStrike = Math.round(spot / step) * step;
  const shortOffsetsSteps = [1, 2, 4, 8, 12, 16];
  const widthSteps = [1, 2, 4];
  const candidates: IronCondorStructure[] = [];

  for (const shortCallOffset of shortOffsetsSteps) {
    for (const shortPutOffset of shortOffsetsSteps) {
      const shortCallStrike = atmStrike + shortCallOffset * step;
      const shortPutStrike = atmStrike - shortPutOffset * step;
      const baseShortCall = calls.get(shortCallStrike);
      const baseShortPut = puts.get(shortPutStrike);
      if (!baseShortCall || !baseShortPut) continue;

      for (const callWidth of widthSteps) {
        const baseLongCall = calls.get(shortCallStrike + callWidth * step);
        if (!baseLongCall) continue;

        for (const putWidth of widthSteps) {
          const baseLongPut = puts.get(shortPutStrike - putWidth * step);
          if (!baseLongPut) continue;

          candidates.push(createIronCondor(
            cloneLegWithPosition(baseShortCall, "sell", -1),
            cloneLegWithPosition(baseLongCall, "buy", 1),
            cloneLegWithPosition(baseShortPut, "sell", -1),
            cloneLegWithPosition(baseLongPut, "buy", 1),
            spot,
            referenceDate,
          ));
        }
      }
    }
  }

  return candidates;
}

function calculatePortfolioPnl(
  leap: LeapRecommendation,
  ironCondor: IronCondorStructure,
  spotPrice: number | null,
  referenceDate: Date,
): { portfolioSims: PnLSimulation[]; portfolioChartData: PnLSimulation[] } {
  const portfolioSims: PnLSimulation[] = [];
  const portfolioChartData: PnLSimulation[] = [];
  if (!spotPrice) return { portfolioSims, portfolioChartData };

  const daysElapsed = ironCondor.days_to_expiration ?? 0;
  const leapDteAtSimulation = daysBetween(parseExpiration(leap.leg.expiration), referenceDate) - daysElapsed;
  const leapYearsAtSimulation = Math.max(0, leapDteAtSimulation / 365);
  const isCall = leap.leg.option_type === "call";
  const volatility = leap.leg.implied_volatility ?? 0.2;

  const combineSimulation = (sim: PnLSimulation): PnLSimulation => {
    const pctChange = new Decimal(sim.price_change_pct).div(100);
    const newSpot = new Decimal(spotPrice).mul(new Decimal(1).plus(pctChange));
    const newLeapPrice = blackScholesPrice(newSpot.toNumber(), leap.leg.strike, leapYearsAtSimulation, PORTFOLIO_RISK_FREE_RATE, volatility, isCall);
    const leapPnl = new Decimal(newLeapPrice).minus(leap.leg.price).mul(leap.leg.quantity).mul(100);
    return {
      price_change_pct: sim.price_change_pct,
      underlying_price: newSpot.toNumber(),
      estimated_pnl: new Decimal(sim.estimated_pnl).plus(leapPnl).toNumber(),
    };
  };

  for (const sim of ironCondor.pnl_simulations ?? []) {
    portfolioSims.push(combineSimulation(sim));
  }
  for (const sim of ironCondor.chart_data ?? []) {
    portfolioChartData.push(combineSimulation(sim));
  }

  return { portfolioSims, portfolioChartData };
}

function rankAndValidate(
  leap: LeapRecommendation,
  ironCondors: IronCondorStructure[],
  budget: number,
  spotPrice: number | null,
  referenceDate = today(),
): TaxCondorRecommendation[] {
  const validRecommendations: TaxCondorRecommendation[] = [];
  const leapTheta = leap.leg.greeks.theta;

  for (const ironCondor of ironCondors) {
    const thetaCoverage = leapTheta !== 0 ? ironCondor.greeks.theta / Math.abs(leapTheta) : 0;
    if (thetaCoverage < 0) continue;

    const maxLoss = new Decimal(ironCondor.margin_requirement).div(100).minus(ironCondor.net_credit);
    if (maxLoss.gt(budget)) continue;

    const portfolioDelta = leap.leg.greeks.delta + ironCondor.greeks.delta;
    const deltaPenalty = Math.abs(portfolioDelta) * 50;
    const score = new Decimal(thetaCoverage).mul(10).plus(ironCondor.net_credit).minus(deltaPenalty).toNumber();
    const { portfolioSims, portfolioChartData } = calculatePortfolioPnl(leap, ironCondor, spotPrice, referenceDate);

    validRecommendations.push({
      leap,
      iron_condor: ironCondor,
      score,
      analysis: {
        theta_coverage: thetaCoverage,
        max_loss: maxLoss.toNumber(),
        net_credit: ironCondor.net_credit,
        portfolio_delta: portfolioDelta,
      },
      portfolio_pnl_simulations: portfolioSims,
      portfolio_chart_data: portfolioChartData,
    });
  }

  return validRecommendations.sort((left, right) => right.score - left.score);
}

async function buildTaxCondorRecommendations(symbol: string, budget: number, provider: MarketDataProvider): Promise<TaxCondorRecommendation[]> {
  const spot = await provider.getSpotPrice(symbol);
  const volatility = await provider.getVolatility(symbol);
  const referenceDate = today();
  const leapLeg = await selectBestLeap(provider, symbol, 0.7, 365, referenceDate);
  if (!leapLeg) return [];

  const leap: LeapRecommendation = { leg: leapLeg, reason: "Best fit for delta 0.70" };
  const ironCondors = await generateIronCondorCandidates(provider, symbol, 40, referenceDate);
  return rankAndValidate(leap, ironCondors, budget, spot, referenceDate)
    .slice(0, 10)
    .map((recommendation) => ({
      ...recommendation,
      underlying_price: spot,
      underlying_iv: volatility,
    }));
}

/**
 * Generates iron-condor tax-loss harvesting recommendations without calling FastAPI.
 * Live IBKR refresh remains a backend-worker concern under TJ-020, so this action
 * currently runs the deterministic recommendation math against the mock data set.
 */
export async function getTaxCondorRecommendations(request: TaxCondorRecommendationRequest): Promise<TaxCondorRecommendation[]> {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbol is required");
  const budget = assertFiniteNumber(request.budget ?? 1000, "Budget");
  if (budget < 0) throw new Error("Budget must be non-negative");

  if (request.use_live_data) {
    throw new Error("Live IBKR tax-condor data is not available from the frontend. Refresh broker data through the TJ-020 worker flow, then run recommendations again.");
  }

  return buildTaxCondorRecommendations(symbol, budget, new MockDataProvider());
}
