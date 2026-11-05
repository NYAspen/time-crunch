"use client";

import { useRef, useState, useTransition } from "react";
import { fetchGoogleSheet } from "@/app/admin/actions";
import { parseTable } from "@/lib/csv";
import type { ActionResult } from "@/lib/types";
import { Notice } from "./Notice";

// The rows to import (a textarea named "table", inside the import form). A CSV
// file or a Google Sheets link just fills the textarea, so the admin can check
// the rows, and Import works the same however they got there. Left uncontrolled
// so it clears itself after a successful import.
export function ImportTable({ placeholder }: { placeholder: string }) {
  const tableRef = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const [loading, startLoading] = useTransition();

  const fill = (text: string, from: string) => {
    const count = parseTable(text).length;
    if (count === 0) {
      setResult({ ok: false, message: `${from} has no rows under its header row.` });
      return;
    }
    if (tableRef.current) tableRef.current.value = text;
    setResult({
      ok: true,
      message: `Loaded ${count} row${count === 1 ? "" : "s"} from ${from}. Check them below, then tap Import.`,
    });
  };

  const loadFile = (file: File) =>
    startLoading(async () => {
      fill(await file.text(), file.name);
    });

  const loadLink = () =>
    startLoading(async () => {
      const { result: problem, text } = await fetchGoogleSheet(link);
      if (text === null) setResult(problem);
      else fill(text, "the Google Sheet");
    });

  return (
    <>
      {/* The browser's own file input can't be styled, so it is hidden and its label is the button. */}
      <label className="block w-full cursor-pointer rounded bg-gray-800 p-2 text-center font-semibold text-white has-disabled:cursor-default has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gray-900">
        Choose CSV file
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
            e.target.value = ""; // so choosing the same file again reloads it
          }}
          className="sr-only"
        />
      </label>

      <div className="space-y-1">
        <label htmlFor="sheet-link" className="block text-sm font-medium">
          Google Sheets link
        </label>
        <div className="flex gap-2">
          <input
            id="sheet-link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            autoComplete="off"
            className="min-w-0 flex-1 rounded border bg-white p-2"
          />
          <button
            type="button"
            disabled={loading || !link.trim()}
            onClick={loadLink}
            className="rounded bg-gray-800 px-3 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
      </div>

      <Notice compact result={result} />

      <label className="block space-y-1">
        <span className="text-sm font-medium">Rows to import (or paste them here)</span>
        <textarea
          ref={tableRef}
          name="table"
          rows={6}
          placeholder={placeholder}
          className="w-full rounded border p-2 font-mono text-xs"
        />
      </label>
    </>
  );
}
