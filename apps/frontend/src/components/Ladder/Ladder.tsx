import React, { useMemo, useEffect, useRef, useState } from "react";
import { Rung } from "./Rung";
import { RungDetails } from "./RungDetails";
import type { RungData, Bond as ApiBond } from "./types";
import "../../styles/Ladder.css";
import { useSettings } from "@/app/settings/SettingsContext";

type LadderProps = {
  rungs: RungData[];
  selectedRungId: string | null;
  onSelectRung: (id: string | null) => void;
  onHoverRung?: (id: string | null) => void;
  bonds?: ApiBond[];
  onUpdateRungTarget?: (rungId: string, targetAmount: number) => void;
  onAddBond?: (payload: {
    issuer: string;
    face_value: number;
    coupon_rate: number;
    coupon_frequency: string;
    currency: string;
    issue_date: string;
    maturity_date: string;
  }) => Promise<void>;
  prefillCandidate?: {
    id?: string;
    maturityYear?: number;
  };
};

export const Ladder: React.FC<LadderProps> = ({
  rungs,
  selectedRungId,
  onSelectRung,
  onHoverRung,
  bonds = [],
  onUpdateRungTarget,
  onAddBond,
  prefillCandidate,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [zoomYears, setZoomYears] = useState<1 | 3 | 5>(3);
  const { settings } = useSettings();

  const selectedRung = useMemo(() => {
    if (!selectedRungId) return null;

    // Aggregated IDs are of the form "3Y-<year>" or "5Y-<year>".
    if (selectedRungId.startsWith("3Y-") || selectedRungId.startsWith("5Y-")) {
      const step = selectedRungId.startsWith("3Y-") ? 3 : 5;
      const baseYear = parseInt(selectedRungId.slice(3), 10);
      const startYear = baseYear;
      const endYear = baseYear + step - 1;

      // For details, aggregate all bonds and amounts from the 1-year
      // rungs that fall inside this block when we build the RungDetails
      // props below; here we just need any representative year so
      // RungDetails has a label.
      const inRange = rungs.filter(
        (r) => r.year >= startYear && r.year <= endYear
      );
      if (inRange.length === 0) return null;
      // Use the block's start year label if present, otherwise the
      // earliest year in the range.
      const startMatch = inRange.find((r) => r.year === startYear);
      return startMatch ?? inRange.sort((a, b) => a.year - b.year)[0];
    }

    return rungs.find((r) => r.id === selectedRungId) ?? null;
  }, [rungs, selectedRungId]);

  const bondsByRung = useMemo(() => {
    const map: Record<string, ApiBond[]> = {};
    for (const bond of bonds) {
      if (!map[bond.rung_id]) {
        map[bond.rung_id] = [];
      }
      map[bond.rung_id].push(bond);
    }
    return map;
  }, [bonds]);

  const handleRungClick = (id: string) => {
    onSelectRung(id);
  };

  const zoomStep = useMemo(() => {
    switch (zoomYears) {
      case 1:
        return 1; // 1-year atomic rungs from API
      case 3:
        return 3; // aggregate 3 consecutive years
      case 5:
        return 5; // aggregate 5 consecutive years
      default:
        return 1;
    }
  }, [zoomYears]);

  // On first render, scroll the ladder so the bottom rungs are visible.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  return (
    <div className="ladder-page h-full flex flex-col items-stretch">
      <div className="flex-1 flex items-start justify-start w-full">
        <div className="ladder-container">
          <div className="ladder-rails" />
          <div className="ladder-scroll" ref={scrollRef}>
          {(() => {
            if (rungs.length === 0) return [];

            // Atomic 1-year rungs from backend
            const sorted = [...rungs].sort((a, b) => a.year - b.year);

            if (zoomStep === 1) {
              return sorted.slice().sort((a, b) => b.year - a.year);
            }

            const BASE_YEAR = 2034;
            const minYear = Math.min(sorted[0].year, BASE_YEAR);
            const maxYear = sorted[sorted.length - 1].year;

            const blocks: RungData[] = [];

            // Determine block starts for 3- or 5-year zoom.
            const blockStarts: number[] = [];
            if (zoomStep === 3) {
              for (let y = BASE_YEAR; y <= maxYear; y += 3) {
                if (y + 2 < minYear) continue;
                blockStarts.push(y);
              }
            } else if (zoomStep === 5) {
              // 5-year blocks start at 2035, 2040, 2045, ... as requested.
              const FIVE_BASE = 2035;
              for (let y = FIVE_BASE; y <= maxYear + 4; y += 5) {
                if (y + 4 < minYear) continue;
                blockStarts.push(y);
              }
            }

            for (const startYear of blockStarts) {
              const endYear = startYear + zoomStep - 1;
              const inBlock = sorted.filter(
                (r) => r.year >= startYear && r.year <= endYear
              );
              if (inBlock.length === 0) {
                continue;
              }

              const target_amount = inBlock.reduce((sum, r) => {
                const base = r.target_amount && r.target_amount > 0
                  ? r.target_amount
                  : settings.defaultRungTarget;
                return sum + base;
              }, 0);
              const current_amount = inBlock.reduce(
                (sum, r) => sum + r.current_amount,
                0
              );

              blocks.push({
                id: `${zoomStep}Y-${startYear}`,
                year: startYear,
                start_date: inBlock[0].start_date,
                end_date: inBlock[inBlock.length - 1].end_date,
                target_amount,
                current_amount,
              });
            }

            return blocks.sort((a, b) => b.year - a.year);
          })().map((rung) => {
              const effectiveTarget =
                rung.target_amount && rung.target_amount > 0
                  ? rung.target_amount
                  : settings.defaultRungTarget;
              const completion =
                effectiveTarget > 0
                  ? Math.min(rung.current_amount / effectiveTarget, 1)
                  : 0;
              return (
                <Rung
                  key={rung.id}
                  rung={{
                    id: rung.id,
                    year: rung.year,
                    targetAmount: effectiveTarget,
                    bonds: [],
                  }}
                  completion={completion}
                  onClick={() => handleRungClick(rung.id)}
                  onMouseEnter={() => onHoverRung?.(rung.id)}
                  onMouseLeave={() => onHoverRung?.(null)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-start items-end text-xs text-slate-300 w-full">
        <span className="mr-3">Rung span: {zoomYears} yr{zoomYears > 1 ? "s" : ""}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="px-2 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700"
            onClick={() =>
              setZoomYears((prev) => (prev === 5 ? 3 : prev === 3 ? 1 : 1))
            }
          >
            +
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700"
            onClick={() =>
              setZoomYears((prev) => (prev === 1 ? 3 : prev === 3 ? 5 : 5))
            }
          >
            -
          </button>
        </div>
      </div>

      {selectedRung && (
        <RungDetails
          rung={{
            // For aggregated views we keep the synthetic id (3Y-/5Y-)
            // so the save handler can apply the fan-out policy. For
            // 1-year zoom the id is just the plain rung id.
            id: selectedRungId ?? selectedRung.id,
            year: selectedRung.year,
            targetAmount: (() => {
              if (!selectedRungId) return selectedRung.target_amount;

              if (
                selectedRungId.startsWith("3Y-") ||
                selectedRungId.startsWith("5Y-")
              ) {
                const step = selectedRungId.startsWith("3Y-") ? 3 : 5;
                const baseYear = parseInt(selectedRungId.slice(3), 10);
                const startYear = baseYear;
                const endYear = baseYear + step - 1;

                return rungs
                  .filter((r) => r.year >= startYear && r.year <= endYear)
                  .reduce((sum, r) => sum + r.target_amount, 0);
              }

              return selectedRung.target_amount;
            })(),
            spanYears: (() => {
              if (!selectedRungId) return 1;
              if (selectedRungId.startsWith("3Y-")) return 3;
              if (selectedRungId.startsWith("5Y-")) return 5;
              return 1;
            })(),
            bonds: (() => {
              if (!selectedRungId) {
                return (
                  bondsByRung[selectedRung.id]?.map((b) => ({
                    id: b.id,
                    issuer: b.issuer,
                    maturityDate: b.maturity_date,
                    amount: b.face_value,
                    currency: b.currency,
                    coupon_rate: b.coupon_rate,
                  })) ?? []
                );
              }

              if (
                selectedRungId.startsWith("3Y-") ||
                selectedRungId.startsWith("5Y-")
              ) {
                const step = selectedRungId.startsWith("3Y-") ? 3 : 5;
                const baseYear = parseInt(selectedRungId.slice(3), 10);
                const startYear = baseYear;
                const endYear = baseYear + step - 1;

                const years = rungs
                  .filter((r) => r.year >= startYear && r.year <= endYear)
                  .map((r) => r.id);

                const allBonds = years.flatMap((rid) => bondsByRung[rid] ?? []);

                return allBonds.map((b) => ({
                  id: b.id,
                  issuer: b.issuer,
                  maturityDate: b.maturity_date,
                  amount: b.face_value,
                  currency: b.currency,
                  coupon_rate: b.coupon_rate,
                }));
              }

              return (
                bondsByRung[selectedRung.id]?.map((b) => ({
                  id: b.id,
                  issuer: b.issuer,
                  maturityDate: b.maturity_date,
                  amount: b.face_value,
                  currency: b.currency,
                  coupon_rate: b.coupon_rate,
                })) ?? []
              );
            })(),
          }}
          candidatePrefill={(() => {
            if (!prefillCandidate?.id) return undefined;

            // Try to find a matching bond in the current ladder bonds list
            const candidateBond = bonds.find((b) => b.id === prefillCandidate.id);
            if (!candidateBond) return undefined;

            return {
              issuer: candidateBond.issuer,
              coupon_rate: candidateBond.coupon_rate,
              maturity_date: candidateBond.maturity_date,
            };
          })()}
          onClose={() => onSelectRung(null)}
          onUpdate={(updated) => {
            if (!onUpdateRungTarget) return;

            // If this is an aggregated rung (3Y- or 5Y-), split the
            // target amount evenly across the underlying 1-year rungs.
            if (updated.id.startsWith("3Y-")) {
              const baseYear = parseInt(updated.id.slice(3), 10);
              const perYear = updated.targetAmount / 3;
              for (let y = baseYear; y < baseYear + 3; y += 1) {
                onUpdateRungTarget(String(y), perYear);
              }
            } else if (updated.id.startsWith("5Y-")) {
              const baseYear = parseInt(updated.id.slice(3), 10);
              const perYear = updated.targetAmount / 5;
              for (let y = baseYear; y < baseYear + 5; y += 1) {
                onUpdateRungTarget(String(y), perYear);
              }
            } else {
              onUpdateRungTarget(updated.id, updated.targetAmount);
            }
          }}
          onAddBond={onAddBond}
          onOpenScanner={({ year }) => {
            const params = new URLSearchParams();
            params.set("fromYear", String(year));
            window.location.href = `/ladder/scanner?${params.toString()}`;
          }}
        />
      )}
    </div>
  );
};
