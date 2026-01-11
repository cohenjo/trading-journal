---
description: 'Testing standards and practices for trading journal application'
applyTo: '**/*.test.ts,**/*.test.tsx,**/*.test.py,**/*.spec.ts,**/*.spec.tsx'
---

# Testing Guidelines

Comprehensive testing strategy for a financial application where accuracy is critical.

## Frontend Testing (React/TypeScript)

- Use React Testing Library for component testing
- Test user interactions and trading workflows
- Mock chart libraries to focus on component logic
- Test error states and loading conditions
- Verify financial calculations in components

## Backend Testing (Python)

- Use pytest for all Python testing
- Write unit tests for financial calculations
- Test data validation and error handling
- Create integration tests for database operations
- Mock external market data APIs

## Financial Calculation Testing

- Test all monetary calculations with known expected results
- Verify precision and rounding behavior
- Test edge cases like zero positions and negative values
- Validate tax calculation accuracy
- Test portfolio performance metrics

## Data Import Testing

- Test CSV and XLSX parsing with sample files
- Verify data validation and error reporting
- Test handling of malformed input data
- Validate data type conversions
- Test large file processing performance

## API Testing

- Test all endpoints with valid and invalid data
- Verify authentication and authorization
- Test error responses and status codes
- Validate request/response data structures
- Test rate limiting and security measures

## Database Testing

- Use test database fixtures
- Test data integrity constraints
- Verify migration scripts work correctly
- Test query performance with realistic data volumes
- Validate backup and restore procedures

## End-to-End Testing

- Test complete trading workflows
- Verify chart rendering and interactions
- Test data import and processing pipelines
- Validate user authentication flows
- Test responsive design on different devices

## Test Data Management

- Use realistic but anonymized trading data
- Create fixtures for common test scenarios
- Maintain test data that represents edge cases
- Keep test databases isolated and clean

## Coverage Requirements

- Aim for 90%+ coverage on financial calculations
- Ensure all error paths are tested
- Cover both happy path and error scenarios
- Test security vulnerabilities and edge cases

## Performance Testing

- Test chart rendering with large datasets
- Validate API response times under load
- Test database query performance
- Verify memory usage with large data imports