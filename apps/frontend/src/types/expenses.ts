/**
 * TypeScript interfaces mirroring the CC-6 backend Pydantic response models.
 * Keep in sync with apps/backend/app/api/expenses.py.
 */

// ── Category tree (hardcoded from McManus's taxonomy — no /categories endpoint yet) ──

export interface ExpenseCategory {
  id: string; // UUID
  slug: string;
  name: string;
  name_he: string;
  color: string;
  icon?: string;
  is_transfer: boolean;
  subcategories: ExpenseSubcategory[];
}

export interface ExpenseSubcategory {
  id: string; // UUID
  slug: string;
  name: string;
  name_he: string;
  parent_slug: string;
}

// ── GET /api/expenses/unresolved ──────────────────────────────────────────────

export interface UnresolvedTransaction {
  id: string; // UUID
  txn_date: string; // ISO datetime
  merchant_raw: string;
  merchant_normalized: string;
  amount_ils: number;
  original_currency: string | null;
  amount_original: number | null;
  sector_raw: string | null;
  statement_id: string; // UUID
}

export interface UnresolvedResponse {
  items: UnresolvedTransaction[];
  total: number;
  page: number;
  page_size: number;
}

// ── POST /api/expenses/resolve ────────────────────────────────────────────────

export interface ResolveRequest {
  transaction_id: string; // UUID
  category_id: string; // UUID
  subcategory_id: string | null;
  apply_to_all_matching: boolean;
}

export interface ResolveResponse {
  updated_count: number;
  mapping_id: string; // UUID
}

// ── GET /api/expenses/monthly-summary ────────────────────────────────────────

export interface MonthlySummaryRow {
  month: string; // 'YYYY-MM'
  category_slug: string;
  category_name: string;
  category_name_he: string;
  amount_ils: number;
  txn_count: number;
}

// ── GET /api/expenses/by-category/{slug} ─────────────────────────────────────

export interface TransactionDetail {
  id: string; // UUID
  txn_date: string; // ISO datetime
  merchant_raw: string;
  merchant_normalized: string;
  amount_ils: number;
  original_currency: string | null;
  amount_original: number | null;
  resolution_status: string;
  resolution_source: string | null;
  statement_id: string; // UUID
}

export interface ByCategoryResponse {
  items: TransactionDetail[];
  total: number;
  page: number;
  page_size: number;
  category_slug: string;
  subtotal_ils: number;
}

// ── GET /api/expenses/statements ─────────────────────────────────────────────

export interface Statement {
  id: string; // UUID
  issuer: string;
  cardholder_name: string;
  card_last4: string;
  period_from: string; // ISO datetime
  period_to: string; // ISO datetime
  total_amount_ils: number | null;
  txn_count: number | null;
  parse_warnings_count: number;
  ingested_at: string; // ISO datetime
}

export interface StatementsResponse {
  items: Statement[];
  total: number;
  page: number;
  page_size: number;
}

// ── Hardcoded category tree (McManus YAML — no /api/expenses/categories yet) ─
// TODO(CC-9): Hockney to add GET /api/expenses/categories endpoint so this list
// is fetched dynamically. Until then, this static copy drives the picker + charts.

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  {
    id: "cat-groceries",
    slug: "groceries",
    name: "Groceries",
    name_he: "מזון וסופרמרקט",
    color: "#4CAF50",
    icon: "shopping-cart",
    is_transfer: false,
    subcategories: [],
  },
  {
    id: "cat-restaurants",
    slug: "restaurants",
    name: "Restaurants & Food Delivery",
    name_he: "מסעדות ומשלוחים",
    color: "#FF9800",
    icon: "utensils",
    is_transfer: false,
    subcategories: [
      { id: "cat-restaurants-delivery", slug: "restaurants-delivery", name: "Delivery", name_he: "משלוחים", parent_slug: "restaurants" },
      { id: "cat-restaurants-fast-food", slug: "restaurants-fast-food", name: "Fast Food", name_he: "מזון מהיר", parent_slug: "restaurants" },
      { id: "cat-restaurants-dine-in", slug: "restaurants-dine-in", name: "Dine-in", name_he: "מסעדות ישיבה", parent_slug: "restaurants" },
    ],
  },
  {
    id: "cat-health",
    slug: "health",
    name: "Health",
    name_he: "בריאות",
    color: "#E91E63",
    icon: "heart",
    is_transfer: false,
    subcategories: [
      { id: "cat-health-pharmacy", slug: "health-pharmacy", name: "Pharmacy", name_he: "בית מרקחת", parent_slug: "health" },
      { id: "cat-health-medical", slug: "health-medical", name: "Medical", name_he: "רפואה ומרפאות", parent_slug: "health" },
      { id: "cat-health-fitness", slug: "health-fitness", name: "Fitness", name_he: "כושר וספורט", parent_slug: "health" },
    ],
  },
  {
    id: "cat-utilities",
    slug: "utilities",
    name: "Utilities & Communications",
    name_he: "שירותים ותקשורת",
    color: "#607D8B",
    icon: "bolt",
    is_transfer: false,
    subcategories: [
      { id: "cat-utilities-internet-tv", slug: "utilities-internet-tv", name: "Internet & TV", name_he: "אינטרנט וטלוויזיה", parent_slug: "utilities" },
      { id: "cat-utilities-phone", slug: "utilities-phone", name: "Phone", name_he: "טלפון נייד", parent_slug: "utilities" },
      { id: "cat-utilities-streaming", slug: "utilities-streaming", name: "Streaming", name_he: "סטרימינג ומנויים", parent_slug: "utilities" },
    ],
  },
  {
    id: "cat-travel",
    slug: "travel",
    name: "Travel",
    name_he: "נסיעות ותיירות",
    color: "#03A9F4",
    icon: "plane",
    is_transfer: false,
    subcategories: [
      { id: "cat-travel-flights", slug: "travel-flights", name: "Flights", name_he: "טיסות", parent_slug: "travel" },
      { id: "cat-travel-hotels", slug: "travel-hotels", name: "Hotels", name_he: "מלונות ולינה", parent_slug: "travel" },
      { id: "cat-travel-parking", slug: "travel-parking", name: "Parking", name_he: "חניון ופנגו", parent_slug: "travel" },
      { id: "cat-travel-transit", slug: "travel-transit", name: "Transit", name_he: "תחבורה ציבורית ורישוי", parent_slug: "travel" },
    ],
  },
  {
    id: "cat-shopping",
    slug: "shopping",
    name: "Shopping",
    name_he: "קניות",
    color: "#9C27B0",
    icon: "shopping-bag",
    is_transfer: false,
    subcategories: [
      { id: "cat-shopping-clothing", slug: "shopping-clothing", name: "Clothing", name_he: "ביגוד ואופנה", parent_slug: "shopping" },
      { id: "cat-shopping-electronics", slug: "shopping-electronics", name: "Electronics", name_he: "אלקטרוניקה וטכנולוגיה", parent_slug: "shopping" },
      { id: "cat-shopping-online", slug: "shopping-online", name: "Online", name_he: "קניות אונליין", parent_slug: "shopping" },
      { id: "cat-shopping-beauty", slug: "shopping-beauty", name: "Beauty", name_he: "יופי וטיפוח", parent_slug: "shopping" },
    ],
  },
  {
    id: "cat-kids-education",
    slug: "kids-education",
    name: "Kids & Education",
    name_he: "ילדים וחינוך",
    color: "#00BCD4",
    icon: "graduation-cap",
    is_transfer: false,
    subcategories: [
      { id: "cat-kids-online-learning", slug: "kids-online-learning", name: "Online Learning", name_he: "למידה מקוונת", parent_slug: "kids-education" },
      { id: "cat-kids-activities", slug: "kids-activities", name: "Activities", name_he: "חוגים ותוכניות", parent_slug: "kids-education" },
    ],
  },
  {
    id: "cat-financial",
    slug: "financial",
    name: "Financial & Insurance",
    name_he: "פיננסי וביטוח",
    color: "#795548",
    icon: "dollar-sign",
    is_transfer: false,
    subcategories: [
      { id: "cat-financial-insurance", slug: "financial-insurance", name: "Insurance", name_he: "ביטוח", parent_slug: "financial" },
    ],
  },
  {
    id: "cat-fuel",
    slug: "fuel",
    name: "Fuel",
    name_he: "דלק",
    color: "#F44336",
    icon: "fuel",
    is_transfer: false,
    subcategories: [],
  },
  {
    id: "cat-transfers",
    slug: "transfers",
    name: "Transfers",
    name_he: "העברות כסף",
    color: "#9E9E9E",
    icon: "arrow-right-arrow-left",
    is_transfer: true,
    subcategories: [
      { id: "cat-transfers-paybox", slug: "transfers-paybox", name: "PayBox / Bit", name_he: "פייבוקס / ביט", parent_slug: "transfers" },
      { id: "cat-transfers-family", slug: "transfers-family", name: "Family Transfers", name_he: "העברות משפחתיות", parent_slug: "transfers" },
    ],
  },
  {
    id: "cat-other",
    slug: "other",
    name: "Other / Uncategorized",
    name_he: "אחר / לא מסווג",
    color: "#BDBDBD",
    icon: "question",
    is_transfer: false,
    subcategories: [],
  },
];

/** Lookup map: slug → color hex. Used in charts for consistent palette. */
export const CATEGORY_COLOR_MAP: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.slug, c.color]),
);

export function getCategoryColor(slug: string): string {
  return CATEGORY_COLOR_MAP[slug] ?? "#BDBDBD";
}
