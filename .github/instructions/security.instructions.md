---
description: 'Security best practices for financial trading application'
applyTo: '**/*'
---

# Security Guidelines

Security is paramount for financial applications. Follow these practices strictly.

## Data Protection

- Encrypt sensitive financial data at rest and in transit
- Use HTTPS for all communications
- Implement proper authentication and session management
- Hash passwords with bcrypt or Argon2
- Never store financial account credentials

## Input Validation

- Sanitize all user inputs before processing
- Validate file uploads for type and size limits
- Use parameterized queries to prevent SQL injection
- Implement CSRF protection for forms
- Validate and escape data before rendering

## API Security

- Implement rate limiting to prevent abuse
- Use JWT tokens with proper expiration
- Validate API request signatures
- Implement proper CORS policies
- Log security-related events for monitoring

## File Upload Security

- Restrict file types to CSV and XLSX only
- Scan uploaded files for malicious content
- Limit file size and processing time
- Store uploaded files in isolated locations
- Implement proper access controls

## Database Security

- Use least-privilege database access
- Implement proper connection encryption
- Regular security updates and patches
- Audit database access logs
- Backup encryption and secure storage

## Environment Security

- Store secrets in environment variables
- Use different keys for development and production
- Implement proper secret rotation
- Never commit secrets to version control
- Use Docker security best practices

## Frontend Security

- Implement Content Security Policy (CSP)
- Use secure cookie settings
- Validate data from APIs before rendering
- Implement proper error handling without leaking information
- Use HTTPS-only in production

## Monitoring and Logging

- Log security events and authentication attempts
- Monitor for unusual trading patterns
- Implement alerting for security incidents
- Regular security audits and penetration testing
- Keep audit logs for compliance

## Compliance Considerations

- Follow financial data privacy regulations
- Implement data retention policies
- Ensure user consent for data processing
- Provide data export and deletion capabilities
- Document security procedures and policies

## Incident Response

- Have a plan for security breach response
- Implement proper backup and recovery procedures
- Test disaster recovery scenarios
- Maintain contact information for security issues
- Regular security training and awareness