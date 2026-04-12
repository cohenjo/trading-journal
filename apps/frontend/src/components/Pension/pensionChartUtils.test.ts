import { describe, expect, it } from "vitest";

import {
  buildPensionChartLayers,
  buildPensionMilestoneMarkers,
} from "./pensionChartUtils";
import type { PensionAccount } from "./pensionTypes";

const accounts: PensionAccount[] = [
  {
    id: "pension::rita::makif",
    owner: "Rita",
    name: "פנסיה מקיפה — הראל",
    product_name: "פנסיה מקיפה",
    fund_name: "הראל",
    display_name: "פנסיה מקיפה — הראל",
    value: 0,
  },
];

describe("pensionChartUtils", () => {
  it("returns empty projections when there are no future points", () => {
    const layers = buildPensionChartLayers(
      [{ date: "2025-03-01", "pension::rita::makif": 100000 }],
      [],
      accounts,
    );

    expect(layers[0].history).toEqual([{ time: "2025-03-01", value: 100000 }]);
    expect(layers[0].projections).toEqual([]);
  });

  it("does not prepend an undefined history point when projections exist before history starts", () => {
    const layers = buildPensionChartLayers(
      [{ date: "2025-03-01", "pension::rita::makif": 0 }],
      [{ date: "2025-04-01", "pension::rita::makif": 120000 }],
      accounts,
    );

    expect(layers[0].history).toEqual([]);
    expect(layers[0].projections).toEqual([
      { time: "2025-04-01", value: 120000 },
    ]);
  });

  it("ignores malformed dates and non-numeric values when building chart layers", () => {
    const layers = buildPensionChartLayers(
      [
        { date: "not-a-date", "pension::rita::makif": 100000 },
        { date: "2025-03-01", "pension::rita::makif": "100000" },
      ],
      [
        { date: "2025-04-01", "pension::rita::makif": "bad-data" },
        { date: "2025-05-01", "pension::rita::makif": 105000 },
      ],
      accounts,
    );

    expect(layers[0].history).toEqual([{ time: "2025-03-01", value: 100000 }]);
    expect(layers[0].projections).toEqual([
      { time: "2025-03-01", value: 100000 },
      { time: "2025-04-01", value: 0 },
      { time: "2025-05-01", value: 105000 },
    ]);
  });

  it("falls back to milestone year when milestone date is missing", () => {
    const markers = buildPensionMilestoneMarkers([
      {
        owner: "You",
        name: "Retirement",
        year: 2045,
      },
    ]);

    expect(markers).toEqual([
      expect.objectContaining({
        time: "2045-01-01",
        text: "You's Retirement",
      }),
    ]);
  });
});
