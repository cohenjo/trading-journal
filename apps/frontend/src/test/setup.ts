import "@testing-library/jest-dom";

// Mock lightweight-charts — all chart components use createChart + series methods
vi.mock("lightweight-charts", () => {
  const chartInstances: Array<{ __series: Array<{ setData: ReturnType<typeof vi.fn> }> }> = [];
  const makeSeries = () => ({
    setData: vi.fn(),
    setMarkers: vi.fn(),
    applyOptions: vi.fn(),
  });

  return {
    __chartInstances: chartInstances,
    createChart: vi.fn(() => {
      const chart = {
        __series: [] as Array<{ setData: ReturnType<typeof vi.fn> }>,
        addSeries: vi.fn(() => {
          const series = makeSeries();
          chart.__series.push(series);
          return series;
        }),
        addLineSeries: vi.fn(() => {
          const series = makeSeries();
          chart.__series.push(series);
          return series;
        }),
        addCandlestickSeries: vi.fn(() => {
          const series = makeSeries();
          chart.__series.push(series);
          return series;
        }),
        addHistogramSeries: vi.fn(() => {
          const series = makeSeries();
          chart.__series.push(series);
          return series;
        }),
        addAreaSeries: vi.fn(() => {
          const series = makeSeries();
          chart.__series.push(series);
          return series;
        }),
        removeSeries: vi.fn(),
        applyOptions: vi.fn(),
        timeScale: vi.fn(() => ({
          fitContent: vi.fn(),
          applyOptions: vi.fn(),
          subscribeVisibleTimeRangeChange: vi.fn(),
        })),
        priceScale: vi.fn(() => ({
          applyOptions: vi.fn(),
        })),
        resize: vi.fn(),
        remove: vi.fn(),
        subscribeCrosshairMove: vi.fn(),
      };
      chartInstances.push(chart);
      return chart;
    }),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), markers: vi.fn(() => []) })),
    AreaSeries: "AreaSeries",
    BaselineSeries: "BaselineSeries",
    CandlestickSeries: "CandlestickSeries",
    HistogramSeries: "HistogramSeries",
    LineSeries: "LineSeries",
    ColorType: { Solid: "solid" },
    LineStyle: { Solid: 0, Dashed: 1, Dotted: 2 },
    CrosshairMode: { Normal: 0, Magnet: 1 },
  };
});

// Mock next/navigation — used by layout and page components
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
