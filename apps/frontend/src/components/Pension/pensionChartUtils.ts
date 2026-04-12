import type {
  PensionAccount,
  PensionMilestone,
  PensionSeriesPoint,
} from "./pensionTypes";
import {
  getPensionDisplayName,
  getPensionSeriesId,
} from "./pensionTypes";

export type PensionChartPoint = {
  time: string;
  value: number;
};

export type PensionChartLayer = {
  history: PensionChartPoint[];
  projections: PensionChartPoint[];
};

export type PensionMarker = {
  time: string;
  position: "aboveBar";
  color: string;
  shape: "arrowDown";
  text: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeChartDate = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return DATE_PATTERN.test(trimmedValue) ? trimmedValue : null;
};

const toFiniteNumber = (value: string | number | undefined): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

export const getSortedPensionAccounts = (
  accounts: PensionAccount[],
): PensionAccount[] =>
  [...accounts].sort((left, right) =>
    `${left.owner}:${getPensionDisplayName(left)}`.localeCompare(
      `${right.owner}:${getPensionDisplayName(right)}`,
    ),
  );

export function buildPensionChartLayers(
  history: PensionSeriesPoint[],
  projections: PensionSeriesPoint[],
  accounts: PensionAccount[],
): PensionChartLayer[] {
  const sortedAccounts = getSortedPensionAccounts(accounts);

  const computeStackValue = (
    dataPoint: PensionSeriesPoint,
    upToIndex: number,
  ): number => {
    let total = 0;

    for (let index = 0; index <= upToIndex; index += 1) {
      total += toFiniteNumber(
        dataPoint[getPensionSeriesId(sortedAccounts[index])],
      );
    }

    return total;
  };

  return sortedAccounts.map((_, layerIndex) => {
    const upToIndex = sortedAccounts.length - 1 - layerIndex;
    let hasStarted = false;

    const historyData = history.reduce<PensionChartPoint[]>(
      (points, dataPoint) => {
        const time = normalizeChartDate(dataPoint.date);
        if (!time) {
          return points;
        }

        const value = computeStackValue(dataPoint, upToIndex);
        if (value > 0) {
          hasStarted = true;
        }

        if (hasStarted) {
          points.push({ time, value });
        }

        return points;
      },
      [],
    );

    const projectionData = projections.reduce<PensionChartPoint[]>(
      (points, dataPoint) => {
        const time = normalizeChartDate(dataPoint.date);
        if (!time) {
          return points;
        }

        points.push({ time, value: computeStackValue(dataPoint, upToIndex) });
        return points;
      },
      [],
    );

    const lastHistoryPoint = historyData.at(-1);
    if (
      lastHistoryPoint &&
      projectionData.length > 0 &&
      projectionData[0].time !== lastHistoryPoint.time
    ) {
      projectionData.unshift(lastHistoryPoint);
    }

    return {
      history: historyData,
      projections: projectionData,
    };
  });
}

export const buildPensionMilestoneMarkers = (
  milestones: PensionMilestone[],
): PensionMarker[] =>
  milestones.reduce<PensionMarker[]>((markers, milestone) => {
    const time =
      normalizeChartDate(milestone.date) ||
      normalizeChartDate(`${milestone.year}-01-01`);

    if (!time) {
      return markers;
    }

    markers.push({
      time,
      position: "aboveBar",
      color: "#10b981",
      shape: "arrowDown",
      text: `${milestone.owner}'s Retirement`,
    });

    return markers;
  }, []);
