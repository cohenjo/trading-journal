# Contributing to Trading Journal

Thank you for contributing! This document covers the development workflow, secret-safety requirements, and PR process.

---

## Prerequisites

- **Node.js 20+** and **npm** (frontend)
- **Python 3.11+** and **uv** (backend)
- **Docker** (local stack)
- **pre-commit** (mandatory — see below)

---

## Setting Up Pre-Commit Hooks

All contributors **must** install pre-commit before pushing any code. The hooks prevent accidental commits of secrets, private keys, and `.env` files.

```bash
pip install pre-commit
pre-commit install
```

Verify the hooks are wired:

```bash
pre-commit run --all-files
```

### What the hooks check

| Hook | Purpose |
|------|---------|
| `detect-private-key` | Rejects PEM private keys |
| `reject-env-files` | Rejects `.env` files (only `.env.example` is allowed) |
| **`gitleaks`** | Scans for tokens, API keys, service-role keys, JWTs, etc. |
| `trailing-whitespace`, `end-of-file-fixer`, etc. | Standard formatting and linting |

> **Note:** The `no-commit-to-branch` hook has been removed. Direct commits to `main` are now allowed for low-risk changes. See [Development Workflow](#development-workflow) below.

---

## Environment Files

- **Do not commit** `.env`, `.env.local`, `.env.development.local`, or any real secrets file.
- **Safe to commit:** `.env.example`, `.env.*.example` — these contain only placeholder values.
- Copy `.env.example` to `.env` locally and fill in your own values.

---

## Development Workflow

### Commit Strategy

**Direct commits to `main` are OK for:**
- Low-risk changes (docs, typos, config tweaks)
- Single-file edits with clear scope
- Quick fixes that don't affect core logic

**PRs recommended for:**
- Multi-file changes
- Feature additions or refactors
- Changes that affect multiple components
- Anything requiring team review

**Worktrees encouraged** for parallel work:
```bash
git worktree add ../trading-journal-feature feature-branch
```

> **Note:** The `no-commit-to-branch` hook has been removed to support this workflow. All other security hooks (gitleaks, private key detection, etc.) remain active.

---

## Branch Naming

```
squad/{issue-number}-{kebab-case-slug}
```

Example: `squad/42-fix-login-validation`

---

## Pull Request Checklist

- [ ] `pre-commit run --all-files` passes locally
- [ ] No real credentials in any committed file
- [ ] Tests pass (`npm test` / `pytest`)
- [ ] PR description references the issue (`Closes #N`)

---

## CI Secret-Scanning Gate

Every PR runs **gitleaks** via `.github/workflows/secret-scan.yml`. This job is required to pass before merge. If it fails:

1. Remove or rotate the exposed credential immediately.
2. Rewrite history with `git filter-repo` or force-push if needed.
3. Contact Jony to trigger a full secret rotation.

---

## Reporting Security Issues

Do **not** open a public issue for security vulnerabilities. Contact Jony directly.
