import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PensionChart from "./PensionChart";
import type { PensionAccount } from "./pensionTypes";

const singleAccount: PensionAccount[] = [
  {
    id: "pension::rita::makif::harel",
    series_id: "pension::rita::makif::harel",
    owner: "Rita",
    name: "פנסיה מקיפה — הראל",
    product_name: "פנסיה מקיפה",
    fund_name: "הראל",
    display_name: "פנסיה מקיפה — הראל",
    value: 0,
    details: {
      pension_identity: "pension::rita::makif::harel",
      pension_product: "פנסיה מקיפה",
      pension_fund_name: "הראל",
    },
  },
];

type MockSeries = {
  setData: (...args: unknown[]) => void;
};

type MockChartInstance = {
  __series: MockSeries[];
};

async function getLatestChartSeries() {
  const chartModule = await import("lightweight-charts");
  const chartInstances = (
    chartModule as unknown as { __chartInstances: MockChartInstance[] }
  ).__chartInstances;
  return chartInstances.at(-1)?.__series ?? [];
}

describe("PensionChart", () => {
  it("renders safely when projections are empty", async () => {
    render(
      <PensionChart
        history={[
          {
            date: "2025-03-01",
            "pension::rita::makif::harel": 100000,
          },
        ]}
        projections={[]}
        accounts={singleAccount}
        milestones={[]}
      />,
    );

    await waitFor(async () => {
      const series = await getLatestChartSeries();
      expect(series).toHaveLength(2);
      expect(series[0].setData).toHaveBeenCalledWith([
        { time: "2025-03-01", value: 100000 },
      ]);
      expect(series[1].setData).toHaveBeenCalledWith([]);
    });
  });

  it("does not inject an undefined anchor when history has not started", async () => {
    render(
      <PensionChart
        history={[
          {
            date: "2025-03-01",
            "pension::rita::makif::harel": 0,
          },
        ]}
        projections={[
          {
            date: "2025-04-01",
            "pension::rita::makif::harel": 120000,
          },
        ]}
        accounts={singleAccount}
        milestones={[]}
      />,
    );

    await waitFor(async () => {
      const series = await getLatestChartSeries();
      expect(series[0].setData).toHaveBeenCalledWith([]);
      expect(series[1].setData).toHaveBeenCalledWith([
        { time: "2025-04-01", value: 120000 },
      ]);
    });
  });
});
