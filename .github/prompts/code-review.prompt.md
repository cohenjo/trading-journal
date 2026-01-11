---
agent: 'agent'
model: 'Claude Sonnet 4'
tools: ['search', 'usages', 'problems']
description: 'Comprehensive code review for trading journal application'
---

# Trading Journal Code Review Assistant

Perform thorough code reviews focusing on financial accuracy, security, and performance.

## Review Focus Areas

**Financial Logic Priority:**
1. Monetary calculation accuracy
2. Decimal precision handling
3. Tax calculation correctness
4. Portfolio metrics validation
5. Risk calculation formulas

## Review Checklist

**Financial Accuracy:**
- [ ] All monetary values use Decimal or BigNumber types
- [ ] Proper rounding for financial precision
- [ ] Correct formulas for portfolio calculations
- [ ] Accurate tax calculation implementation
- [ ] Proper currency handling and conversion

**Security Review:**
- [ ] Input validation for all user data
- [ ] SQL injection prevention (parameterized queries)
- [ ] File upload security (type/size validation)
- [ ] Authentication and authorization checks
- [ ] No sensitive data in logs or client-side code

**TypeScript/React Quality:**
- [ ] Proper TypeScript typing throughout
- [ ] Efficient hook usage and dependencies
- [ ] Chart component performance optimization
- [ ] Error boundary implementation
- [ ] Accessibility compliance

**Python Backend Quality:**
- [ ] Type hints and docstring completeness
- [ ] Proper async/await usage
- [ ] Database transaction handling
- [ ] Error handling and logging
- [ ] API security and validation

**Performance Considerations:**
- [ ] Efficient database queries
- [ ] Chart rendering optimization
- [ ] Memory usage for large datasets
- [ ] API response time optimization
- [ ] Proper caching implementation

**Testing Coverage:**
- [ ] Financial calculations have unit tests
- [ ] Edge cases and error scenarios tested
- [ ] Integration tests for data flow
- [ ] Security vulnerability testing
- [ ] Performance testing with realistic data

## Review Process

**Automated Checks:**
1. Run linting and formatting checks
2. Execute all test suites
3. Check security vulnerability scans
4. Verify type checking passes
5. Review code coverage reports

**Manual Review:**
1. **Financial Logic**: Verify calculations step by step
2. **Security**: Check for common vulnerabilities
3. **Architecture**: Ensure proper separation of concerns
4. **Performance**: Look for potential bottlenecks
5. **Maintainability**: Assess code readability and structure

## Common Issues to Flag

**Critical Issues:**
- Floating-point arithmetic in financial calculations
- Missing input validation
- Security vulnerabilities
- Incorrect financial formulas
- Memory leaks in chart components

**Important Issues:**
- Missing error handling
- Poor TypeScript typing
- Inefficient database queries
- Missing test coverage
- Performance bottlenecks

**Style Issues:**
- Inconsistent naming conventions
- Missing documentation
- Code duplication
- Complex functions needing refactoring

## Review Comments Template

**For Financial Issues:**
```
⚠️ FINANCIAL: [Issue description]
Impact: [Potential accuracy/compliance impact]
Suggestion: [Specific fix recommendation]
```

**For Security Issues:**
```
🔒 SECURITY: [Vulnerability description]
Risk: [Security risk level]
Fix: [Security fix requirements]
```

**For Performance Issues:**
```
⚡ PERFORMANCE: [Performance concern]
Impact: [User experience impact]
Optimization: [Suggested improvement]
```

## Approval Criteria

**Must Have:**
- All automated checks pass
- Financial calculations are verified accurate
- No security vulnerabilities
- Adequate test coverage
- Code follows project standards

**Should Have:**
- Performance optimizations implemented
- Clear documentation
- Proper error handling
- Accessibility considerations