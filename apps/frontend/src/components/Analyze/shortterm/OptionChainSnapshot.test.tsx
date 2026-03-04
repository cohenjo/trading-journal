import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import OptionChainSnapshot from "./OptionChainSnapshot";
import type { OptionChainData } from "./hooks/useOptionChain";

const fullData: OptionChainData = {
  current_price: 180.0,
  expirations: ["2025-07-25", "2025-08-01"],
  iv_percentile: 65,
  iv_rank: 42,
  puts: [
    {
      strike: 180,
      bid: 3.2,
      ask: 3.4,
      iv: 0.245,
      delta: -0.48,
      gamma: 0.035,
      theta: -0.12,
      volume: 1520,
      open_interest: 8400,
    },
    {
      strike: 175,
      bid: 2.1,
      ask: 2.3,
      iv: 0.22,
      delta: -0.35,
      gamma: 0.028,
      theta: -0.09,
      volume: 980,
      open_interest: 5200,
    },
  ],
};

describe("OptionChainSnapshot", () => {
  it("renders IV metrics correctly", () => {
    render(
      <OptionChainSnapshot
        data={fullData}
        expiry="2025-07-25"
        onExpiryChange={vi.fn()}
      />
    );

    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(/ideal for selling premium/i)).toBeInTheDocument();
  });

  it("renders put strikes near current price", () => {
    render(
      <OptionChainSnapshot
        data={fullData}
        expiry="2025-07-25"
        onExpiryChange={vi.fn()}
      />
    );

    expect(screen.getByText("$180")).toBeInTheDocument();
    expect(screen.getByText("$175")).toBeInTheDocument();
  });

  it("handles null IV metrics gracefully (shows dash)", () => {
    const dataWithNullIV: OptionChainData = {
      ...fullData,
      iv_percentile: null as unknown as number,
      iv_rank: null as unknown as number,
    };

    render(
      <OptionChainSnapshot
        data={dataWithNullIV}
        expiry="2025-07-25"
        onExpiryChange={vi.fn()}
      />
    );

    // Component uses '–' for null values
    const dashes = screen.getAllByText("–");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("handles missing Greeks in put options", () => {
    const dataWithMissingGreeks: OptionChainData = {
      current_price: 180.0,
      expirations: ["2025-07-25"],
      iv_percentile: 30,
      iv_rank: 25,
      puts: [
        {
          strike: 180,
          bid: null as unknown as number,
          ask: null as unknown as number,
          iv: null as unknown as number,
          delta: null as unknown as number,
          gamma: null as unknown as number,
          theta: null as unknown as number,
          volume: null as unknown as number,
          open_interest: null as unknown as number,
        },
      ],
    };

    // Should not throw — this is the null-safety fix we validated
    render(
      <OptionChainSnapshot
        data={dataWithMissingGreeks}
        expiry="2025-07-25"
        onExpiryChange={vi.fn()}
      />
    );

    // Dashes rendered for null values
    const dashes = screen.getAllByText("–");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it("shows empty state when no puts near current price", () => {
    const dataFarStrikes: OptionChainData = {
      current_price: 180.0,
      expirations: ["2025-07-25"],
      iv_percentile: 30,
      iv_rank: 25,
      puts: [
        {
          strike: 100,
          bid: 0.01,
          ask: 0.05,
          iv: 0.5,
          delta: -0.02,
          gamma: 0.001,
          theta: -0.01,
          volume: 10,
          open_interest: 50,
        },
      ],
    };

    render(
      <OptionChainSnapshot
        data={dataFarStrikes}
        expiry="2025-07-25"
        onExpiryChange={vi.fn()}
      />
    );

    expect(
      screen.getByText(/no puts found near current price/i)
    ).toBeInTheDocument();
  });
});
