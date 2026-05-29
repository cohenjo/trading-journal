/**
 * e2e/fixtures/expenses.ts
 *
 * Redfoot (CC-10) — Reusable fixture data for /finances/expenses E2E tests.
 *
 * All fixtures use realistic Hebrew merchant names (ILS amounts, NUMERIC(12,2)
 * precision). Merchant names use authentic Hebrew text per McManus's RTL note.
 * Amounts are stored as numbers matching NUMERIC(12,2) DB precision.
 *
 * No real backend is needed — these fixtures are served via page.route() stubs.
 */

import type {
  MonthlySummaryRow,
  UnresolvedResponse,
  StatementsResponse,
  ByCategoryResponse,
} from '@/types/expenses';

// ── Monthly Summary ────────────────────────────────────────────────────────────

/** 3-month fixture: groceries + restaurants + health across 2026-03, 04, 05 */
export const monthlySummaryFixture: MonthlySummaryRow[] = [
  // 2026-03
  { month: '2026-03', category_slug: 'groceries',   category_name: 'Groceries',   category_name_he: 'מזון וסופרמרקט',      amount_ils: 1850.00, txn_count: 12 },
  { month: '2026-03', category_slug: 'restaurants',  category_name: 'Restaurants', category_name_he: 'מסעדות ומשלוחים',     amount_ils: 620.50,  txn_count: 5  },
  { month: '2026-03', category_slug: 'health',       category_name: 'Health',      category_name_he: 'בריאות',              amount_ils: 310.00,  txn_count: 3  },

  // 2026-04
  { month: '2026-04', category_slug: 'groceries',   category_name: 'Groceries',   category_name_he: 'מזון וסופרמרקט',      amount_ils: 2100.75, txn_count: 14 },
  { month: '2026-04', category_slug: 'restaurants',  category_name: 'Restaurants', category_name_he: 'מסעדות ומשלוחים',     amount_ils: 480.00,  txn_count: 4  },
  { month: '2026-04', category_slug: 'fuel',         category_name: 'Fuel',        category_name_he: 'דלק',                 amount_ils: 390.00,  txn_count: 2  },

  // 2026-05
  { month: '2026-05', category_slug: 'groceries',   category_name: 'Groceries',   category_name_he: 'מזון וסופרמרקט',      amount_ils: 1990.25, txn_count: 13 },
  { month: '2026-05', category_slug: 'shopping',     category_name: 'Shopping',    category_name_he: 'קניות',               amount_ils: 755.00,  txn_count: 6  },
  { month: '2026-05', category_slug: 'health',       category_name: 'Health',      category_name_he: 'בריאות',              amount_ils: 220.00,  txn_count: 2  },
];

/** Monthly summary fixture WITH transfers included */
export const monthlySummaryWithTransfersFixture: MonthlySummaryRow[] = [
  ...monthlySummaryFixture,
  { month: '2026-03', category_slug: 'transfers', category_name: 'Transfers', category_name_he: 'העברות כסף', amount_ils: 500.00, txn_count: 2 },
  { month: '2026-04', category_slug: 'transfers', category_name: 'Transfers', category_name_he: 'העברות כסף', amount_ils: 250.00, txn_count: 1 },
];

/** Empty monthly summary fixture for empty-state tests */
export const emptyMonthlySummaryFixture: MonthlySummaryRow[] = [];

// ── Unresolved Queue ──────────────────────────────────────────────────────────

/** 3-row unresolved transaction fixture with Hebrew merchant names. */
export const unresolvedFixture: UnresolvedResponse = {
  items: [
    {
      id: 'txn-aaaa-0001-0000-000000000001',
      txn_date: '2026-05-12T00:00:00Z',
      merchant_raw: 'שופרסל',
      merchant_normalized: 'שופרסל',
      amount_ils: 432.10,
      original_currency: null,
      amount_original: null,
      sector_raw: 'סופרמרקט',
      statement_id: 'stmt-0000-0000-0000-000000000001',
    },
    {
      id: 'txn-bbbb-0002-0000-000000000002',
      txn_date: '2026-05-14T00:00:00Z',
      merchant_raw: 'דלפיש',
      merchant_normalized: 'דלפיש',
      amount_ils: 89.90,
      original_currency: null,
      amount_original: null,
      sector_raw: null,
      statement_id: 'stmt-0000-0000-0000-000000000001',
    },
    {
      id: 'txn-cccc-0003-0000-000000000003',
      txn_date: '2026-05-16T00:00:00Z',
      merchant_raw: 'זוטר רגלא',
      merchant_normalized: 'זוטר רגלא',
      amount_ils: 127.50,
      original_currency: 'USD',
      amount_original: 34.50,
      sector_raw: 'מסעדות',
      statement_id: 'stmt-0000-0000-0000-000000000001',
    },
  ],
  total: 3,
  page: 1,
  page_size: 50,
};

/** Single-item unresolved queue after resolving two rows. */
export const unresolvedAfterResolveFixture: UnresolvedResponse = {
  items: [unresolvedFixture.items[2]],
  total: 1,
  page: 1,
  page_size: 50,
};

/** Empty unresolved queue */
export const unresolvedEmptyFixture: UnresolvedResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 50,
};

// ── Statements ────────────────────────────────────────────────────────────────

/** 3-statement fixture covering Cal + Max issuers, realistic period ranges. */
export const statementsFixture: StatementsResponse = {
  items: [
    {
      id: 'stmt-1111-0000-0000-000000000001',
      issuer: 'כאל',
      cardholder_name: 'יוני כהן',
      card_last4: '4821',
      period_from: '2026-04-01T00:00:00Z',
      period_to: '2026-04-30T00:00:00Z',
      total_amount_ils: 4812.30,
      txn_count: 38,
      parse_warnings_count: 0,
      ingested_at: '2026-05-02T10:14:00Z',
    },
    {
      id: 'stmt-2222-0000-0000-000000000002',
      issuer: 'מקס',
      cardholder_name: 'שירה כהן',
      card_last4: '9933',
      period_from: '2026-04-01T00:00:00Z',
      period_to: '2026-04-30T00:00:00Z',
      total_amount_ils: 2110.00,
      txn_count: 21,
      parse_warnings_count: 2,
      ingested_at: '2026-05-02T11:00:00Z',
    },
    {
      id: 'stmt-3333-0000-0000-000000000003',
      issuer: 'פייבוקס',
      cardholder_name: 'יוני כהן',
      card_last4: '0011',
      period_from: '2026-03-01T00:00:00Z',
      period_to: '2026-03-31T00:00:00Z',
      total_amount_ils: 980.00,
      txn_count: 9,
      parse_warnings_count: 0,
      ingested_at: '2026-04-01T08:30:00Z',
    },
  ],
  total: 3,
  page: 1,
  page_size: 20,
};

/** Empty statements fixture */
export const statementsEmptyFixture: StatementsResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
};

// ── By Category (drill-down) ──────────────────────────────────────────────────

/** Groceries drill-down: 3 transactions in 2026-05 */
export const byCategoryGroceriesFixture: ByCategoryResponse = {
  items: [
    {
      id: 'txn-dd01-0000-0000-000000000001',
      txn_date: '2026-05-03T00:00:00Z',
      merchant_raw: 'רמי לוי',
      merchant_normalized: 'רמי לוי',
      amount_ils: 620.25,
      original_currency: null,
      amount_original: null,
      resolution_status: 'user_confirmed',
      resolution_source: 'manual',
      statement_id: 'stmt-1111-0000-0000-000000000001',
    },
    {
      id: 'txn-dd02-0000-0000-000000000002',
      txn_date: '2026-05-08T00:00:00Z',
      merchant_raw: 'שופרסל',
      merchant_normalized: 'שופרסל',
      amount_ils: 880.00,
      original_currency: null,
      amount_original: null,
      resolution_status: 'user_confirmed',
      resolution_source: 'mapping',
      statement_id: 'stmt-1111-0000-0000-000000000001',
    },
    {
      id: 'txn-dd03-0000-0000-000000000003',
      txn_date: '2026-05-19T00:00:00Z',
      merchant_raw: 'מחסני השוק',
      merchant_normalized: 'מחסני השוק',
      amount_ils: 490.00,
      original_currency: null,
      amount_original: null,
      resolution_status: 'user_confirmed',
      resolution_source: 'manual',
      statement_id: 'stmt-1111-0000-0000-000000000001',
    },
  ],
  total: 3,
  page: 1,
  page_size: 50,
  category_slug: 'groceries',
  subtotal_ils: 1990.25,
};

// ── Categories tree ───────────────────────────────────────────────────────────

/**
 * Minimal category tree fixture for the /api/expenses/categories endpoint.
 * The CategoryPicker currently uses the hardcoded EXPENSE_CATEGORIES constant,
 * not this endpoint. This fixture is provided for future-proofing when
 * Hockney ships the live endpoint.
 */
export const categoriesTreeFixture = {
  categories: [
    {
      id: 'cat-groceries',
      slug: 'groceries',
      name: 'Groceries',
      name_he: 'מזון וסופרמרקט',
      color: '#4CAF50',
      is_transfer: false,
      subcategories: [],
    },
    {
      id: 'cat-restaurants',
      slug: 'restaurants',
      name: 'Restaurants',
      name_he: 'מסעדות ומשלוחים',
      color: '#FF9800',
      is_transfer: false,
      subcategories: [
        { id: 'cat-restaurants-delivery', slug: 'restaurants-delivery', name: 'Delivery', name_he: 'משלוחים', is_transfer: false, parent_slug: 'restaurants' },
        { id: 'cat-restaurants-fast-food', slug: 'restaurants-fast-food', name: 'Fast Food', name_he: 'מזון מהיר', is_transfer: false, parent_slug: 'restaurants' },
      ],
    },
    {
      id: 'cat-transfers',
      slug: 'transfers',
      name: 'Transfers',
      name_he: 'העברות כסף',
      color: '#9E9E9E',
      is_transfer: true,
      subcategories: [
        { id: 'cat-transfers-paybox', slug: 'transfers-paybox', name: 'PayBox / Bit', name_he: 'פייבוקס / ביט', is_transfer: true, parent_slug: 'transfers' },
      ],
    },
  ],
};

// ── Resolve response ──────────────────────────────────────────────────────────

/** Successful single-transaction resolve response */
export const resolveSuccessFixture = {
  updated_count: 1,
  mapping_id: 'map-0000-0000-0000-000000000001',
};

/** Resolve response that updated 3 matching transactions (apply_to_all_matching) */
export const resolveApplyAllFixture = {
  updated_count: 3,
  mapping_id: 'map-0000-0000-0000-000000000002',
};
