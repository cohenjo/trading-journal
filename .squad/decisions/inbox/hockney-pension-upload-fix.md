### 2025-07-19: Pension Upload — Latest Snapshot Propagation & Zero-Value Warnings
**By:** Hockney
**Category:** Data Integrity, AI Analyzer Reliability
**Status:** Implemented

**What:**
1. Pension uploads now upsert into BOTH the report-date snapshot AND the latest snapshot (when they differ). This ensures pensions appear on the dashboard immediately after upload, even when later monthly snapshots exist in the database.
2. The upload response now includes a `warnings` field when suspicious data is detected (e.g., Total Amount is 0 but sub-fields like earnings/fees are non-zero). This helps the frontend alert users to possible AI extraction failures.
3. The copilot_analyzer system prompt was expanded with Hebrew RTL text handling guidance, common reversed-keyword patterns, and a self-validation step for the AI model.

**Why:**
- Dashboard's `_latest_active_pensions()` only reads the last snapshot. Without propagation, historical uploads are invisible.
- Hebrew RTL garbling in pdfplumber caused the AI to return null/0 for Total Amount on complementary pension reports. Better prompting and validation reduces silent data loss.

**Impact:**
- Upload response contract adds optional `warnings: list[str]` and `latest_snapshot_updated: bool` fields (additive, non-breaking).
- Frontend may want to display warnings to the user when present.
- No schema/migration changes needed.
