import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import {
  SettingsProvider,
  useSettings,
  type UserSettings,
} from './SettingsContext';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('SettingsContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('Provider and Hook', () => {
    it('should provide settings context to children', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.settings).toBeDefined();
      expect(result.current.updateSettings).toBeDefined();
    });

    it('should throw error when useSettings is called outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useSettings());
      }).toThrow('useSettings must be used within a SettingsProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('Default Values', () => {
    it('should initialize with default settings', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('ILS');
        expect(result.current.settings.planningMode).toBe('Individual');
        expect(result.current.settings.targetIncome).toBe(20000);
        expect(result.current.settings.defaultRungTarget).toBe(40000);
        expect(result.current.settings.primaryUser.name).toBe('You');
        expect(result.current.settings.primaryUser.birthYear).toBe(1980);
      });
    });

    it('should have correct default financial parameters', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      await waitFor(() => {
        expect(result.current.settings.dividendYieldRate).toBe(0.028);
        expect(result.current.settings.dividendGrowthRate).toBe(0.04);
        expect(result.current.settings.dividendReinvestRate).toBe(0.8);
        expect(result.current.settings.optionsGrowthRate).toBe(0.05);
        expect(result.current.settings.cutoffYear).toBe(2040);
        expect(result.current.settings.dividendFinalYear).toBe(2064);
        expect(result.current.settings.optionsFinalYear).toBe(2064);
      });
    });
  });

  describe('Currency Switching', () => {
    it('should update currency from ILS to USD', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('ILS');
      });

      act(() => {
        result.current.updateSettings({ mainCurrency: 'USD' });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('USD');
      });
    });

    it('should update currency from USD to EUR', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      // First set to USD
      act(() => {
        result.current.updateSettings({ mainCurrency: 'USD' });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('USD');
      });

      // Then switch to EUR
      act(() => {
        result.current.updateSettings({ mainCurrency: 'EUR' });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('EUR');
      });
    });

    it('should update currency from EUR back to ILS', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      // Set to EUR
      act(() => {
        result.current.updateSettings({ mainCurrency: 'EUR' });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('EUR');
      });

      // Switch back to ILS
      act(() => {
        result.current.updateSettings({ mainCurrency: 'ILS' });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('ILS');
      });
    });
  });

  describe('Settings Updates', () => {
    it('should update partial settings without affecting others', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      await waitFor(() => {
        expect(result.current.settings.targetIncome).toBe(20000);
      });

      act(() => {
        result.current.updateSettings({ targetIncome: 30000 });
      });

      await waitFor(() => {
        expect(result.current.settings.targetIncome).toBe(30000);
        // Other settings should remain unchanged
        expect(result.current.settings.mainCurrency).toBe('ILS');
        expect(result.current.settings.planningMode).toBe('Individual');
      });
    });

    it('should update multiple settings at once', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.updateSettings({
          mainCurrency: 'USD',
          targetIncome: 50000,
          planningMode: 'Couple',
        });
      });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('USD');
        expect(result.current.settings.targetIncome).toBe(50000);
        expect(result.current.settings.planningMode).toBe('Couple');
      });
    });

    it('should update planning mode to Couple', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.updateSettings({ planningMode: 'Couple' });
      });

      await waitFor(() => {
        expect(result.current.settings.planningMode).toBe('Couple');
      });
    });
  });

  describe('localStorage Persistence', () => {
    it('should persist settings to localStorage on update', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.updateSettings({
          mainCurrency: 'USD',
          targetIncome: 25000,
        });
      });

      await waitFor(() => {
        const stored = localStorageMock.getItem('trading-journal-settings-v1');
        expect(stored).toBeTruthy();

        const parsed = JSON.parse(stored!);
        expect(parsed.mainCurrency).toBe('USD');
        expect(parsed.targetIncome).toBe(25000);
      });
    });

    it('should load settings from localStorage on mount', async () => {
      // Pre-populate localStorage
      const testSettings: Partial<UserSettings> = {
        mainCurrency: 'EUR',
        targetIncome: 35000,
        planningMode: 'Couple',
      };

      localStorageMock.setItem(
        'trading-journal-settings-v1',
        JSON.stringify(testSettings)
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('EUR');
        expect(result.current.settings.targetIncome).toBe(35000);
        expect(result.current.settings.planningMode).toBe('Couple');
      });
    });

    it('should handle corrupted localStorage gracefully', async () => {
      // Set invalid JSON in localStorage
      localStorageMock.setItem('trading-journal-settings-v1', 'invalid-json{');

      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      // Should fall back to defaults
      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('ILS');
        expect(result.current.settings.targetIncome).toBe(20000);
      });
    });

    it('should validate and sanitize loaded currency values', async () => {
      // Set invalid currency in localStorage
      const testSettings = {
        mainCurrency: 'INVALID',
      };

      localStorageMock.setItem(
        'trading-journal-settings-v1',
        JSON.stringify(testSettings)
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      // Should fall back to default ILS
      await waitFor(() => {
        expect(result.current.settings.mainCurrency).toBe('ILS');
      });
    });

    it('should validate and sanitize negative numeric values', async () => {
      const testSettings = {
        targetIncome: -1000,
        defaultRungTarget: -500,
      };

      localStorageMock.setItem(
        'trading-journal-settings-v1',
        JSON.stringify(testSettings)
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      // Should fall back to defaults for negative values
      await waitFor(() => {
        expect(result.current.settings.targetIncome).toBe(20000);
        expect(result.current.settings.defaultRungTarget).toBe(40000);
      });
    });
  });

  describe('Person Info Updates', () => {
    it('should update primary user info', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.updateSettings({
          primaryUser: { name: 'John', birthYear: 1985, birthMonth: 6 },
        });
      });

      await waitFor(() => {
        expect(result.current.settings.primaryUser.name).toBe('John');
        expect(result.current.settings.primaryUser.birthYear).toBe(1985);
        expect(result.current.settings.primaryUser.birthMonth).toBe(6);
      });
    });

    it('should update spouse info', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider>{children}</SettingsProvider>
      );

      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.updateSettings({
          spouse: { name: 'Jane', birthYear: 1987, birthMonth: 3 },
        });
      });

      await waitFor(() => {
        expect(result.current.settings.spouse.name).toBe('Jane');
        expect(result.current.settings.spouse.birthYear).toBe(1987);
        expect(result.current.settings.spouse.birthMonth).toBe(3);
      });
    });
  });
});
