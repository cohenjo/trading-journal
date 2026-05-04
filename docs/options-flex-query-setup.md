# IBKR Flex Query Setup for Options Income Dashboard

This runbook is a one-time manual setup for Jony. The backend can run with synthetic fixtures before these steps are complete:

```bash
cd apps/backend
uv run python scripts/flex_synthetic.py
uv run python scripts/flex_probe.py --synthetic
```

## 1. Create the Flex Queries

1. Sign in to IBKR Client Portal.
2. Open **Performance & Reports → Flex Queries**.
3. Choose **Create Flex Query**.
4. Set **Format** to **XML** and enable **Flex Web Service** access.
5. Create either one master query containing all sections below, or separate queries for Trades, Cash Transactions, Option EAE, Open Positions, and Account Information.
6. Use a date period that fits Phase 0 validation, or rely on the probe's `--from YYYY-MM-DD --to YYYY-MM-DD` flags. IBKR enforces roughly a 365-day request window.
7. Save each query and record its **Query ID**.

## 2. Fields to Select

The target mapping is documented in [Appendix A of the design doc](./options-income-dashboard-design.md#appendix-a-flex-field--schema-mapping). Select these fields where the IBKR UI exposes them.

### Trades / Trade Confirms

Tick at least:

- `tradeID`
- `transactionID`
- `accountId`
- `dateTime`, `tradeDate`, `tradeTime`
- `symbol`
- `underlyingSymbol`
- `putCall`
- `strike`
- `expiry`
- `multiplier`
- `quantity`
- `tradePrice` / `price`
- `proceeds`
- `commission` or `ibCommission`
- `netCash`
- `fifoPnlRealized`
- `buySell`
- `openCloseIndicator`
- `currency`
- optional audit fields: `ibExecID`, `orderID`, `description`, `assetCategory`, `conid`

### Cash Transactions

Tick at least:

- `transactionID`
- `accountId`
- `dateTime` or `date`
- `type`
- `description`
- `amount` or `netCash`
- `currency`
- optional audit fields: `tradeID`, `reportDate`

### Options Exercises, Assignments, and Expirations (Option EAE)

Tick at least:

- `tradeID`
- `transactionID`
- `accountId`
- `dateTime` or `reportDate`
- `symbol`
- `underlyingSymbol`
- `putCall`
- `strike`
- `expiry`
- `multiplier`
- `quantity`
- `type` or `action`
- `proceeds`
- `fifoPnlRealized`
- `currency`
- optional audit fields: `description`, `settlementDate`

### Open Positions

Tick at least:

- `accountId`
- `symbol`
- `underlyingSymbol`
- `putCall`
- `strike`
- `expiry`
- `multiplier`
- `position` or `quantity`
- `costBasis`
- `costPrice`
- `markPrice`
- `fifoPnlUnrealized`
- `currency`
- optional audit fields: `conid`, `description`, `openDateTime`

### Account Information

Tick at least:

- `accountId`
- `baseCurrency` or `currency`
- `netLiquidation`
- `availableFunds`
- `buyingPower`
- `maintenanceMarginRequirement` or `marginRequirement`

## 3. Obtain the Flex Web Service Token

1. Open **Performance & Reports → Flex Web Service Configuration**.
2. Generate or copy the current token.
3. If IBKR asks for IP restrictions, add the public IP of the machine that will run the worker. For local Phase 0, add Jony's current public IP if whitelisting is enabled.
4. Treat the token like a password. Do not paste it into GitHub issues, PRs, logs, or committed files.

## 4. Configure Local Environment

Create or update `apps/backend/.env` (never commit it):

```dotenv
IBKR_FLEX_TOKEN=...
IBKR_FLEX_QUERY_ID_TRADES=...
IBKR_FLEX_QUERY_ID_OPTION_EAE=...
IBKR_FLEX_QUERY_ID_CASH=...
IBKR_FLEX_QUERY_ID_POSITIONS=...
IBKR_FLEX_QUERY_ID_ACCOUNT_INFO=...
```

If a single master Flex query contains all sections, it is acceptable to reuse the same query ID for multiple variables during Phase 0.

For production/CI-style environments, set secrets instead of committing values:

```bash
gh secret set IBKR_FLEX_TOKEN
gh secret set IBKR_FLEX_QUERY_ID_TRADES
gh secret set IBKR_FLEX_QUERY_ID_OPTION_EAE
gh secret set IBKR_FLEX_QUERY_ID_CASH
gh secret set IBKR_FLEX_QUERY_ID_POSITIONS
gh secret set IBKR_FLEX_QUERY_ID_ACCOUNT_INFO
```

## 5. Verify the Probe

Synthetic first:

```bash
cd apps/backend
uv run python scripts/flex_synthetic.py
uv run python scripts/flex_probe.py --synthetic
```

Live probe after the token and query IDs are configured:

```bash
cd apps/backend
set -a && source .env && set +a
uv run python scripts/flex_probe.py --account U1234567 --from 2025-01-01 --to 2025-12-31
```

The probe writes raw XML to `apps/backend/tmp/flex/` and prints one Python dict summary. Confirm that `row_counts` includes `TradeConfirms`, `CashTransactions`, `OpenPositions`, `OptionEAE`, and `AccountInformation`, then compare one known rolled spread against the broker statement to the cent.

## 6. Multi-year Backfill

After issue #245 is complete and the Flex Web Service token/query IDs are configured, backfill historical dashboard facts one account at a time. The backfill command chunks the requested range into calendar-year windows because IBKR Flex requests are typically capped at roughly 365 days.

```bash
cd apps/backend
set -a && source .env && set +a
uv run python scripts/backfill_options.py --start 2021-01-01 --end 2024-12-31 --account U1234567
```

Use `--year 2021` for a single calendar-year retry, and `--dry-run` to parse/run the worker chain while rolling back database writes:

```bash
uv run python scripts/backfill_options.py --year 2021 --account U1234567 --dry-run
```

Synthetic fixtures cover 2021-2025 for smoke testing only: 2021-2024 include one distinct trade per year to exercise chunking, and the existing 2025 worked example remains the richer reconciliation fixture. Real historical data still requires Jony to complete the IBKR.com Flex Query setup in issue #245.

## 7. Troubleshooting

- **No token configured:** `flex_probe.py` intentionally falls back to synthetic fixtures so Phase 1 can continue in parallel.
- **Token expired or revoked:** generate a new token in Flex Web Service Configuration and update `apps/backend/.env` or GitHub secrets.
- **IP not whitelisted:** add the worker's current public IP in IBKR's Flex Web Service Configuration, or temporarily disable IP restriction if acceptable.
- **Query ID typo:** re-copy the Query ID from the Flex Queries page and verify it is in the matching `IBKR_FLEX_QUERY_ID_*` variable.
- **1019 Statement generation in progress:** the probe polls `GetStatement`; if it times out, retry with a smaller date range or increase `--max-polls`.
- **365-day range failure:** rerun the command with `--year YYYY`, or use a narrower `--start/--end` range for the affected year.
- **Missing fields:** edit the Flex Query and tick every field in Appendix A; rerun the probe and inspect `tmp/flex/*.xml`.
