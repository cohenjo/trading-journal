"use client";

import React, { useRef, useState } from "react";
import { importManualPositionsCsv } from "@/app/trading/actions";
import { parseLeumiIraXls, holdingsToCsv } from "@/lib/trading/leumi-xls-parser";

export interface CSVImportButtonProps {
  accountId: number;
  onSuccess: (imported: number) => void;
}

interface ImportFeedback {
  ok: boolean;
  message: string;
  /** Holdings that could not be mapped to an exchange (exchange='UNKNOWN'). */
  unmappable?: Array<{ raw_description: string; tase_id: string }>;
}

/** Accepted file extensions for the import button. */
const ACCEPTED_EXTENSIONS = ".csv,.xls,.xlsx";

/** True for Leumi-style SpreadsheetML exports (.xls / .xlsx that are actually XML). */
function isExcelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xls") || lower.endsWith(".xlsx");
}

/**
 * Reads the uploaded Leumi IRA Excel file, parses it, converts valid holdings
 * to the CSV format expected by the FastAPI import endpoint, and returns FormData
 * ready to POST.  Also surfaces holdings that could not be exchange-mapped.
 */
async function buildFormDataFromXls(
  file: File,
): Promise<{ formData: FormData; unmappable: Array<{ raw_description: string; tase_id: string }> }> {
  const buffer = await file.arrayBuffer();
  const holdings = await parseLeumiIraXls(buffer);
  const { csv, unmappable } = holdingsToCsv(holdings);

  const csvBlob = new Blob([csv], { type: "text/csv" });
  const csvFile = new File([csvBlob], "leumi-ira-import.csv", { type: "text/csv" });

  const formData = new FormData();
  formData.append("file", csvFile);

  return {
    formData,
    unmappable: unmappable.map((h) => ({
      raw_description: h.raw_description,
      tase_id: h.tase_id,
    })),
  };
}

/**
 * Button that triggers a hidden file input accepting CSV, XLS, and XLSX.
 *
 * - **CSV files** are forwarded directly to the FastAPI import endpoint.
 * - **XLS / XLSX files** (Leumi IRA SpreadsheetML format) are parsed in the
 *   browser, converted to the expected CSV schema, then forwarded to the same
 *   endpoint.  Holdings that cannot be mapped to a known exchange are surfaced
 *   as warnings after a successful import.
 */
export default function CSVImportButton({ accountId, onSuccess }: CSVImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);

  const handleButtonClick = () => {
    setFeedback(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so same file can be re-selected after an error.
    e.target.value = "";

    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isXls = isExcelFile(file.name);

    if (!isCsv && !isXls) {
      setFeedback({ ok: false, message: "Only CSV, XLS, and XLSX files are supported" });
      return;
    }

    setUploading(true);
    setFeedback(null);

    let formData: FormData;
    let unmappable: Array<{ raw_description: string; tase_id: string }> = [];

    if (isXls) {
      try {
        ({ formData, unmappable } = await buildFormDataFromXls(file));
      } catch (err) {
        setUploading(false);
        setFeedback({ ok: false, message: `Could not parse Excel file: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    } else {
      formData = new FormData();
      formData.append("file", file);
    }

    const result = await importManualPositionsCsv(accountId, formData);
    setUploading(false);

    if (!result.ok) {
      setFeedback({ ok: false, message: result.error });
      return;
    }

    const successMsg = `Imported ${result.imported} position${result.imported !== 1 ? "s" : ""}`;
    setFeedback({ ok: true, message: successMsg, unmappable: unmappable.length > 0 ? unmappable : undefined });
    onSuccess(result.imported);
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleFileChange}
        data-testid="csv-file-input"
        aria-label="Import positions file (CSV, XLS, XLSX)"
      />
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={uploading}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:border-violet-600 hover:bg-violet-900/20 transition-all text-sm disabled:opacity-50"
        data-testid="import-csv-button"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {uploading ? "Importing…" : "Import file"}
      </button>
      {feedback && (
        <div className="flex flex-col gap-0.5">
          <p
            className={`text-xs ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}
            data-testid="import-feedback"
          >
            {feedback.message}
          </p>
          {feedback.unmappable && feedback.unmappable.length > 0 && (
            <p className="text-xs text-amber-400" data-testid="import-unmappable">
              ⚠️ {feedback.unmappable.length} position{feedback.unmappable.length !== 1 ? "s" : ""} could not be mapped to an exchange and were skipped:{" "}
              {feedback.unmappable.map((u) => u.raw_description).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
