export type PensionAccountDetails = {
  deposits?: number;
  earnings?: number;
  fees?: number;
  insurance_fees?: number;
  pension_identity?: string;
  pension_product?: string;
  pension_fund_name?: string;
  [key: string]: unknown;
};

export type PensionSeriesPoint = {
  date: string;
  [seriesId: string]: string | number | undefined;
};

export type PensionAccount = {
  id: string;
  series_id?: string;
  owner: string;
  name: string;
  value: number;
  details?: PensionAccountDetails;
  product_name?: string;
  fund_name?: string;
  display_name?: string;
};

export type PensionMilestone = {
  owner: string;
  name: string;
  date?: string;
  year: number;
};

export type PensionDashboardResponse = {
  status: string;
  history: PensionSeriesPoint[];
  projections: PensionSeriesPoint[];
  accounts: PensionAccount[];
  milestones: PensionMilestone[];
};

export const getPensionSeriesId = (account: PensionAccount): string =>
  account.series_id || account.id;

export const getPensionProductName = (account: PensionAccount): string =>
  account.product_name ||
  account.details?.pension_product?.toString() ||
  account.display_name ||
  account.name;

export const getPensionFundName = (account: PensionAccount): string | null => {
  const fundName =
    account.fund_name || account.details?.pension_fund_name?.toString();

  if (!fundName || fundName === getPensionProductName(account)) {
    return null;
  }

  return fundName;
};

export const getPensionDisplayName = (account: PensionAccount): string =>
  account.display_name || getPensionProductName(account) || account.name;
