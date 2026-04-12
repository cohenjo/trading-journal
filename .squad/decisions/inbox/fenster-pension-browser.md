# Decision: Pension Historical Report Browser

**Author:** Fenster (Frontend Dev)
**Date:** 2025-07-22
**Issue:** #13

## Context

The pension page only showed the latest uploaded report. Users need to browse historical reports to track retirement progress over time and compare changes between periods.

## Decision

### Backend
- Added `GET /api/pension/reports` endpoint that returns:
  - List of uploaded PDF files with metadata (filename, owner, upload timestamp, size)
  - Per-snapshot pension totals derived from `FinanceSnapshot` records, including per-account breakdowns

### Frontend
- **ReportHistory** component: timeline sidebar showing all pension snapshots with total values, delta badges comparing to previous snapshot, expandable per-account details, and a collapsible uploaded files list
- **SnapshotDetail** component: full-width detail view when a snapshot is clicked, showing per-account table with value, deposits, earnings, fees, and delta vs previous period
- Layout changed from 2-col to 3-col grid (lg breakpoint) to accommodate history panel alongside upload + results

### Architecture Notes
- No new DB models — reports endpoint reads existing `FinanceSnapshot` records and scans the `reports/` directory for file metadata
- No i18n added (pension page doesn't use i18n patterns)
- Currency formatting follows existing `he-IL` / `ILS` convention
- All new components are `'use client'` to match existing pension page pattern

## Alternatives Considered

1. **Store reports in DB**: Adds model complexity; filesystem scan is sufficient for MVP since files are already saved on upload
2. **Separate page for history**: Rejected — inline panel provides faster context switching without losing dashboard view
