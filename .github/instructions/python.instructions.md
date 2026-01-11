<!-- Based on: https://github.com/github/awesome-copilot/blob/main/instructions/python.instructions.md -->
---
description: 'Python backend development standards for trading journal application'
applyTo: '**/*.py'
---

# Python Backend Development Guidelines

Follow PEP 8 standards and modern Python practices for the trading journal backend.

## Python Code Standards

- Write clear and concise docstrings following PEP 257 conventions
- Use type hints with the `typing` module for all functions
- Follow PEP 8 style guide with 4-space indentation
- Keep lines under 88 characters (Black formatter standard)
- Use descriptive function and variable names

## Financial Data Processing

- Use `decimal.Decimal` for all monetary calculations
- Implement proper rounding for financial precision
- Handle timezone-aware datetime objects for market data
- Validate data integrity with Pydantic models
- Use pandas for bulk data processing and analysis

## Database Operations

- Use SQLAlchemy ORM with proper session management
- Implement database migrations with Alembic
- Create indexes for frequently queried trading data
- Use connection pooling for optimal performance
- Handle database transactions for trade operations

## API Development

- Use FastAPI for async API endpoints
- Implement proper request/response models with Pydantic
- Add comprehensive error handling and validation
- Use dependency injection for database sessions
- Implement proper authentication and authorization

## Data Import/Export

- Support CSV and XLSX file formats for trade data
- Validate imported data against expected schemas
- Implement batch processing for large datasets
- Handle file upload security and size limits
- Provide detailed error reporting for failed imports

## Package Management (uv)

- Use `pyproject.toml` for project configuration
- Pin dependency versions for reproducible builds
- Separate development and production dependencies
- Keep virtual environment isolated with uv

## Error Handling

- Use custom exception classes for trading-specific errors
- Implement comprehensive logging with structured data
- Handle edge cases for market data anomalies
- Provide meaningful error messages to frontend

## Testing Standards

- Write unit tests for all business logic
- Use pytest with appropriate fixtures
- Test financial calculations with known expected results
- Mock external data sources and APIs
- Implement integration tests for database operations

## Security Practices

- Validate and sanitize all user inputs
- Use parameterized queries to prevent SQL injection
- Implement rate limiting for API endpoints
- Hash sensitive data appropriately
- Use environment variables for configuration secrets

## Performance Optimization

- Use async/await for I/O-bound operations
- Implement caching for frequently accessed data
- Optimize database queries with proper indexing
- Use batch operations for bulk data processing
- Profile code to identify performance bottlenecks