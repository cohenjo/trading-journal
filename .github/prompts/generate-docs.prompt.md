---
agent: 'agent'
model: 'Claude Sonnet 4'
tools: ['edit', 'search', 'fetch']
description: 'Generate comprehensive documentation for trading journal features'
---

# Trading Journal Documentation Generator

Generate thorough documentation for trading journal application features and APIs.

## Documentation Types

**Ask for documentation scope:**
- API endpoints to document
- Components/features to document
- User workflows to explain
- Technical architecture to describe
- Financial calculations to detail

## API Documentation

**REST API Documentation:**
- Use OpenAPI/Swagger format
- Include request/response examples
- Document authentication requirements
- Explain error response formats
- Provide integration examples

**Endpoint Documentation Template:**
```yaml
paths:
  /api/trades:
    post:
      summary: Create new trade
      description: Add a new trading position
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Trade'
            example:
              symbol: "AAPL"
              quantity: 100
              price: 150.25
      responses:
        201:
          description: Trade created successfully
```

## Component Documentation

**React Component Docs:**
- Document props interface
- Explain usage examples
- Include styling options
- Document event handlers
- Provide accessibility notes

**Component Template:**
```typescript
/**
 * TradeChart displays financial chart data using lightweight-charts
 * 
 * @param data - Array of OHLCV data points
 * @param symbol - Trading symbol to display
 * @param height - Chart height in pixels
 * 
 * @example
 * <TradeChart 
 *   data={chartData} 
 *   symbol="AAPL" 
 *   height={400} 
 * />
 */
```

## Financial Calculation Documentation

**Formula Documentation:**
- Explain calculation methodology
- Provide mathematical formulas
- Include example calculations
- Document assumptions and limitations
- Reference industry standards

**Example:**
```markdown
## Portfolio Return Calculation

**Formula:** `(End Value - Start Value + Dividends) / Start Value * 100`

**Variables:**
- End Value: Portfolio value at period end
- Start Value: Portfolio value at period start  
- Dividends: Total dividends received during period

**Example:**
- Start Value: $10,000
- End Value: $10,500
- Dividends: $200
- Return: (10,500 - 10,000 + 200) / 10,000 * 100 = 7%
```

## User Guide Documentation

**Workflow Documentation:**
- Step-by-step procedures
- Screenshots and visual guides
- Common troubleshooting
- Best practices
- FAQ section

**Import Data Workflow:**
```markdown
1. Navigate to Data Import section
2. Select file format (CSV or XLSX)
3. Upload file using drag-and-drop
4. Map columns to required fields
5. Validate data preview
6. Confirm import and process
```

## Technical Architecture

**System Documentation:**
- Architecture diagrams
- Data flow explanations
- Database schema
- Security measures
- Performance considerations

**Architecture Template:**
```markdown
## System Architecture

### Frontend (React/TypeScript)
- React 18+ with TypeScript
- lightweight-charts for charting
- Material-UI for components
- React Query for state management

### Backend (Python)
- FastAPI for REST API
- SQLAlchemy for ORM
- PostgreSQL database
- Alembic for migrations
```

## Code Documentation

**JSDoc/Docstring Standards:**
- Function purpose and behavior
- Parameter descriptions
- Return value documentation
- Usage examples
- Error conditions

**Python Docstring:**
```python
def calculate_portfolio_return(start_value: Decimal, end_value: Decimal, dividends: Decimal) -> Decimal:
    """Calculate total portfolio return including dividends.
    
    Args:
        start_value: Portfolio value at period start
        end_value: Portfolio value at period end
        dividends: Total dividends received during period
        
    Returns:
        Decimal: Portfolio return as percentage
        
    Raises:
        ValueError: If start_value is zero or negative
        
    Example:
        >>> calculate_portfolio_return(Decimal('10000'), Decimal('10500'), Decimal('200'))
        Decimal('7.0')
    """
```

## Configuration Documentation

**Environment Setup:**
- Required environment variables
- Configuration file formats
- Development vs production settings
- Database configuration
- Security settings

## Testing Documentation

**Test Strategy:**
- Testing approach and frameworks
- Test data requirements
- Coverage requirements
- Performance testing procedures
- Security testing guidelines

## Deployment Documentation

**Docker Setup:**
- Container configuration
- Docker Compose usage
- Environment variables
- Volume mounts
- Network configuration

**Production Deployment:**
- Server requirements
- SSL/TLS setup
- Database configuration
- Monitoring setup
- Backup procedures

## Documentation Standards

**Quality Requirements:**
- Clear and concise language
- Practical examples
- Current and accurate information
- Proper formatting and structure
- Regular updates with code changes