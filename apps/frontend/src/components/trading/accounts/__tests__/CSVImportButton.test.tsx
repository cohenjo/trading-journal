import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import CSVImportButton from "../CSVImportButton";
import * as TradingActions from "@/app/trading/actions";

vi.mock("@/app/trading/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof TradingActions>();
  return {
    ...actual,
    importManualPositionsCsv: vi.fn().mockResolvedValue({ ok: true, imported: 3 }),
  };
});

describe("CSVImportButton", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders Import CSV button", () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    expect(screen.getByTestId("import-csv-button")).toBeInTheDocument();
    expect(screen.getByTestId("import-csv-button")).toHaveTextContent("Import CSV");
  });

  it("renders hidden file input with csv accept", () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".csv");
  });

  it("rejects non-CSV files and shows error feedback", async () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;

    const file = new File(["data"], "positions.xlsx", { type: "application/vnd.ms-excel" });
    Object.defineProperty(input, "files", { value: [file], writable: false });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId("import-feedback")).toHaveTextContent("Only CSV files are supported");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls importManualPositionsCsv with correct accountId and shows success feedback", async () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;

    const file = new File(["ticker,quantity\nVYM,50"], "positions.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], writable: false });

    fireEvent.change(input);

    await waitFor(() => {
      expect(TradingActions.importManualPositionsCsv).toHaveBeenCalledWith(
        71,
        expect.any(FormData)
      );
      expect(screen.getByTestId("import-feedback")).toHaveTextContent("Imported 3 positions");
      expect(onSuccess).toHaveBeenCalledWith(3);
    });
  });

  it("shows error feedback when import fails", async () => {
    vi.mocked(TradingActions.importManualPositionsCsv).mockResolvedValueOnce({
      ok: false,
      error: "Import service unavailable",
    });

    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;

    const file = new File(["ticker,quantity\nVYM,50"], "positions.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], writable: false });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId("import-feedback")).toHaveTextContent("Import service unavailable");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
