---
description: 'Code review standards and GitHub review guidelines'
applyTo: '**/*'
---

# Code Review Guidelines

Ensure high quality and security for financial application code.

## Review Priorities

1. **Financial Accuracy**: Verify all monetary calculations and formulas
2. **Security**: Check for vulnerabilities and data protection
3. **Performance**: Ensure efficient handling of large datasets
4. **Data Integrity**: Validate data processing and storage logic
5. **Code Quality**: Maintain readable and maintainable code

## Financial Logic Review

- Verify decimal precision in monetary calculations
- Check rounding behavior and tax calculations
- Validate portfolio performance metrics
- Review risk calculation formulas
- Ensure proper handling of different currencies

## Security Review Checklist

- Check input validation and sanitization
- Verify authentication and authorization logic
- Review file upload security measures
- Check for SQL injection vulnerabilities
- Validate error handling without information leakage

## TypeScript/React Review

- Verify proper TypeScript typing throughout
- Check component structure and hook usage
- Review chart integration and performance
- Validate error boundaries and loading states
- Check accessibility and user experience

## Python Review

- Verify type hints and docstring quality
- Check error handling and logging
- Review database operations and migrations
- Validate API endpoint security and performance
- Check dependency management and configuration

## Testing Review

- Ensure adequate test coverage for financial logic
- Review test data quality and realism
- Check error case and edge case testing
- Verify mock usage and test isolation
- Validate integration test scenarios

## Performance Review

- Check for potential memory leaks
- Review database query efficiency
- Validate chart rendering performance
- Check API response times and caching
- Review file processing efficiency

## Documentation Review

- Verify comprehensive code comments
- Check API documentation accuracy
- Review README and setup instructions
- Validate inline documentation quality
- Check changelog and version notes

## Git and PR Guidelines

- Use descriptive commit messages
- Keep commits focused and atomic
- Link to relevant issues or requirements
- Provide clear PR descriptions
- Update documentation with changes

## Review Process

1. **Self-Review**: Review your own code before submitting
2. **Automated Checks**: Ensure all tests and lints pass
3. **Peer Review**: Get review from team members
4. **Security Review**: Extra scrutiny for security-related changes
5. **Final Validation**: Test changes in staging environment

## Common Issues to Watch For

- Floating-point arithmetic in financial calculations
- Missing input validation
- Inefficient database queries
- Memory leaks in chart components
- Security vulnerabilities in file handling
- Missing error handling
- Poor TypeScript typing
- Inadequate test coverage