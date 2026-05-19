/**
 * AccountHeader — Refresh button state machine tests (Section G items 11-14)
 *
 * Covers:
 *  11. Button disabled during submit
 *  12. Queued response → toast shown + polling interval starts
 *  13. Throttled response → toast shows "try again in X min" with countdown
 *  14. Timeout after 10 min polling → timeout message shown, button re-enabled
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as TradingActions from "@/app/trading/actions";
import AccountHeader from "../AccountHeader";
import type { TradingAccountConfig } from "@/app/trading/actions";
import { toast } from "sonner";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

// Override the global next/navigation mock to add `refresh`
const mockRouterRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: mockRouterRefresh,
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock CSVImportButton so we don't need its deps
vi.mock("@/components/trading/accounts/CSVImportButton", () => ({
  default: () => <button data-testid="csv-import-button">Import CSV</button>,
}));

// Mock triggerIBKRSync — tests control its resolved value
const mockTriggerIBKRSync = vi.fn();
vi.mock("@/app/trading/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof TradingActions>();
  return {
    ...actual,
    triggerIBKRSync: (...args: unknown[]) => mockTriggerIBKRSync(...args),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const IBKR_CONFIG: TradingAccountConfig = {
  id: 42,
  name: "IBKR Main",
  account_type: "IBKR",
  host: "127.0.0.1",
  port: 4001,
  client_id: 1,
  linked_account_id: null,
  account_id: "U12345",
  last_synced: "2026-05-19T06:30:00Z",
  compute_options_income: false,
};

const QUEUED_RESULT: TradingActions.AccountRefreshResult = {
  ok: true,
  status: "queued",
  last_synced_at: IBKR_CONFIG.last_synced,
  next_eligible_at: null,
};

function renderHeader(
  overrides: Partial<TradingAccountConfig> = {},
  callbacks: { onRefreshComplete?: () => void } = {},
) {
  const config = { ...IBKR_CONFIG, ...overrides };
  return render(
    <AccountHeader
      config={config}
      onRefreshComplete={callbacks.onRefreshComplete}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountHeader — Refresh button (G11-G14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterRefresh.mockClear();
  });

  afterEach(() => {
    // Restore real timers in case a test used fake ones
    vi.useRealTimers();
  });

  // ── G11: Button disabled during submit ──────────────────────────────────────
  it("G11: disables the refresh button while a submit is in-flight", async () => {
    // Controlled promise: we decide when it resolves
    let resolveRefresh!: (v: TradingActions.AccountRefreshResult) => void;
    mockTriggerIBKRSync.mockReturnValue(
      new Promise<TradingActions.AccountRefreshResult>((res) => {
        resolveRefresh = res;
      }),
    );

    renderHeader();
    const button = screen.getByTestId("refresh-button");

    expect(button).not.toBeDisabled();

    // Synchronous act flushes the SUBMITTING setState that fires before the
    // first await inside handleRefresh.
    act(() => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();

    // Resolve to prevent dangling promise warnings
    await act(async () => {
      resolveRefresh({ ok: false, status: "error", error: "cancelled" });
    });
  });

  // ── G12: Queued response → toast shown + polling starts ─────────────────────
  it("G12: shows queued toast and starts polling interval on queued response", async () => {
    vi.useFakeTimers();

    mockTriggerIBKRSync.mockResolvedValue(QUEUED_RESULT);

    renderHeader();
    const button = screen.getByTestId("refresh-button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(toast.info).toHaveBeenCalledWith(
      "Refresh queued. Data will update within 5 minutes.",
    );

    // Button should be disabled in QUEUED state
    expect(button).toBeDisabled();

    // Advance one 30-second poll tick — router.refresh should fire
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  // ── G13: Throttled response → toast with countdown ──────────────────────────
  it("G13: shows throttled toast with 'try again in X min' message", async () => {
    // next_eligible_at is 45 minutes from now
    const nextEligibleAt = new Date(Date.now() + 45 * 60_000).toISOString();

    mockTriggerIBKRSync.mockResolvedValue({
      ok: true,
      status: "throttled",
      last_synced_at: "2026-05-19T09:05:00Z",
      next_eligible_at: nextEligibleAt,
    } satisfies TradingActions.AccountRefreshResult);

    renderHeader();
    const button = screen.getByTestId("refresh-button");

    await act(async () => {
      fireEvent.click(button);
    });

    // Warning toast should appear with the countdown
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const warningCall = (toast.warning as Mock).mock.calls[0][0] as string;
    expect(warningCall).toMatch(/try again in \d+ min/i);

    // Button should be disabled showing countdown text
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/try in \d+m/i);
  });

  // ── G14: Timeout after 10 min polling ───────────────────────────────────────
  it("G14: shows timeout toast and re-enables button after 20 poll iterations (10 min)", async () => {
    vi.useFakeTimers();

    mockTriggerIBKRSync.mockResolvedValue(QUEUED_RESULT);

    renderHeader();
    const button = screen.getByTestId("refresh-button");

    await act(async () => {
      fireEvent.click(button);
    });

    // Button is disabled in QUEUED state
    expect(button).toBeDisabled();

    // Advance through all 20 × 30s = 600s intervals
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
    }

    expect(toast.error).toHaveBeenCalledWith(
      "Refresh may have failed. Check back later.",
    );
    expect(button).not.toBeDisabled();
  });

  // ── Bonus: Error response ────────────────────────────────────────────────────
  it("shows error toast and re-enables button on error response", async () => {
    mockTriggerIBKRSync.mockResolvedValue({
      ok: false,
      status: "error",
      error: "Account not found.",
    } satisfies TradingActions.AccountRefreshResult);

    renderHeader();
    const button = screen.getByTestId("refresh-button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Refresh failed: Account not found.",
    );
    expect(button).not.toBeDisabled();
  });

  // ── Bonus: COMPLETED when config.last_synced changes during polling ──────────
  it("transitions to COMPLETED when last_synced prop changes during polling", async () => {
    vi.useFakeTimers();

    mockTriggerIBKRSync.mockResolvedValue(QUEUED_RESULT);

    const onRefreshComplete = vi.fn();
    const { rerender } = renderHeader({}, { onRefreshComplete });
    const button = screen.getByTestId("refresh-button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();

    // Simulate the server reflecting the new timestamp (router.refresh caused
    // the server component to pass a fresh config prop down)
    const newTimestamp = "2026-05-19T10:00:00Z";
    await act(async () => {
      rerender(
        <AccountHeader
          config={{ ...IBKR_CONFIG, last_synced: newTimestamp }}
          onRefreshComplete={onRefreshComplete}
        />,
      );
    });

    // Advance one polling tick so the interval callback reads the updated ref
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(toast.success).toHaveBeenCalledWith("Data refreshed!");
    expect(onRefreshComplete).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled();
  });
});
