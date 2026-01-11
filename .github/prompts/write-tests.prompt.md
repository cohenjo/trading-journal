---
agent: 'agent'
model: 'Claude Sonnet 4'
tools: ['edit', 'search', 'execute']
description: 'Generate comprehensive tests for trading journal features'
---

# Trading Journal Test Generator

Generate thorough test suites for financial application components and functions.

## Test Requirements

**Ask for test scope if not provided:**
- Component/function to test
- Financial calculations involved
- Data processing requirements
- User interaction scenarios
- Error conditions to cover

## Frontend Testing (React/TypeScript)

**React Testing Library Standards:**
- Test user interactions and workflows
- Focus on behavior, not implementation
- Mock chart library components appropriately
- Test accessibility and keyboard navigation

**Financial Component Testing:**
- Test monetary calculations with known results
- Verify precision and rounding behavior
- Test edge cases (zero, negative values)
- Validate input validation and error states

**Chart Component Testing:**
- Mock lightweight-charts library
- Test data updates and streaming
- Verify chart configuration changes
- Test performance with large datasets

## Backend Testing (Python)

**Financial Logic Testing:**
- Test all monetary calculations with decimal precision
- Verify tax calculation accuracy
- Test portfolio performance metrics
- Validate risk calculation formulas

**Data Processing Testing:**
- Test CSV and XLSX import functionality
- Validate data transformation logic
- Test error handling for malformed data
- Verify batch processing performance

**API Testing:**
- Test all endpoints with valid/invalid data
- Verify authentication and authorization
- Test error responses and status codes
- Validate request/response serialization

## Test Data Requirements

**Realistic Financial Data:**
- Use anonymized but realistic trading data
- Include edge cases and unusual scenarios
- Test with different asset types
- Include historical and real-time data patterns

**Test Fixtures:**
- Create reusable test data sets
- Include valid and invalid data examples
- Mock external API responses
- Provide database fixtures

## Test Structure Template

**Frontend Tests:**
```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup test environment
  });

  it('should handle financial calculations correctly', () => {
    // Test with known expected results
  });

  it('should handle error states gracefully', () => {
    // Test error scenarios
  });
});
```

**Backend Tests:**
```python
def test_financial_calculation():
    """Test monetary calculation with known expected result."""
    # Arrange
    # Act
    # Assert
    pass
```

## Coverage Requirements

- 90%+ coverage for financial calculations
- 100% coverage for security-critical paths
- Test all error conditions and edge cases
- Include integration tests for data flow
- Performance tests for large datasets

## Validation Steps

- Run all tests and verify they pass
- Check test coverage reports
- Verify test data accuracy
- Test performance with realistic data volumes
- Validate error handling scenarios