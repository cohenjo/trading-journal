"use client";

import React, { useRef, useState } from "react";
import { importManualPositionsCsv } from "@/app/trading/actions";

export interface CSVImportButtonProps {
  accountId: number;
  onSuccess: (imported: number) => void;
}

/**
 * A button that triggers a hidden CSV file input.  On file selection, the CSV
 * is uploaded to the backend via the import server action and the parent is
 * notified of success with the number of rows imported.
 */
export default function CSVImportButton({ accountId, onSuccess }: CSVImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const handleButtonClick = () => {
    setFeedback(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so same file can be re-selected after an error
    e.target.value = "";

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFeedback({ ok: false, message: "Only CSV files are supported" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setFeedback(null);

    const result = await importManualPositionsCsv(accountId, formData);
    setUploading(false);

    if (!result.ok) {
      setFeedback({ ok: false, message: result.error });
      return;
    }

    setFeedback({ ok: true, message: `Imported ${result.imported} position${result.imported !== 1 ? "s" : ""}` });
    onSuccess(result.imported);
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
        data-testid="csv-file-input"
        aria-label="Import CSV file"
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
        {uploading ? "Importing…" : "Import CSV"}
      </button>
      {feedback && (
        <p
          className={`text-xs ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}
          data-testid="import-feedback"
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
