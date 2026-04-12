# Pension Upload Bugs Fixed — Session 2026-03-07

**Timestamp:** 2026-03-07T20:18:16Z  
**Agents:** Redfoot (Tester), Hockney (Backend Dev)  
**Requested by:** Jony  
**Outcome:** Both bugs fixed; all tests passing (17/17)

## Bug Fixes

### Bug 1: Invisible Pension After Upload
- **Problem:** Pensions parsed from older report dates were not visible on the dashboard dashboard reads only the latest snapshot (`snapshots[-1]`)
- **Root Cause:** Upload endpoint only upserted into the report-date snapshot, not the latest snapshot
- **Fix:** Propagate pension data to the latest snapshot when dates differ, ensuring dashboard visibility immediately after upload
- **Verification:** Redfoot's regression tests validate dual-snapshot upsert; all 14 pension tests passing

### Bug 2: Zero-Value Complementary Pension (Hebrew RTL)
- **Problem:** Complementary pensions (מקיפה משלימה) uploaded with 0 ILS total due to AI extraction failure
- **Root Cause:** Hebrew RTL text in PDF was garbled during extraction, causing AI model to return null for Total Amount
- **Fix:** Enhanced copilot_analyzer system prompt with explicit RTL handling (reversal guidance, Hebrew keyword patterns, self-validation heuristic for suspicious values)
- **Verification:** Zero-value detection now flagged with warnings in API response; tests pin behavior

## Test Coverage

- **Regression tests added:** 8 (Redfoot)
- **Total pension tests:** 14 (5 original + 8 regression + 1 spouse)
- **Pass rate:** 17/17 (100%)

## Patterns Applied

- **Snapshot propagation:** When data must appear in dashboard immediately, upsert to both historical and latest snapshots
- **Zero-value warnings:** Detect and flag suspicious values; propagate to frontend via response warnings
- **RTL text handling:** Explicit AI prompt guidance for right-to-left language extraction, with numeric heuristics as fallback
