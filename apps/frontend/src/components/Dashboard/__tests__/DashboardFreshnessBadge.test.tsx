import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardFreshnessBadge from '../DashboardFreshnessBadge';
import type { HouseholdRefreshState } from '@/app/dashboard/actions';

const BASE_STATE: HouseholdRefreshState = {
  jobType: 'pnl_daily',
  lastSucceededAt: null,
  lastFailedAt: null,
  lastError: null,
  lastRunId: null,
};

describe('DashboardFreshnessBadge', () => {
  it('renders fresh state with green styling', () => {
    const freshState: HouseholdRefreshState = {
      ...BASE_STATE,
      lastSucceededAt: new Date(Date.now() - 60_000).toISOString(),
    };

    render(
      <DashboardFreshnessBadge
        freshnessStatus="fresh"
        refreshState={freshState}
        stalenessSeconds={60}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-status', 'fresh');
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('· 1m ago')).toBeInTheDocument();
  });

  it('renders refreshing state with amber/pulse styling and no "ago" text', () => {
    render(
      <DashboardFreshnessBadge
        freshnessStatus="refreshing"
        refreshState={BASE_STATE}
        stalenessSeconds={300}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveAttribute('data-status', 'refreshing');
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
    // No "ago" text shown during refresh
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it('renders stale state with amber warning', () => {
    render(
      <DashboardFreshnessBadge
        freshnessStatus="stale"
        refreshState={BASE_STATE}
        stalenessSeconds={90000}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveAttribute('data-status', 'stale');
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('renders failed state with red banner styling', () => {
    const failedState: HouseholdRefreshState = {
      ...BASE_STATE,
      lastFailedAt: new Date(Date.now() - 300_000).toISOString(),
      lastError: 'compute error: division by zero',
    };

    render(
      <DashboardFreshnessBadge
        freshnessStatus="failed"
        refreshState={failedState}
        stalenessSeconds={null}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveAttribute('data-status', 'failed');
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows tooltip with "No successful refresh yet" when state is null', () => {
    render(
      <DashboardFreshnessBadge
        freshnessStatus="stale"
        refreshState={null}
        stalenessSeconds={null}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveAttribute('title', 'No successful refresh yet');
  });

  it('shows "last updated X ago" in tooltip for fresh state', () => {
    const freshState: HouseholdRefreshState = {
      ...BASE_STATE,
      lastSucceededAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    render(
      <DashboardFreshnessBadge
        freshnessStatus="fresh"
        refreshState={freshState}
        stalenessSeconds={300}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge.getAttribute('title')).toMatch(/Last updated 5m ago/);
  });

  it('shows failure message in tooltip for failed state with error', () => {
    const failedState: HouseholdRefreshState = {
      ...BASE_STATE,
      lastSucceededAt: new Date(Date.now() - 7200_000).toISOString(),
      lastFailedAt: new Date(Date.now() - 600_000).toISOString(),
      lastError: 'worker crash',
    };

    render(
      <DashboardFreshnessBadge
        freshnessStatus="failed"
        refreshState={failedState}
        stalenessSeconds={7200}
      />,
    );

    const badge = screen.getByTestId('freshness-badge');
    expect(badge.getAttribute('title')).toMatch(/Last refresh failed/);
  });
});
