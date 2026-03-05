import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AnalyzePage from "./AnalyzePage";

// Mock child components to isolate AnalyzePage logic
vi.mock("./LongTermView", () => ({
  default: ({ ticker }: { ticker: string }) => (
    <div data-testid="long-term-view">LongTermView: {ticker}</div>
  ),
}));
vi.mock("./ShortTermView", () => ({
  default: ({ ticker }: { ticker: string }) => (
    <div data-testid="short-term-view">ShortTermView: {ticker}</div>
  ),
}));

describe("AnalyzePage", () => {
  it("renders the page with heading and placeholder", () => {
    render(<AnalyzePage />);

    expect(screen.getByText("Company Analysis")).toBeInTheDocument();
    expect(
      screen.getByText(/enter a ticker symbol above/i)
    ).toBeInTheDocument();
  });

  it("shows LongTermView after ticker search", () => {
    render(<AnalyzePage />);

    const input = screen.getByPlaceholderText(/enter ticker/i);
    fireEvent.change(input, { target: { value: "AAPL" } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByTestId("long-term-view")).toBeInTheDocument();
    expect(screen.getByText("LongTermView: AAPL")).toBeInTheDocument();
  });

  it("validates ticker input — rejects numeric tickers", () => {
    render(<AnalyzePage />);

    const input = screen.getByPlaceholderText(/enter ticker/i);
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.submit(input.closest("form")!);

    // Numeric input should be rejected — no view rendered
    expect(screen.queryByTestId("long-term-view")).not.toBeInTheDocument();
    expect(screen.getByText(/alphabetic only/i)).toBeInTheDocument();
  });

  it("validates ticker input — rejects empty input", () => {
    render(<AnalyzePage />);

    const input = screen.getByPlaceholderText(/enter ticker/i);
    fireEvent.submit(input.closest("form")!);

    expect(screen.queryByTestId("long-term-view")).not.toBeInTheDocument();
    expect(screen.getByText(/enter a ticker symbol$/i)).toBeInTheDocument();
  });

  it("switches between Long-Term and Short-Term views", () => {
    render(<AnalyzePage />);

    // First enter a ticker
    const input = screen.getByPlaceholderText(/enter ticker/i);
    fireEvent.change(input, { target: { value: "MSFT" } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByTestId("long-term-view")).toBeInTheDocument();

    // Switch to Short-Term
    fireEvent.click(screen.getByText("Short-Term Income"));
    expect(screen.getByTestId("short-term-view")).toBeInTheDocument();
    expect(screen.queryByTestId("long-term-view")).not.toBeInTheDocument();
  });
});
