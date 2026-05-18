/**
 * CashFlowSankey — component tests
 *
 * Covers:
 *   1. 3 dividend income source nodes for "Dividend - IBKR/Schwab/IRA"
 *   2. 3 reinvestment outflow destination nodes for "Dividend Reinvest - IBKR/Schwab/IRA"
 *   3. Zero-dividend account filters out — only non-zero entries produce nodes
 *   4. All node IDs are unique (no collisions in the graph)
 *   5. Reinvestment destination nodes use the indigo accent color (#7c7ef8 or #818cf8)
 *      ⚠️  Test 5 is TDD-red until Fenster updates the per-reinvestment color in CashFlowSankey.
 *
 * Mock strategy:
 *   @nivo/sankey is mocked to capture the `data` prop (nodes + links) without
 *   rendering SVG, so we can assert on the graph structure.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CashFlowSankey } from '@/components/CashFlow/CashFlowSankey';

// ── Mock @nivo/sankey ─────────────────────────────────────────────────────────

let capturedSankeyData: { nodes: Array<{ id: string; nodeColor: string; label: string }>; links: unknown[] } | undefined;

vi.mock('@nivo/sankey', () => ({
  ResponsiveSankey: (props: { data: { nodes: Array<{ id: string; nodeColor: string; label: string }>; links: unknown[] } }) => {
    capturedSankeyData = props.data;
    return <div data-testid="sankey" />;
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal projection with 3 dividend income sources + 3 reinvestment outflows */
const FULL_DIVIDEND_DATA = {
  income: 145_000,
  withdrawals: 0,
  tax_paid: 12_000,
  expenses: 36_000,
  income_details: [
    { name: 'Salary', type: 'income', value: 120_000 },
    { name: 'Dividend - IBKR', type: 'dividends', value: 12_000 },
    { name: 'Dividend - Schwab', type: 'dividends', value: 8_000 },
    { name: 'Dividend - IRA', type: 'dividends', value: 5_000 },
  ],
  expense_details: [{ name: 'Living', type: 'Living', value: 36_000 }],
  savings_details: [
    { name: 'Dividend Reinvest - IBKR', type: 'reinvestment', value: 12_000 },
    { name: 'Dividend Reinvest - Schwab', type: 'reinvestment', value: 8_000 },
    { name: 'Dividend Reinvest - IRA', type: 'reinvestment', value: 5_000 },
  ],
  withdrawal_details: [],
};

/** Only IBKR and IRA have non-zero dividends (Schwab = 0) */
const TWO_DIVIDEND_DATA = {
  ...FULL_DIVIDEND_DATA,
  income: 137_000,
  income_details: [
    { name: 'Salary', type: 'income', value: 120_000 },
    { name: 'Dividend - IBKR', type: 'dividends', value: 12_000 },
    { name: 'Dividend - IRA', type: 'dividends', value: 5_000 },
  ],
  savings_details: [
    { name: 'Dividend Reinvest - IBKR', type: 'reinvestment', value: 12_000 },
    { name: 'Dividend Reinvest - IRA', type: 'reinvestment', value: 5_000 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderSankey(data: unknown) {
  capturedSankeyData = undefined;
  render(<CashFlowSankey data={data} currency="USD" />);
}

function nodes() {
  return capturedSankeyData?.nodes ?? [];
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CashFlowSankey — per-account dividend and reinvestment nodes', () => {
  beforeEach(() => {
    capturedSankeyData = undefined;
  });

  // ── 1. Three dividend income source nodes ──────────────────────────────────

  it('renders 3 distinct dividend income source nodes for IBKR, Schwab, and IRA', () => {
    renderSankey(FULL_DIVIDEND_DATA);

    const divSourceNodes = nodes().filter(n => n.label?.startsWith('Dividend - '));
    expect(divSourceNodes).toHaveLength(3);

    const labels = divSourceNodes.map(n => n.label);
    expect(labels).toContain('Dividend - IBKR');
    expect(labels).toContain('Dividend - Schwab');
    expect(labels).toContain('Dividend - IRA');
  });

  // ── 2. Three reinvestment destination nodes ────────────────────────────────

  it('renders 3 distinct reinvestment destination nodes for IBKR, Schwab, and IRA', () => {
    renderSankey(FULL_DIVIDEND_DATA);

    const reinvestNodes = nodes().filter(n => n.label?.startsWith('Dividend Reinvest - '));
    expect(reinvestNodes).toHaveLength(3);

    const labels = reinvestNodes.map(n => n.label);
    expect(labels).toContain('Dividend Reinvest - IBKR');
    expect(labels).toContain('Dividend Reinvest - Schwab');
    expect(labels).toContain('Dividend Reinvest - IRA');
  });

  // ── 3. Zero account filters out ───────────────────────────────────────────

  it('omits nodes for zero-dividend accounts — only 2 source + 2 reinvest nodes when Schwab=0', () => {
    renderSankey(TWO_DIVIDEND_DATA);

    const divSourceNodes = nodes().filter(n => n.label?.startsWith('Dividend - '));
    expect(divSourceNodes).toHaveLength(2);
    expect(divSourceNodes.some(n => n.label === 'Dividend - Schwab')).toBe(false);

    const reinvestNodes = nodes().filter(n => n.label?.startsWith('Dividend Reinvest - '));
    expect(reinvestNodes).toHaveLength(2);
    expect(reinvestNodes.some(n => n.label === 'Dividend Reinvest - Schwab')).toBe(false);
  });

  // ── 4. Node ID uniqueness ─────────────────────────────────────────────────

  it('all node IDs are unique — no collisions in the graph', () => {
    renderSankey(FULL_DIVIDEND_DATA);

    const allNodes = nodes();
    expect(allNodes.length).toBeGreaterThan(0);

    const ids = allNodes.map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── 5. Reinvestment nodes use indigo accent color ─────────────────────────
  // ⚠️ TDD-red until Fenster updates CashFlowSankey to use #7c7ef8 for type=reinvestment

  it('reinvestment destination nodes have indigo accent color (#7c7ef8 or #818cf8)', () => {
    renderSankey(FULL_DIVIDEND_DATA);

    const reinvestNodes = nodes().filter(n => n.label?.startsWith('Dividend Reinvest - '));
    expect(reinvestNodes.length).toBeGreaterThan(0);

    const indigoColors = new Set(['#7c7ef8', '#818cf8']);
    reinvestNodes.forEach(n => {
      expect(indigoColors.has(n.nodeColor)).toBe(true);
    });
  });
});
