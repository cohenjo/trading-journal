export type Bond = {
  id: string;
  ticker?: string | null;
  issuer: string;
  currency: string;
  face_value: number;
  coupon_rate: number;
  coupon_frequency: string;
  maturity_date: string; // ISO date
  rung_id: string;
};

export type RungData = {
  id: string;
  year: number;
  start_date: string; // ISO date
  end_date: string; // ISO date
  target_amount: number;
  current_amount: number;
};

export type IncomePoint = {
  date: string; // ISO date
  value: number;
};

export type DistributionRow = {
  id: string;
  date: string; // ISO date
  amount: number;
  currency: string;
  type: "COUPON" | "PRINCIPAL";
  bond_id: string;
  ticker?: string | null;
  issuer: string;
  maturity_date: string; // ISO date
  rung_id: string;
};
