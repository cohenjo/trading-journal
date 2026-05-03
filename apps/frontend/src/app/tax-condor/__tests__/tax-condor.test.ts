import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTaxCondorRecommendations } from "../actions";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTaxCondorRecommendations", () => {
  it("matches the backend mock-provider top NDX recommendation", async () => {
    const recommendations = await getTaxCondorRecommendations({ symbol: "NDX", budget: 2000 });

    expect(recommendations).toHaveLength(10);
    const top = recommendations[0];
    expect(top.underlying_price).toBe(17500);
    expect(top.underlying_iv).toBe(0.2);
    expect(top.leap.leg.expiration).toBe("2027-05-03");
    expect(top.leap.leg.strike).toBe(16975);
    expect(top.leap.leg.price).toBeCloseTo(2123.106755880626, 4);
    expect(top.iron_condor.short_call.strike).toBe(17675);
    expect(top.iron_condor.long_call.strike).toBe(18375);
    expect(top.iron_condor.short_put.strike).toBe(17325);
    expect(top.iron_condor.long_put.strike).toBe(16625);
    expect(top.iron_condor.net_credit).toBeCloseTo(468.7879966379569, 4);
    expect(top.iron_condor.margin_requirement).toBe(70000);
    expect(top.iron_condor.greeks.theta).toBeCloseTo(3.265773080748045, 4);
    expect(top.analysis.max_loss).toBeCloseTo(231.2120033620431, 4);
    expect(top.analysis.theta_coverage).toBeCloseTo(1.0690771807685937, 4);
    expect(top.analysis.portfolio_delta).toBeCloseTo(0.6818438529664916, 4);
    expect(top.score).toBeCloseTo(445.3865757973183, 4);
    expect(top.portfolio_pnl_simulations).toHaveLength(5);
    expect(top.portfolio_pnl_simulations?.[0]).toMatchObject({
      price_change_pct: -5,
      underlying_price: 16625,
    });
    expect(top.portfolio_pnl_simulations?.[0].estimated_pnl).toBeCloseTo(-96616.47383209037, 3);
    expect(top.portfolio_chart_data).toHaveLength(51);
  });

  it("matches the backend mock-provider top SPY recommendation", async () => {
    const recommendations = await getTaxCondorRecommendations({ symbol: "spy", budget: 1000 });

    expect(recommendations).toHaveLength(10);
    const top = recommendations[0];
    expect(top.underlying_price).toBe(500);
    expect(top.leap.leg.expiration).toBe("2027-05-03");
    expect(top.leap.leg.strike).toBe(485);
    expect(top.iron_condor.short_call.strike).toBe(505);
    expect(top.iron_condor.long_call.strike).toBe(525);
    expect(top.iron_condor.short_put.strike).toBe(480);
    expect(top.iron_condor.long_put.strike).toBe(460);
    expect(top.iron_condor.net_credit).toBeCloseTo(10.673719655432116, 4);
    expect(top.analysis.max_loss).toBeCloseTo(9.326280344567884, 4);
    expect(top.score).toBeCloseTo(-9.009476165764823, 4);
    expect(top.portfolio_pnl_simulations?.[2].estimated_pnl).toBeCloseTo(540.8949060497357, 3);
  });

  it("returns no recommendations when the loss budget is zero", async () => {
    await expect(getTaxCondorRecommendations({ symbol: "ZZZ", budget: 0 })).resolves.toEqual([]);
  });

  it("keeps max-budget requests bounded to the ranked top ten", async () => {
    const recommendations = await getTaxCondorRecommendations({ symbol: "NDX", budget: Number.MAX_SAFE_INTEGER });

    expect(recommendations).toHaveLength(10);
    expect(recommendations[0].analysis.max_loss).toBeGreaterThan(0);
    expect(recommendations[0].portfolio_chart_data).toHaveLength(51);
  });

  it("rejects live IBKR requests until worker-backed broker data is available", async () => {
    await expect(
      getTaxCondorRecommendations({ symbol: "NDX", budget: 2000, use_live_data: true }),
    ).rejects.toThrow(/live ibkr tax-condor data is not available/i);
  });
});
