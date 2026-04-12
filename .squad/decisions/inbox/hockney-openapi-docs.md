# Decision: Add OpenAPI metadata and route docstrings

**Author:** Hockney (Backend Dev)
**Date:** 2025-07-22
**Issue:** #12

## Context

FastAPI auto-generates `/docs` (Swagger UI) and `/redoc` endpoints, but the generated spec lacked proper API metadata and many route handlers had no docstrings — resulting in a bare, undocumented schema.

## Decision

1. Added OpenAPI metadata to the `FastAPI()` constructor: title, description, version, and explicit `docs_url`/`redoc_url`.
2. Added concise docstrings to all route handler functions across 17 router files that were missing them.
3. No `response_model` additions were needed — all typed routes already had them; untyped routes return dynamic dicts where adding a model would change behavior.
4. No business logic was changed.

## Rationale

- Docstrings automatically populate the OpenAPI operation summaries, making `/docs` and `/redoc` immediately useful for frontend devs and future API consumers.
- Keeping docstrings to 1–2 lines avoids clutter while giving each endpoint a clear purpose statement.
- Explicit `docs_url`/`redoc_url` makes the configuration self-documenting even though they match FastAPI defaults.

## Impact

- `/docs` and `/redoc` now show a titled, described API with per-endpoint summaries.
- No runtime behavior change. All 238 passing tests remain green (2 pre-existing failures require PostgreSQL).
