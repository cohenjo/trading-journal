---
name: rls-crud-endpoints
description: Scaffold RLS-protected CRUD endpoints with household scoping
author: Hockney (Backend Dev)
created: 2026-05-01
tags: [backend, fastapi, rls, security, household]
---

# RLS-Protected CRUD Endpoint Scaffolding

A reusable pattern for creating household-scoped CRUD endpoints with Row Level Security (RLS) policies in FastAPI + Supabase applications.

## When to Use This Pattern

Use this pattern when:
- Migrating features from mock/file storage to DB tables
- Creating new user-facing features that require data isolation
- Building endpoints that need household-scoped access control
- Implementing multi-tenant data access with RLS enforcement

## The Pattern

See `.squad/decisions/inbox/hockney-wave2b-architecture.md` for the complete recipe with:
- Migration script template
- SQLModel schema template
- FastAPI router template
- Service layer conventions
- Testing checklist

## Key Principles

1. **Authentication:** Always use `get_current_user_id` dependency
2. **Household Lookup:** Fetch via `household_service.get_user_household_id()`
3. **Authorization:** Check household_id match on mutations
4. **Filtering:** Filter by `deleted_at.is_(None)` on reads
5. **Soft Delete:** Use soft-delete (set deleted_at)
6. **Error Codes:** 403 for household mismatch, 404 for not found

## Applied Examples

- Bond Holdings (PR #129) — migrated from in-memory mock
- Dividend Positions (PR #129) — migrated from XLSX file
- Insurance Policies (PR #123) — user-scoped from day 1
- Finance Snapshots (PR #123) — pension data

## References

- [Wave 2b Architecture Recipe](.squad/decisions/inbox/hockney-wave2b-architecture.md)
- [Hockney History](../.squad/agents/hockney/history.md#2026-05-01-wave-2b--holdings--dividends-db-migration-pr-129)
