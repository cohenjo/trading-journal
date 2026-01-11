import React, { useMemo, useState } from "react";
import "../../styles/Ladder.css";

type BondWithCoupon = {
  id: string;
  ticker?: string | null;
  issuer: string;
  maturityDate: string;
  amount: number;
  currency: string;
  coupon_rate?: number;
};

type RungData = {
  id: string;
  year: number;
  targetAmount: number;
  bonds: BondWithCoupon[];
  spanYears?: number; // 1 for single-year, 3/5 for aggregates
};

type RungDetailsProps = {
  rung: RungData;
  onClose: () => void;
  onUpdate: (rung: RungData) => void;
  onOpenScanner?: (context: { year: number }) => void;
  candidatePrefill?: {
    ticker?: string;
    issuer?: string;
    coupon_rate?: number;
    maturity_date?: string;
  };
  onAddBond?: (payload: {
    issuer: string;
    face_value: number;
    coupon_rate: number;
    coupon_frequency: string;
    currency: string;
    issue_date: string;
    maturity_date: string;
  }) => Promise<void>;
};

export const RungDetails: React.FC<RungDetailsProps> = ({
  rung,
  onClose,
  onUpdate,
  onAddBond,
  onOpenScanner,
  candidatePrefill,
}) => {
  const [localRung, setLocalRung] = useState<RungData>(rung);

  const handleTargetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value) || 0;
    setLocalRung((prev) => ({ ...prev, targetAmount: value }));
  };

  const totalAmount = useMemo(() => {
    return localRung.bonds.reduce(
      (sum: number, b: BondWithCoupon) => sum + b.amount,
      0
    );
  }, [localRung.bonds]);

  const yearlyIncome = useMemo(() => {
    return localRung.bonds.reduce((sum: number, b: BondWithCoupon) => {
      const couponRate = b.coupon_rate ?? 0;
      const faceValue = b.amount;
      return sum + faceValue * couponRate;
    }, 0);
  }, [localRung.bonds]);

  const [newTicker, setNewTicker] = useState(candidatePrefill?.ticker ?? "");
  const [newIssuer, setNewIssuer] = useState(candidatePrefill?.issuer ?? "");
  const [newFace, setNewFace] = useState(0);
  const [newCoupon, setNewCoupon] = useState(candidatePrefill?.coupon_rate ?? 0.04);
  const [newFrequency, setNewFrequency] = useState("ANNUAL");
  const [newMaturity, setNewMaturity] = useState(
    candidatePrefill?.maturity_date ?? `${rung.year}-12-31`
  );
  const [submitting, setSubmitting] = useState(false);

  const handleAddBond = async () => {
    if (!onAddBond) return;
    if (!newIssuer || newFace <= 0) return;

    const maturityDate = newMaturity;
    const maturityYear = Number(maturityDate.slice(0, 4)) || localRung.year;
    const issueDate = `${Math.max(maturityYear - 1, 2024)}-01-01`;

    try {
      setSubmitting(true);
      await onAddBond({
        issuer: newIssuer,
        face_value: newFace,
        coupon_rate: newCoupon,
        coupon_frequency: newFrequency,
        currency: "USD",
        issue_date: issueDate,
        maturity_date: maturityDate,
      });

      // Only show the new bond in this rung if its maturity year
      // matches the rung year (1-year atomic ladder semantics).
      if (maturityYear === localRung.year) {
        const newBond: BondWithCoupon = {
          id: `temp-${Date.now()}`,
          ticker: newTicker || undefined,
          issuer: newIssuer,
          maturityDate,
          amount: newFace,
          currency: "USD",
          coupon_rate: newCoupon,
        };

        setLocalRung((prev) => ({
          ...prev,
          bonds: [...prev.bonds, newBond],
        }));
      }

      setNewTicker("");
      setNewIssuer("");
      setNewFace(0);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveBond = (bondId: string) => {
    setLocalRung((prev: RungData) => ({
      ...prev,
      bonds: prev.bonds.filter((b: BondWithCoupon) => b.id !== bondId),
    }));
  };

  const handleSave = () => {
    onUpdate(localRung);
  };

  return (
    <div className="rung-details-backdrop">
      <div className="rung-details-panel">
        <div className="rung-details-header">
          <h2>
            Rung
            {localRung.spanYears && localRung.spanYears > 1
              ? ` ${localRung.year}–${localRung.year + (localRung.spanYears - 1)}`
              : ` ${localRung.year}`}
          </h2>
          <button onClick={onClose} className="rung-details-close">
            ✕
          </button>
        </div>

        <div className="rung-details-section">
          <div className="rung-details-header-row">
            <label>
              Target amount:
              <input
                type="number"
                value={localRung.targetAmount}
                onChange={handleTargetChange}
              />
            </label>
            <button onClick={handleSave} className="rung-details-save">
              Save target
            </button>
            {onOpenScanner && (
              <button
                type="button"
                className="rung-details-save"
                onClick={() => onOpenScanner({ year: localRung.year })}
              >
                Search bonds
              </button>
            )}
          </div>
          <div>
            Current amount:{" "}
            {totalAmount.toLocaleString()}{" "}
            {localRung.bonds[0]?.currency ?? "USD"}
          </div>
          <div>
            Yearly income: {yearlyIncome.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}{" "}
            {localRung.bonds[0]?.currency ?? "USD"}
          </div>
        </div>

        <div className="rung-details-section">
          <div className="rung-details-header-row">
            <h3>Bonds in this rung</h3>
          </div>

          <table className="rung-details-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Issuer</th>
                <th>Maturity</th>
                <th>Face</th>
                <th>Coupon</th>
                <th>Income/yr</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {localRung.bonds.map((bond: BondWithCoupon) => (
                <tr key={bond.id}>
                  <td>{bond.ticker ?? ""}</td>
                  <td>{bond.issuer}</td>
                  <td>{bond.maturityDate}</td>
                  <td>
                    {bond.amount.toLocaleString()} {bond.currency}
                  </td>
                  <td>
                    {((bond.coupon_rate ?? 0) * 100).toFixed(2)}%
                  </td>
                  <td>
                    {(bond.amount * (bond.coupon_rate ?? 0)).toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                    {" "}
                    {bond.currency}
                  </td>
                  <td>
                    <button
                      onClick={() => handleRemoveBond(bond.id)}
                      className="rung-details-remove"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}

              {localRung.bonds.length === 0 && (
                <tr>
                  <td colSpan={4} className="rung-details-empty">
                    No bonds yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rung-details-footer">
          <div className="rung-details-add-form">
            <div>
              <label>
                Ticker
                <input
                  type="text"
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value)}
                />
              </label>
            </div>
            <div>
              <label>
                Issuer
                <input
                  type="text"
                  value={newIssuer}
                  onChange={(e) => setNewIssuer(e.target.value)}
                />
              </label>
            </div>
            <div className="rung-details-add-row-full">
              <label>
                Maturity
                <input
                  type="date"
                  value={newMaturity}
                  onChange={(e) => setNewMaturity(e.target.value)}
                />
              </label>
            </div>
            <div>
              <label>
                Face value
                <input
                  type="number"
                  value={newFace}
                  onChange={(e) => setNewFace(Number(e.target.value) || 0)}
                />
              </label>
            </div>
            <div>
              <label>
                Coupon %
                <input
                  type="number"
                  step="0.01"
                  value={(newCoupon * 100).toFixed(2)}
                  onChange={(e) =>
                    setNewCoupon((Number(e.target.value) || 0) / 100)
                  }
                />
              </label>
            </div>
            <div>
              <label>
                Frequency
                <select
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value)}
                >
                  <option value="ANNUAL">Annual</option>
                  <option value="SEMI_ANNUAL">Semi-annual</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </label>
            </div>
            <button
              onClick={handleAddBond}
              disabled={submitting || !onAddBond}
              className="rung-details-save"
            >
              Add bond
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
