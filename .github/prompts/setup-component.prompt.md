---
agent: 'agent'
model: 'Claude Sonnet 4'
tools: ['edit', 'search', 'usages']
description: 'Generate new React components for trading journal features'
---

# Trading Journal Component Generator

Generate new React components following the project's TypeScript and financial domain standards.

## Component Requirements

**Ask for component details if not provided:**
- Component name and purpose
- Props interface requirements
- State management needs
- Chart integration requirements
- Financial data types involved

## Component Standards

**TypeScript Requirements:**
- Use functional components with hooks
- Define proper TypeScript interfaces for props
- Use strict typing for financial data (Decimal types)
- Implement proper error boundaries

**Financial Domain Considerations:**
- Use appropriate precision for monetary values
- Handle market data updates efficiently
- Implement proper validation for trading data
- Consider timezone handling for market hours

**Chart Integration (if applicable):**
- Use lightweight-charts library patterns
- Implement proper data streaming
- Handle chart configuration with TypeScript
- Optimize for performance with large datasets

**Component Structure:**
```
// Component interface
interface ComponentNameProps {
  // Define props with financial types
}

// Component implementation
export const ComponentName: React.FC<ComponentNameProps> = ({ ...props }) => {
  // State and hooks
  // Event handlers
  // Render logic
};

// Export with proper typing
export default ComponentName;
```

**File Organization:**
- Create component in appropriate feature folder
- Include accompanying test file
- Add to component index exports
- Update relevant documentation

## Generated Files

1. **Component file** (`component-name.component.tsx`)
2. **Test file** (`component-name.component.test.tsx`)
3. **Type definitions** (if complex interfaces needed)
4. **Storybook story** (for UI components)

## Validation Steps

- Verify TypeScript compilation
- Check ESLint and Prettier compliance
- Ensure proper test coverage
- Validate financial calculation accuracy
- Test chart integration if applicable