### 2026-05-06: --xml-dir mode for manual Activity Flex backfills

**By:** Hockney (Backend Dev)

**What changed:**
Added a third input mode to the IBKR Flex options backfill orchestrator. The `backfill_options.py` script now accepts `--xml-dir DIR` to read Activity Flex Query XML files from a local directory instead of fetching from the live IBKR Flex Web Service API.

**Why:**
The live Flex Web Service path was failing with persistent `1001` throttle errors on multi-month Activity Flex Query requests for Jony's full historical backfill (2022–2025, query_id 1496910). IBKR's backend recovery window is 30–60 minutes; our 25-minute retry budget wasn't sufficient. Jony has direct UI access to IBKR Account Management and can manually run the Activity Flex Query for any date range and download the XML file in seconds, sidestepping the API entirely.

**Operational guidance:**

**Where users put files:**
- Place manual Activity Flex XML exports in `reports/activity/` (this directory is already gitignored, so files won't accidentally get committed).
- Files must follow IBKR's naming convention: `{accountId}_{accountId}_{YYYYMMDD}_{YYYYMMDD}_AF_{queryId}_{hash}.xml`
  - Example: `U2515365_U2515365_20240101_20241231_AF_1496910_19d7f4643e9c2a43ef511a0cd2f981e4.xml`
  - The two accountId fields repeat (master/sub account — for "Individual" accounts they're identical).
  - `AF` = Activity Flex (distinguishes from Trade Confirmation Flex, which uses `TC`).
  - The hash suffix is IBKR's internal checksum; ignore it.

**What --xml-dir does:**
1. Discovers XML files in the specified directory matching the pattern above.
2. Parses the embedded date range from each filename (two YYYYMMDD timestamps).
3. Filters files whose date range overlaps with the requested backfill window (`--start` and `--end`).
4. Feeds the matched files through the existing `parse_flex_files` → upsert pipeline (same code path as live/synthetic modes).
5. Skips inter-chunk sleep (no API calls = no throttle risk).

**What --xml-dir doesn't do:**
- Does NOT call the IBKR API. No network activity, no IBKR_FLEX_TOKEN required.
- Does NOT validate the XML schema beyond what the existing parser handles. If IBKR returns malformed XML, parsing will fail with a FlexParserError (same as live mode).
- Does NOT merge partial-year files automatically. If you have `2024-01-01 to 2024-06-30` and `2024-07-01 to 2024-12-31` as separate files, both will be ingested (idempotent upserts handle overlaps gracefully).

**Usage:**
```bash
cd apps/backend
uv run python scripts/backfill_options.py \
  --start 2022-01-01 --end 2024-12-31 \
  --xml-dir /Users/jocohe/projects/trading-journal/reports/activity \
  --chunk-months 12 --account U2515365
```

**Mode selection:**
- `--xml-dir DIR`: Manual XML drop (no API calls, for backfills)
- `--synthetic`: Test fixtures from `tmp/flex/` (for development)
- `--live`: Force live IBKR API fetch (requires IBKR_FLEX_TOKEN, for daily sync)
- Default (none): Auto-detects based on IBKR_FLEX_TOKEN presence

The three explicit modes are mutually exclusive. The script will error if more than one is specified.

**Caveats:**
- Manual XML exports from IBKR Account Management UI require interactive login. Can't be automated in CI or cron jobs — this mode is strictly for one-time backfills.
- Daily incremental sync (small windows, e.g., yesterday) should continue using the live API (`--live`). The 1001 throttle risk is low for single-day windows.
- If you manually export a multi-year file and the backfill script splits it into monthly chunks (`--chunk-months 1`), the same file will be parsed multiple times. This is safe (idempotent upserts) but not optimal for performance. Use `--chunk-months 12` for full-year exports to minimize re-parsing.

**Follow-ups:**
- None. Feature is complete and tested (433 tests passing, including 4 new --xml-dir tests from Redfoot).
- If we need to support Trade Confirmation Flex exports (pattern `*_TC_*` instead of `*_AF_*`), extend `_xml_dir_files` pattern matching. Not needed today — Activity Flex covers all options data.
