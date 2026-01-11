<!-- Based on: https://github.com/github/awesome-copilot/blob/main/instructions/typescript-5-es2022.instructions.md -->
<!-- and: https://github.com/github/awesome-copilot/blob/main/instructions/reactjs.instructions.md -->
---
description: 'TypeScript and React development standards for trading journal application'
applyTo: '**/*.ts,**/*.tsx,**/*.js,**/*.jsx'
---

# TypeScript & React Development Guidelines

Target TypeScript 5.x with ES2022 features for modern React development.

## Core TypeScript Principles

- Use TypeScript strict mode with explicit types
- Avoid `any` - prefer `unknown` with type narrowing
- Use discriminated unions for trading events and state machines
- Centralize shared interfaces instead of duplicating types
- Express intent with utility types (`Readonly`, `Partial`, `Record`)

## React Component Standards

- Use functional components with hooks exclusively
- Follow React hooks rules (no conditional hooks)
- Keep components small and focused on single responsibility
- Use custom hooks for reusable stateful logic
- Implement proper prop validation with TypeScript interfaces

## Financial Data Types

- Use `Decimal` or `BigNumber` for monetary calculations
- Define strict types for trade data, positions, and market data
- Create union types for different asset classes and trade types
- Use branded types for identifiers (TradeId, AccountId, etc.)

## Chart Integration (lightweight-charts)

- Create typed interfaces for chart data series
- Use proper TypeScript definitions for chart configurations
- Implement chart event handlers with correct typing
- Handle real-time data updates with immutable patterns

## Error Handling

- Use structured error types for trading operations
- Implement Result<T, E> patterns for fallible operations
- Handle async operations with try/catch and proper error boundaries
- Validate financial data at runtime with type guards

## Performance Considerations

- Use `React.memo` for expensive chart components
- Implement virtualization for large trade lists
- Use `useMemo` and `useCallback` for chart calculations
- Optimize re-renders when processing real-time market data

## Security Practices

- Sanitize user inputs before rendering
- Use TypeScript's template literal types for SQL-safe strings
- Validate API responses with runtime type checking
- Never store sensitive data in localStorage

## File Organization

- Use kebab-case for filenames (`trade-summary.component.tsx`)
- Group related trading features in feature folders
- Keep chart components separate from data processing logic
- Create shared types in a dedicated `types/` directory

## Testing Requirements

- Write tests for all financial calculations
- Mock chart library components in unit tests
- Test error states and edge cases thoroughly
- Use TypeScript in test files with proper typing