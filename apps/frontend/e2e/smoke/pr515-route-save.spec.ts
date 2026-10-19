import { execFileSync } from 'node:child_process';
import { test, expect } from '../fixtures/test-user';
import { getAdminClient } from '../fixtures/admin';

/**
 * Validate real Next.js routes and household-scoped server-action persistence.
 * Run only in the existing provider-managed E2E environment; never load local secrets.
 */
test('PR515 actual RSU routes save and reload @smoke', async ({ testUser: { page, householdId } }, testInfo) => {
  test.setTimeout(120_000);
  const admin = getAdminClient();
  const source = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const serverFailures: number[] = [];
  page.on('response', response => {
    if (response.status() >= 500 && new URL(response.url()).origin === 'http://localhost:3000') {
      serverFailures.push(response.status());
    }
  });
  const { data: quote, error: quoteError } = await admin.from('price_cache')
    .select('symbol, price, currency, dividend_yield')
    .eq('currency', 'USD').not('dividend_yield', 'is', null).limit(1).maybeSingle();
  expect(quoteError).toBeNull();
  expect(quote, 'Existing USD cache quote with dividend metadata is required; shared cache is never mutated').not.toBeNull();
  if (!quote) throw new Error('No approved existing USD cache fixture');
  const price = Number(quote.price);
  const yieldRate = Number(quote.dividend_yield);
  const today = new Date().toISOString().slice(0, 10);
  const item = {
    id: 'redfoot-rsu-snapshot', name: 'Redfoot RSU snapshot', category: 'Investments',
    type: 'RSU', owner: 'You', currency: 'USD', value: price * 1.25,
    details: {
      stock_symbol: quote.symbol, current_price: price, dividend_yield: yieldRate,
      dividend_tax_rate: 25, dividend_policy: 'Payout',
      rsu_grants: [{ id: 'redfoot-grant', year: 2026, shares: 2, vested: 1.25, price: 100 }],
    },
  };
  const { error: seedError } = await admin.from('finance_snapshots').upsert({
    household_id: householdId, date: today,
    data: { items: [item], net_worth: item.value, total_assets: item.value,
      total_liabilities: 0, total_savings: 0, total_investments: item.value },
  }, { onConflict: 'household_id,date' });
  expect(seedError).toBeNull();

  await page.goto('/current-finances');
  await expect(page.getByRole('heading', { name: 'Current Finances', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/current-finances');
  const tabs = page.getByRole('button').filter({ has: page.locator('span', { hasText: /^(Savings|Investments|Assets|Liabilities|Priorities)$/ }) });
  await expect(tabs).toHaveCount(5);
  await page.getByRole('button', { name: /^Investments/ }).click();
  await page.getByTitle('Edit', { exact: true }).click();
  await expect(page.getByPlaceholder('e.g. GOOGL')).toHaveValue(quote.symbol);
  await expect(page.getByPlaceholder('0.00', { exact: true })).toHaveValue(String(price));
  await expect(page.getByText(/Cached price (refreshed|is stale)/).first()).toBeVisible();
  await page.getByPlaceholder('Vested', { exact: true }).fill('1.5');
  const snapshotSave = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/current-finances' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await snapshotSave).status()).toBe(200);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => {
    const { data, error } = await admin.from('finance_snapshots').select('data')
      .eq('household_id', householdId).eq('date', today).single();
    if (error) throw new Error('Snapshot persistence read failed');
    return data.data.items[0].details;
  }).toMatchObject({
    current_price: price, dividend_yield: yieldRate, dividend_tax_rate: 25,
    dividend_policy: 'Payout', rsu_grants: [{ vested: 1.5 }],
  });
  await page.reload();
  await page.getByRole('button', { name: /^Investments/ }).click();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
  await page.getByTitle('Edit', { exact: true }).click();
  await expect(page.getByPlaceholder('Vested', { exact: true })).toHaveValue('1.5');
  await expect(page.getByPlaceholder('0.00', { exact: true })).toHaveValue(String(price));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  const { data: plan, error: planError } = await admin.from('plans').insert({
    household_id: householdId, name: 'Redfoot validation',
    data: { items: [{
      id: 'redfoot-rsu-plan', name: 'Redfoot RSU plan', category: 'Account',
      sub_category: 'RSU', owner: 'You', value: price * 1.25, currency: 'USD',
      frequency: 'Yearly', account_settings: {
        type: 'RSU', stock_symbol: quote.symbol, current_price: price,
        dividend_yield: yieldRate, dividend_tax_rate: 25, dividend_policy: 'Payout',
        rsu_grants: [{ id: 'plan-grant', vested: 1.25, shares: 2, year: 2026, price: 100 }],
      },
    }], milestones: [], settings: {} },
  }).select('id').single();
  expect(planError).toBeNull();
  expect(plan).not.toBeNull();
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: /^Redfoot RSU plan/ })).toBeVisible();
  const planRow = page.locator('div.group').filter({ has: page.getByRole('heading', { name: /^Redfoot RSU plan/ }) });
  await expect(planRow).toHaveCount(1);
  await planRow.locator('button').first().click();
  for (const id of ['rsu-ticker-input', 'rsu-dividend-yield-auto', 'rsu-dividend-tax-rate']) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).toHaveCount(1);
  }
  await expect(page.getByTestId('rsu-ticker-input')).toHaveValue(quote.symbol);
  await expect(page.getByTestId('rsu-dividend-yield-auto')).toContainText(`${yieldRate.toFixed(2)}%`);
  await expect(page.getByText(/Cached price (refreshed|is stale)/).first()).toBeVisible();
  await page.getByTestId('rsu-dividend-tax-rate').fill('26');
  const planSave = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/plan' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await planSave).status()).toBe(200);
  await expect(page.getByText('Plan not saved', { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const { data, error } = await admin.from('plans').select('data').eq('id', plan!.id).single();
    if (error) throw new Error('Plan persistence read failed');
    return data.data.items[0].account_settings.dividend_tax_rate;
  }).toBe(26);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Redfoot RSU plan/ })).toBeVisible();
  await page.locator('div.group').filter({ has: page.getByRole('heading', { name: /^Redfoot RSU plan/ }) }).locator('button').first().click();
  await expect(page.getByTestId('rsu-dividend-tax-rate')).toHaveValue('26');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(serverFailures).toEqual([]);
  const dom = await page.getByTestId('rsu-ticker-input').evaluate(element => element.outerHTML);
  const evidence = { source, routes: ['/current-finances', '/plan'], snapshotTabs: 5,
    testids: ['rsu-ticker-input', 'rsu-dividend-yield-auto', 'rsu-dividend-tax-rate'],
    saves: 'HTTP 200, database verified, reload verified', errorBannerCount: 0,
    successBanner: 'Neither route implements a success banner; persisted state verified instead',
    pageErrors: errors.length, serverFailures: serverFailures.length, dom };
  console.log('REDFOOT_LURVG', JSON.stringify(evidence));
  await testInfo.attach('redfoot-route-save-evidence', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
});
