---
agent: 'agent'
model: 'Claude Sonnet 4'
tools: ['search', 'execute', 'problems', 'usages']
description: 'Debug issues in trading journal application with systematic approach'
---

# Trading Journal Debugging Assistant

Systematically debug issues in the trading journal application with focus on financial accuracy.

## Issue Analysis

**Gather issue details:**
- Error messages or unexpected behavior
- Steps to reproduce the problem
- Expected vs actual results
- Environment (development/production)
- Data involved (if financial calculations)

## Debugging Priorities

**Critical Issues (Address Immediately):**
1. Financial calculation errors
2. Data corruption or loss
3. Security vulnerabilities
4. Authentication failures
5. System crashes or downtime

**High Priority Issues:**
1. Chart rendering problems
2. Data import/export failures
3. Performance degradation
4. API endpoint errors
5. User interface bugs

## Financial Calculation Debugging

**Verification Steps:**
1. Check input data accuracy and types
2. Verify decimal precision handling
3. Test with known expected results
4. Check for floating-point arithmetic issues
5. Validate rounding behavior

**Common Financial Bugs:**
- Using float instead of Decimal for money
- Incorrect rounding or precision
- Currency conversion errors
- Tax calculation mistakes
- Portfolio metric calculation errors

## Frontend Debugging (React/TypeScript)

**Chart Issues:**
- Check lightweight-charts configuration
- Verify data format and structure
- Test with minimal dataset
- Check for memory leaks with large data
- Validate chart event handlers

**Component Debugging:**
- Use React Developer Tools
- Check component state and props
- Verify hook dependencies
- Test error boundary functionality
- Check TypeScript type errors

## Backend Debugging (Python)

**API Issues:**
- Check endpoint logs and errors
- Verify request/response data
- Test authentication and authorization
- Check database connections
- Validate serialization/deserialization

**Data Processing Issues:**
- Check file parsing logic
- Verify data validation rules
- Test with various input formats
- Check batch processing performance
- Validate database operations

## Database Debugging

**Query Issues:**
- Check SQL query execution plans
- Verify index usage
- Test with realistic data volumes
- Check for query timeouts
- Validate data integrity constraints

**Migration Problems:**
- Review migration scripts
- Check for data conflicts
- Verify schema changes
- Test rollback procedures
- Check for foreign key issues

## Performance Debugging

**Frontend Performance:**
- Use browser profiling tools
- Check for memory leaks
- Monitor chart rendering times
- Analyze bundle size and loading
- Test with large datasets

**Backend Performance:**
- Profile Python code execution
- Monitor database query performance
- Check API response times
- Analyze memory usage
- Test concurrent user scenarios

## Systematic Debugging Process

**Step 1: Reproduce the Issue**
```bash
# Create minimal reproduction case
# Document exact steps
# Capture error messages and logs
```

**Step 2: Isolate the Problem**
```bash
# Test individual components
# Check dependencies and integrations
# Verify environment configuration
```

**Step 3: Analyze Root Cause**
```bash
# Review recent code changes
# Check error logs and stack traces
# Test with different data sets
```

**Step 4: Implement Fix**
```bash
# Make minimal targeted changes
# Test fix with reproduction case
# Verify no regressions introduced
```

## Debugging Tools

**Frontend Tools:**
- React Developer Tools
- Browser DevTools
- TypeScript compiler
- ESLint and Prettier
- Storybook for component testing

**Backend Tools:**
- Python debugger (pdb)
- Database query analyzers
- API testing tools (Postman)
- Log aggregation tools
- Performance profilers

## Common Issue Patterns

**Financial Data Issues:**
- Precision loss in calculations
- Currency formatting problems
- Date/time timezone issues
- Missing data validation
- Incorrect aggregation logic

**Chart Rendering Issues:**
- Data format mismatches
- Performance with large datasets
- Event handler conflicts
- Configuration errors
- Memory leaks

**API Integration Issues:**
- Authentication token expiration
- Rate limiting problems
- Data serialization errors
- Network connectivity issues
- CORS configuration problems

## Testing and Validation

**Verify Fix:**
1. Test original reproduction case
2. Run relevant test suites
3. Verify financial calculation accuracy
4. Check performance impact
5. Test edge cases and boundary conditions

**Regression Testing:**
1. Run full test suite
2. Test related functionality
3. Verify user workflows
4. Check data integrity
5. Validate security measures

## Documentation and Follow-up

**Issue Resolution:**
- Document root cause and fix
- Update relevant documentation
- Add tests to prevent regression
- Consider architectural improvements
- Share knowledge with team