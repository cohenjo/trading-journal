**Arnona (ארנונה) — property tax:**
- Extracted as `הנורא` (reversed ארנונה).
- Very specific to Israeli context (municipal tax billed by the Iriya).
- Weight 0.98 (highest in housing subcategories) — extremely specific keyword.

**Va'ad Bayit (ועד בית) — building HOA:**
- Extracted as `תיב דעו` (reversed ועד בית).
- Israel-specific term for building committee / HOA.
- Regex pattern allows English variants: `va'?ad\s*ba?yit`.

**Home insurance context patterns:**
- Used conjunction pattern: `(provider).*הריד` (reversed דירה = dwelling).
- Ensures we don't capture vehicle/life insurance from the same providers.
- Weight 0.9 — high but below utilities (arnona/water) due to context ambiguity.

**Sector mapping for municipal:**
- `ינוריע` (reversed עירוני = municipal) maps to `("housing", "housing-property-tax")`.
- This is a two-tier tuple: top-level category + subcategory.
- Follows the Transportation pattern (sector directly maps to subcategory).

**Display order:**
- Housing given display_order 12 (between Transfers=10 and Other=99).
- Leaves room for future categories (e.g., Pets, Insurance as top-level).

**Migration idempotency verification:**
- `INSERT 0 1` = new parent already exists (ON CONFLICT DO NOTHING).
- `UPDATE 1` = updated parent metadata (display_order, color, icon).
- `INSERT 0 7` = 7 new subcategories already exist (ON CONFLICT DO NOTHING).
- `UPDATE 7` = updated all 7 subcategories (metadata refresh).
- Pattern allows re-running safely — no duplicate UUIDs, no lost data.
