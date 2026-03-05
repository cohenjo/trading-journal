import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SplitBrainToggle, { type AnalysisMode } from "./SplitBrainToggle";

describe("SplitBrainToggle", () => {
  it("renders both mode buttons", () => {
    render(<SplitBrainToggle mode="long-term" onModeChange={vi.fn()} />);

    expect(screen.getByText("Long-Term Investor")).toBeInTheDocument();
    expect(screen.getByText("Short-Term Income")).toBeInTheDocument();
  });

  it("highlights the active mode with correct color", () => {
    const { rerender } = render(
      <SplitBrainToggle mode="long-term" onModeChange={vi.fn()} />
    );

    const longTermBtn = screen.getByText("Long-Term Investor");
    const shortTermBtn = screen.getByText("Short-Term Income");

    // Long-term active → blue styling
    expect(longTermBtn.className).toContain("bg-blue-600");
    expect(shortTermBtn.className).not.toContain("bg-amber-600");

    // Switch to short-term
    rerender(
      <SplitBrainToggle mode="short-term" onModeChange={vi.fn()} />
    );

    expect(screen.getByText("Short-Term Income").className).toContain(
      "bg-amber-600"
    );
    expect(screen.getByText("Long-Term Investor").className).not.toContain(
      "bg-blue-600"
    );
  });

  it("calls onModeChange with correct mode when clicked", () => {
    const onModeChange = vi.fn();
    render(<SplitBrainToggle mode="long-term" onModeChange={onModeChange} />);

    fireEvent.click(screen.getByText("Short-Term Income"));
    expect(onModeChange).toHaveBeenCalledWith("short-term");

    fireEvent.click(screen.getByText("Long-Term Investor"));
    expect(onModeChange).toHaveBeenCalledWith("long-term");
  });

  it("sets aria-pressed correctly for accessibility", () => {
    render(<SplitBrainToggle mode="long-term" onModeChange={vi.fn()} />);

    expect(screen.getByText("Long-Term Investor")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Short-Term Income")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
