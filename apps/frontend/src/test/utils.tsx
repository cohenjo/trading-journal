import { render, type RenderOptions } from '@testing-library/react';
import { ReactElement, ReactNode } from 'react';
import { SettingsProvider } from '@/app/settings/SettingsContext';

interface AllProvidersProps {
  children: ReactNode;
}

/**
 * Wrapper component that provides all necessary context providers for testing.
 * Currently includes SettingsProvider for global settings context.
 */
function AllProviders({ children }: AllProvidersProps) {
  return (
    <SettingsProvider>
      {children}
    </SettingsProvider>
  );
}

/**
 * Custom render function that wraps components with all necessary providers.
 * Use this instead of @testing-library/react's render for components that need context.
 *
 * @example
 * ```tsx
 * renderWithProviders(<MyComponent />);
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from React Testing Library
export * from '@testing-library/react';
