---
description: 'Performance optimization guidelines for trading journal application'
applyTo: '**/*'
---

# Performance Guidelines

Optimize for responsive user experience with large financial datasets.

## Frontend Performance

- Use React.memo for expensive chart components
- Implement virtualization for large trade lists
- Lazy load chart data and components
- Use Web Workers for heavy calculations
- Optimize bundle size with code splitting

## Chart Performance (lightweight-charts)

- Use data streaming for real-time updates
- Implement data compression for historical data
- Optimize chart rendering with appropriate time ranges
- Use throttling for frequent updates
- Cache chart configurations and data

## Database Performance

- Create proper indexes on frequently queried columns
- Use connection pooling for database connections
- Implement query optimization and monitoring
- Use pagination for large result sets
- Consider read replicas for reporting queries

## API Performance

- Implement response caching where appropriate
- Use async processing for heavy operations
- Optimize serialization and deserialization
- Implement rate limiting to prevent overload
- Use compression for API responses

## Data Processing

- Use batch processing for large imports
- Implement parallel processing for independent tasks
- Cache frequently accessed calculations
- Use efficient data structures for financial operations
- Optimize pandas operations for large datasets

## Memory Management

- Monitor memory usage during data imports
- Implement proper cleanup for temporary data
- Use generators for processing large datasets
- Avoid memory leaks in long-running processes
- Optimize JavaScript object creation

## Network Optimization

- Minimize API calls with efficient data fetching
- Use HTTP/2 for improved connection management
- Implement proper caching headers
- Compress static assets and responses
- Use CDN for static content delivery

## File Processing

- Stream large file uploads and processing
- Use efficient parsers for CSV and XLSX files
- Implement progress indicators for long operations
- Process files in chunks to avoid memory issues
- Optimize file format choices

## Monitoring and Metrics

- Monitor application performance metrics
- Track database query performance
- Measure chart rendering times
- Monitor memory and CPU usage
- Set up alerting for performance degradation

## Docker Performance

- Optimize Docker image sizes
- Use multi-stage builds for production images
- Configure appropriate resource limits
- Use volume mounts for development efficiency
- Optimize container networking

## Browser Performance

- Minimize DOM manipulations
- Use efficient event handling
- Implement proper garbage collection
- Optimize CSS and rendering performance
- Use performance profiling tools