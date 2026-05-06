# Skill: Dual Y-Axis Chart (lightweight-charts v5)

**Owner:** Fenster  
**Last updated:** 2026-05-06  
**Applies to:** Any chart in `apps/frontend/src/components/**` that uses `lightweight-charts`

---

## When to use this pattern

When a chart renders two series whose values differ by **more than ~5×**, a single shared Y-axis makes the smaller series nearly invisible. Add a dual axis: one scale per series.

Common cases:
- Monthly per-bar values vs. cumulative line (e.g., cash flow vs. cumulative P&L)
- Volume histogram vs. price line
- Percentage return vs. absolute dollar value

---

## Pattern

### 1. Enable both price scales in `createChart`

```typescript
const chart = createChart(containerEl, {
  // ...layout, grid, timeScale options...
  leftPriceScale: {
    visible: true,                  // MUST be explicit — hidden by default
    borderColor: SERIES_A_COLOR,    // color-match to the series on this axis
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
  rightPriceScale: {
    borderColor: SERIES_B_COLOR,    // color-match to the series on this axis
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
});
```

### 2. Assign each series to its axis

```typescript
const seriesA = chart.addSeries(HistogramSeries, {
  priceScaleId: 'left',
  priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
});

const seriesB = chart.addSeries(LineSeries, {
  color: SERIES_B_COLOR,
  priceScaleId: 'right',
  priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
});
```

### 3. Currency formatter (USD, no decimals, thousands separator)

```typescript
const currencyFormatter = (price: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(price);
```

### 4. UX: label each axis in the legend and tooltip

Legend buttons:
```tsx
['cashFlow', 'Monthly cash flow',    'bg-emerald-500', '← left axis'],
['realized', 'Cumulative P&L',       'bg-blue-400',    'right axis →'],
```

Tooltip:
```tsx
<p>Cash Flow (←): {formatSignedUsd(tooltip.cashFlow)}</p>
<p>Cumulative P&L (→): {formatSignedUsd(tooltip.cumulativePnl)}</p>
```

---

## Testing dual axes

The project's lightweight-charts mock (`src/test/setup.ts`) exposes all `createChart` calls via `vi.mocked(createChart).mock.calls`. Assert the axis config was passed correctly — no canvas/DOM introspection needed:

```typescript
import { createChart } from 'lightweight-charts';
import { vi } from 'vitest';

it('creates dual Y-axes', async () => {
  render(<MyChart data={data} />);
  await waitFor(() => expect(screen.getByTestId('my-chart')).toBeInTheDocument());

  const calls = vi.mocked(createChart).mock.calls;
  const opts = calls[calls.length - 1][1] as {
    leftPriceScale?: { visible?: boolean };
    rightPriceScale?: { borderColor?: string };
  };
  expect(opts?.leftPriceScale?.visible).toBe(true);
  expect(opts?.rightPriceScale?.borderColor).toBeDefined();
});
```

---

## Reference implementation

`apps/frontend/src/components/Options/net-cash-flow-vs-realized-chart.tsx`  
Test: `apps/frontend/src/components/Options/__tests__/NetCashFlowVsRealizedChart.test.tsx`
