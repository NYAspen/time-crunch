"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { refreshAllLiveTables } from "./useLiveTable";

// A red "Delete all …" button that asks for confirmation first.
export function DeleteAllButton({
  label,
  warning,
  action,
}: {
  label: string;
  warning: string;
  action: () => Promise<ActionResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="space-y-2 rounded-lg bg-red-50 p-3">
          <p className="text-sm text-red-900">{warning}</p>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(await action());
                  setConfirming(false);
                  refreshAllLiveTables();
                })
              }
              className="flex-1 rounded bg-red-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Yes, {label.toLowerCase()}
            </button>
            <button onClick={() => setConfirming(false)} className="flex-1 rounded border bg-white p-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full rounded border border-red-300 p-2 text-sm text-red-700"
        >
          {label}
        </button>
      )}
      {result && (
        <p
          className={`rounded-lg p-2 text-sm ${result.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
