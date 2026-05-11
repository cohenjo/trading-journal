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

// Mock the Leumi XLS parser so component tests don't depend on XML parsing
vi.mock("@/lib/trading/leumi-xls-parser", () => ({
  parseLeumiIraXls: vi.fn().mockResolvedValue([
    { symbol: "QQQI", exchange: "US", quantity: 700, average_cost: 54.57, currency: "USD", raw_description: "test", tase_id: "60398411", as_of_date: "2026-05-11" },
  ]),
  holdingsToCsv: vi.fn().mockReturnValue({
    csv: "ticker,quantity,average_cost,currency,as_of_date\nQQQI,700,54.57,USD,2026-05-11",
    unmappable: [],
  }),
}));

describe("CSVImportButton", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders Import file button", () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    expect(screen.getByTestId("import-csv-button")).toBeInTheDocument();
    expect(screen.getByTestId("import-csv-button")).toHaveTextContent("Import file");
  });

  it("renders hidden file input accepting csv, xls, xlsx", () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".csv,.xls,.xlsx");
  });

  it("rejects unsupported file types and shows error feedback", async () => {
    render(<CSVImportButton accountId={71} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;

    const file = new File(["data"], "positions.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], writable: false });

    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId("import-feedback")).toHaveTextContent(
        "Only CSV, XLS, and XLSX files are supported"
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls importManualPositionsCsv with correct accountId for CSV and shows success feedback", async () => {
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

  it("parses XLS file via leumi-xls-parser and calls importManualPositionsCsv", async () => {
    render(<CSVImportButton accountId={72} onSuccess={onSuccess} />);
    const input = screen.getByTestId("csv-file-input") as HTMLInputElement;

    const file = new File(["<xml/>"], "leumi-IRA.xls", { type: "application/vnd.ms-excel" });
    Object.defineProperty(input, "files", { value: [file], writable: false });

    fireEvent.change(input);

    await waitFor(() => {
      expect(TradingActions.importManualPositionsCsv).toHaveBeenCalledWith(
        72,
        expect.any(FormData)
      );
      expect(screen.getByTestId("import-feedback")).toHaveTextContent("Imported 3 positions");
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
