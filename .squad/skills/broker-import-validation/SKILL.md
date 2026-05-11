# Skill: Broker File Import Validation via Supabase Post-State Diff

## Summary

Reusable pattern for end-to-end validation of broker CSV/XLS import flows in the trading journal. Tests the full pipeline: file upload → server action → Supabase → DB post-state assertion.

**Established by:** Redfoot (Tester), 2026-05-11, PR #394 LURVG validation.

---

## Pattern: End-to-End Import Validation with Ephemeral Account

### Why this approach?

- Production data (account_id=71 Schwab, account_id=72 Leumi) must not be modified during testing
- The server action `importManualPositionsCsv` uses RLS — the test user must own the target account
- Playwright `setInputFiles()` works on hidden file inputs (`type="file" class="hidden"`)

### Steps

**1. Provision ephemeral test account (admin client)**
```typescript
const householdId = await ensureHousehold(userId, 'individual');
const { data } = await admin.from('trading_account_config').insert({
  household_id: householdId,
  account_type: 'schwab', // or 'ira'
  name: 'e2e-lurvg-test',
  host: 'e2e-test-host',
  port: 9999,
  client_id: 0,
  compute_options_income: false,
}).select('id').single();
const accountId = data.id;
```

**2. Navigate, click correct tab, upload**
```typescript
await page.goto('/trading/accounts');
await page.waitForLoadState('networkidle');
await page.getByTestId('account-tab-schwab').click(); // MUST click tab — URL param has no effect
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

const fileInput = page.getByTestId('csv-file-input');
await fileInput.setInputFiles('/path/to/file.csv'); // works on hidden input
```

**3. Wait for feedback**
```typescript
const feedback = page.getByTestId('import-feedback');
await feedback.waitFor({ timeout: 15000 });
const text = await feedback.textContent();
// Success: "Imported N positions"
// Failure: "Unable to reach import endpoint" (P0 bug), "Import failed: ..." (RLS error)
```

**4. Post-state DB assertion (admin client bypasses RLS)**
```typescript
const { data: positions } = await admin
  .from('stock_positions')
  .select('ticker, description, mark_price, dividend_yield, currency, market_value_local')
  .eq('account_id', accountId);

expect(positions.length).toBeGreaterThan(0);
expect(positions.filter(p => p.description).length).toBeGreaterThan(0);
expect(positions.filter(p => p.mark_price != null).length).toBeGreaterThan(0);
```

**5. Cleanup (finally block)**
```typescript
await admin.from('stock_positions').delete().eq('account_id', accountId);
await admin.from('trading_account_config').delete().eq('id', accountId);
```

---

## Schema Facts (as of 2026-05-11)

### `stock_positions` key columns
| Column | Type | Notes |
|--------|------|-------|
| ticker | text NOT NULL | Ticker symbol or TASE paper number |
| description | text NULL | Security name / Hebrew paper name |
| mark_price | numeric NULL | Snapshot price from broker export |
| dividend_yield | numeric(8,6) NULL | Annual yield as decimal (0.1664 = 16.64%) |
| market_value_local | numeric(18,4) NULL | ILS value for Leumi; null for USD accounts |
| listing_exchange | text NULL | 'TASE', 'US', 'LSE' — NOT populated by Leumi import (gap) |
| currency | text NOT NULL | 'ILA' for TASE, 'USD' for US, 'GBP' for LSE |

### `trading_account_config` required columns
| Column | Type | Notes |
|--------|------|-------|
| host | text NOT NULL | Use 'e2e-test-host' for test configs |
| port | int NOT NULL | Use 9999 |
| client_id | int NOT NULL | Use 0 |
| compute_options_income | bool NOT NULL | Use false |
| account_type | text NOT NULL | 'ibkr', 'schwab', 'ira' |
| household_id | uuid | From ensureHousehold() |

---

## Broker-Specific Assertions

### Schwab CSV
- All positions: `currency = 'USD'`
- Sentinel rows skipped: "Cash & Cash Investments", "Positions Total", "--", blank symbol
- `dividend_yield` present for dividend payers (JEPI: 0.1664, O: ~0.05)
- No `market_value_local` (USD-only account)
- `exchange` not in CSV → `listing_exchange` remains NULL

### Leumi XLS (IRA)
- TASE numeric tickers (all-digit): should have Hebrew description containing `[\u0590-\u05FF]`
- 8-digit TASE IDs starting with '6': foreign securities, description is English ticker (not Hebrew)
- `currency = 'ILA'` for TASE holdings
- `market_value_local` = ILS-denominated holding value (in agorot)
- `listing_exchange` NOT populated (gap in `holdingsToCsv()`)

### Hebrew RTL UI Assertion
```typescript
const rtlSpans = page.locator('span[dir="rtl"]');
const count = await rtlSpans.count();
expect(count).toBeGreaterThan(0);
const firstText = await rtlSpans.first().textContent();
// Should be Hebrew string, e.g. "מיטב השקעות"
```

---

## P0 Bug Pattern (repaired in PR #394)

**Symptom:** "Unable to reach import endpoint" on Vercel.

**Root cause:** `fetch('/api/accounts/.../import')` called from a `'use server'` action — Node native fetch requires absolute URLs; relative URLs throw `TypeError: Invalid URL`.

**Detection in tests:**
```typescript
const fnStart = actionsText.indexOf('export async function importManualPositionsCsv(');
const fnBody = actionsText.slice(fnStart, nextFnStart);
expect(/fetch\(`\/api\/accounts\//.test(fnBody)).toBe(false);
expect(fnBody.includes("createClient()")).toBe(true);
expect(fnBody.includes("'stock_positions'") && fnBody.includes(".insert(")).toBe(true);
```

---

## Known Gotchas

| Gotcha | Mitigation |
|--------|-----------|
| `activeTab` defaults to `"ibkr"`, URL `?account=schwab` ignored | Always click `getByTestId('account-tab-schwab')` before upload |
| `trading_account_config` NOT NULL columns | Include host/port/client_id/compute_options_income in insert |
| `stock_positions` has `listing_exchange`, NOT `exchange` | Use `listing_exchange` in queries |
| Import button only renders when account config loaded + tab active | Navigate + click tab + waitForLoadState before checking button |
| `setInputFiles` works on hidden inputs | Use `page.getByTestId('csv-file-input').setInputFiles(path)` directly |
| Ephemeral user "deleteE2eUser" fails with DB error | Non-critical, positions cleanup in finally block is sufficient |

---

## Reference

- First application: `e2e/lurvg-pr394-import-endpoint.spec.ts` (2026-05-11)
- Related: `.squad/skills/leumi-xls-import/SKILL.md`
- Server action: `apps/frontend/src/app/trading/actions.ts` → `importManualPositionsCsv`
- CSV format: `apps/frontend/src/lib/trading/leumi-xls-parser.ts` → `holdingsToCsv()`
