---
description: 'Main repository instructions for GitHub Copilot interactions'
---

# Trading Journal Application - Copilot Instructions

This is a financial trading journal application with a TypeScript/React frontend and Python backend. Apply these guidelines to all development work.

## Project Overview

- **Frontend**: React with TypeScript, using lightweight-charts for charting
- **Backend**: Python with FastAPI/Django, managed with uv
- **Database**: PostgreSQL with CSV/XLSX data import capabilities
- **Deployment**: Docker and docker-compose for local development
- **Purpose**: Personal financial trading journal and investment decision support

## Core Development Principles

1. **Data Integrity**: Financial data accuracy is critical - always validate data imports and calculations
2. **Performance**: Charts and data visualization should be responsive and handle large datasets
3. **Security**: Protect financial data with proper authentication and secure practices
4. **Maintainability**: Write clean, well-documented code for long-term personal use
5. **Testing**: Test financial calculations and data processing thoroughly

## File Structure Guidelines

Refer to the specific instruction files for detailed standards:
- [TypeScript/React Guidelines](./.github/instructions/typescript.instructions.md)
- [Python Backend Guidelines](./.github/instructions/python.instructions.md)
- [Testing Standards](./.github/instructions/testing.instructions.md)
- [Security Guidelines](./.github/instructions/security.instructions.md)
- [Performance Guidelines](./.github/instructions/performance.instructions.md)
- [Code Review Standards](./.github/instructions/code-review.instructions.md)
- [Documentation Standards](./.github/instructions/documentation.instructions.md)

## Trading Domain Context

When working with financial data:
- Use appropriate decimal precision for monetary values
- Handle market hours and timezone conversions correctly
- Implement proper risk calculation formulas
- Support multiple asset classes (stocks, options, bonds, etc.)
- Consider tax implications in calculations

## Development Workflow

1. Use the [Architecture Planning Agent](./.github/agents/architect.agent.md) for major feature planning
2. Follow [Setup Component Prompt](./.github/prompts/setup-component.prompt.md) for new components
3. Use [Testing Prompts](./.github/prompts/write-tests.prompt.md) for comprehensive test coverage
4. Apply [Code Review Guidelines](./.github/instructions/code-review.instructions.md) before merging

## Quick Setup

For new development environment setup, run the GitHub Actions workflow or follow these steps:

**Frontend:**
```bash
cd apps/frontend
npm install
npm run dev
```

**Backend:**
```bash
cd apps/backend
uv sync
uv run python main.py
```

**Database:**
```bash
docker-compose up -d
```

Refer to the project README.md for detailed setup instructions.